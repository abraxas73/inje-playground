#!/usr/bin/env python3
"""GitLab 일 집계 로컬 수집 → inje-playground 푸시.

사내 GitLab(https://rnd-app.innogrid.com)이 Vercel IP를 차단하므로(화이트리스트),
사내망에서 이 스크립트를 돌려 커밋·MR 일 집계를 POST /api/admin/work-metrics/sync 로 밀어 넣는다.
서버 수집기(frontend/src/lib/work-metrics/gitlab.ts)와 같은 집계 규칙 — 규칙을 바꾸면 양쪽을 함께 고칠 것.

집계 규칙:
  - 커밋 조회는 페이지네이션 대신 시간 창 이분(gl_commits_windowed). commits API는 all=true일 때 page를 무시하고
    매 페이지 같은 최신 100건을 돌려준다(2026-09-03 확인) — 옛 코드는 이를 페이지 수만큼 중복 집계해 08-27~28에
    하루 4~6천 커밋(실제 200~300)의 허위 급증을 만들었고, 긴 창에서는 프로젝트당 최신 100건만 남아 과거가 비었다.
  - 커밋 날짜 = authored_date(KST). committed_date는 리베이스 때 재스탬프된다.
  - 같은 (author_email, authored_date, title) 커밋은 1건 — 리베이스·체리픽으로 SHA만 바뀐 중복 제거.
  - claude_commits = 메시지에 "Co-Authored-By: Claude" 트레일러가 있는 커밋(commits의 부분집합, 하한값).
  - 이메일 정규화(조직도·오타 도메인·gitlab_email_map)와 같은 사람 행 합산은 서버(sync API)가 한다.
  - 기간의 기존 행을 지우고 다시 넣는다(replace) — 사라진 커밋·이전 규칙 행 정리. 매일 3일 창으로 돌려 자가 복구.

사용:
  python3 frontend/scripts/gitlab-metrics-sync.py                  # 어제(KST) 하루
  python3 frontend/scripts/gitlab-metrics-sync.py --from 2026-05-01 --to 2026-08-30   # 백필
  python3 frontend/scripts/gitlab-metrics-sync.py --dry-run

환경: GITLAB_TOKEN(read_api; 없으면 frontend/.env.local의 GITLAB_TOKEN),
     CLAUDE_OTEL_INGEST_TOKEN(없으면 .env.local), GITLAB_URL(기본 rnd-app), APP_URL(기본 프로덕션),
     GITLAB_GROUPS(선택, 쉼표 구분 그룹 경로)
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # frontend/
COMPANY_DOMAIN = "innogrid.com"
# Claude Code가 남기는 공동 저자 트레일러 (lib/work-metrics/gitlab.ts CLAUDE_TRAILER와 동일)
CLAUDE_TRAILER = re.compile(r"co-authored-by:[^\n]*(claude|anthropic)|noreply@anthropic\.com", re.I)
KST = dt.timezone(dt.timedelta(hours=9))


def env_local(key: str) -> str | None:
    # .env.local이 `vercel env pull`로 덮어써질 수 있어 폴백으로 ~/.config/inje-playground/work-metrics.env도 본다
    candidates = [os.path.join(ROOT, ".env.local"), os.path.expanduser("~/.config/inje-playground/work-metrics.env")]
    for path in candidates:
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            if line.startswith(f"{key}="):
                v = line.split("=", 1)[1].strip()
                if v and not v.startswith("["):  # "[SENSITIVE]" 플레이스홀더 무시
                    return v
    return None


def cfg():
    gitlab_url = (os.environ.get("GITLAB_URL") or "https://rnd-app.innogrid.com").rstrip("/")
    token = os.environ.get("GITLAB_TOKEN") or env_local("GITLAB_TOKEN")
    app_url = (os.environ.get("APP_URL") or "https://inje-playground.vercel.app").rstrip("/")
    ingest = os.environ.get("CLAUDE_OTEL_INGEST_TOKEN") or env_local("CLAUDE_OTEL_INGEST_TOKEN")
    if not token:
        sys.exit("GITLAB_TOKEN이 없습니다 (env 또는 frontend/.env.local)")
    if not ingest:
        sys.exit("CLAUDE_OTEL_INGEST_TOKEN이 없습니다 (env 또는 frontend/.env.local)")
    return gitlab_url, token, app_url, ingest


def gl_get(base: str, token: str, path_with_query: str) -> list:
    """단일 요청. 5xx·429·네트워크 오류(GOAWAY, 타임아웃)는 3회 재시도, 4xx는 즉시 예외."""
    last: Exception | None = None
    for attempt in range(4):
        if attempt:
            time.sleep(2 ** (attempt - 1))
        try:
            req = urllib.request.Request(f"{base}/api/v4{path_with_query}", headers={"PRIVATE-TOKEN": token})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                raise
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = e
    raise last  # type: ignore[misc]


def gl_get_all(base: str, token: str, path: str, max_pages: int = 50) -> list:
    """페이지네이션이 정상인 엔드포인트(projects, merge_requests, groups)용. commits?all=true에는 쓰지 말 것."""
    out = []
    for page in range(1, max_pages + 1):
        sep = "&" if "?" in path else "?"
        batch = gl_get(base, token, f"{path}{sep}per_page=100&page={page}")
        out.extend(batch)
        if len(batch) < 100:
            break
    return out


def gl_commits_windowed(base: str, token: str, pid: int, since: dt.datetime, until: dt.datetime, out: dict, min_window: dt.timedelta = dt.timedelta(hours=1)) -> None:
    """커밋을 시간 창 이분으로 모두 읽는다(lib/work-metrics/gitlab.ts fetchCommitsWindowed와 동일).
    창의 결과가 100건(한 페이지)이면 반으로 쪼개 재귀, 1시간 미만 창은 그대로 받는다. since/until이 양끝 포함이라 SHA로 중복 제거."""
    q = f"since={urllib.parse.quote(since.isoformat())}&until={urllib.parse.quote(until.isoformat())}"
    batch = gl_get(base, token, f"/projects/{pid}/repository/commits?{q}&all=true&per_page=100")
    if len(batch) >= 100 and (until - since) > min_window:
        mid = since + (until - since) / 2
        gl_commits_windowed(base, token, pid, since, mid, out, min_window)
        gl_commits_windowed(base, token, pid, mid, until, out, min_window)
        return
    for c in batch:
        out[c.get("id") or (c.get("author_email"), c.get("authored_date"), c.get("title"))] = c


def normalize_email(raw: str | None) -> str | None:
    s = (raw or "").strip().lower()
    if not s:
        return None
    if "@" in s:
        return s
    return f"{s}@{COMPANY_DOMAIN}" if all(c.isalnum() or c in "._+-" for c in s) else None


def kst_day(iso: str) -> str:
    d = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return d.astimezone(KST).date().isoformat()


def hours_between(a: str, b: str) -> float:
    da = dt.datetime.fromisoformat(a.replace("Z", "+00:00"))
    db = dt.datetime.fromisoformat(b.replace("Z", "+00:00"))
    return max(0.0, (db - da).total_seconds() / 3600)


def main() -> None:
    ap = argparse.ArgumentParser()
    yesterday = (dt.datetime.now(KST) - dt.timedelta(days=1)).date().isoformat()
    ap.add_argument("--from", dest="date_from", default=yesterday)
    ap.add_argument("--to", dest="date_to", default=yesterday)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    gitlab_url, token, app_url, ingest = cfg()
    from_iso = f"{args.date_from}T00:00:00+09:00"
    to_iso = (dt.datetime.fromisoformat(f"{args.date_to}T00:00:00+09:00") + dt.timedelta(days=1)).isoformat()

    groups = [g.strip() for g in (os.environ.get("GITLAB_GROUPS") or "").split(",") if g.strip()]
    projects: list = []
    if groups:
        for g in groups:
            projects += gl_get_all(gitlab_url, token, f"/groups/{urllib.parse.quote(g, safe='')}/projects?include_subgroups=true&archived=false&order_by=last_activity_at")
    else:
        projects = gl_get_all(gitlab_url, token, "/projects?archived=false&order_by=last_activity_at&simple=false", max_pages=50)
    from_utc = dt.datetime.fromisoformat(from_iso).astimezone(dt.timezone.utc).isoformat()
    projects = [p for p in projects if p.get("last_activity_at", "") >= from_utc]
    print(f"프로젝트 {len(projects)}개 (활동 {args.date_from}~ 기준)")

    agg: dict[tuple, dict] = {}

    def bump(day: str, email: str, project: str) -> dict:
        k = (day, email, project)
        if k not in agg:
            agg[k] = {"day": day, "user_email": email, "project_path": project, "commits": 0, "claude_commits": 0, "mrs_opened": 0, "mrs_merged": 0, "mr_lead_hours_sum": 0.0}
        return agg[k]

    q_from = urllib.parse.quote(from_iso)
    q_to = urllib.parse.quote(to_iso)
    for i, p in enumerate(projects, 1):
        pid, path = p["id"], p["path_with_namespace"]
        try:
            # since/until은 committed_date 기준 창(git log). 창 밖에서 authored된 리베이스 커밋은 아래 날짜 필터에서 빠진다.
            by_sha: dict = {}
            gl_commits_windowed(gitlab_url, token, pid, dt.datetime.fromisoformat(from_iso), dt.datetime.fromisoformat(to_iso), by_sha)
            seen: set = set()
            for cm in by_sha.values():
                email = normalize_email(cm.get("author_email"))
                when = cm.get("authored_date") or cm.get("committed_date")
                if not email or not when:
                    continue
                dedupe = (email, when, cm.get("title") or "")
                if dedupe in seen:  # 리베이스·체리픽으로 SHA만 바뀐 같은 커밋
                    continue
                seen.add(dedupe)
                v = bump(kst_day(when), email, path)
                v["commits"] += 1
                if CLAUDE_TRAILER.search(cm.get("message") or ""):
                    v["claude_commits"] += 1
            mrs = gl_get_all(gitlab_url, token, f"/projects/{pid}/merge_requests?updated_after={q_from}&scope=all")
            for mr in mrs:
                email = normalize_email((mr.get("author") or {}).get("username"))
                if not email:
                    continue
                if args.date_from <= kst_day(mr["created_at"]) <= args.date_to:
                    bump(kst_day(mr["created_at"]), email, path)["mrs_opened"] += 1
                merged_at = mr.get("merged_at")
                if merged_at and args.date_from <= kst_day(merged_at) <= args.date_to:
                    v = bump(kst_day(merged_at), email, path)
                    v["mrs_merged"] += 1
                    v["mr_lead_hours_sum"] += hours_between(mr["created_at"], merged_at)
        except Exception as e:  # 개별 프로젝트 실패는 건너뛰고 계속
            print(f"  ✗ {path}: {e}")
        if i % 20 == 0:
            print(f"  … {i}/{len(projects)}")

    rows = [r for r in agg.values() if args.date_from <= r["day"] <= args.date_to]
    print(f"집계 {len(rows)}행 ({args.date_from} ~ {args.date_to})")
    if args.dry_run:
        for r in rows[:10]:
            print(" ", r)
        return

    chunks = [rows[i : i + 5000] for i in range(0, len(rows), 5000)] or [[]]  # 행이 없어도 replace로 기간을 비운다
    for idx, chunk in enumerate(chunks):
        body: dict = {"source": "gitlab", "rows": chunk}
        if idx == 0:
            body["replace"] = {"from": args.date_from, "to": args.date_to}
        req = urllib.request.Request(
            f"{app_url}/api/admin/work-metrics/sync",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {ingest}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            print("→", json.load(r))


if __name__ == "__main__":
    main()
