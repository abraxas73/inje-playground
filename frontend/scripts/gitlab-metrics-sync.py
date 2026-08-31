#!/usr/bin/env python3
"""GitLab 일 집계 로컬 수집 → inje-playground 푸시.

사내 GitLab(https://rnd-app.innogrid.com)이 Vercel IP를 차단하므로(화이트리스트),
사내망에서 이 스크립트를 돌려 커밋·MR 일 집계를 POST /api/admin/work-metrics/sync 로 밀어 넣는다.
서버 수집기(frontend/src/lib/work-metrics/gitlab.ts)와 같은 집계 규칙.

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
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # frontend/
COMPANY_DOMAIN = "innogrid.com"
KST = dt.timezone(dt.timedelta(hours=9))


def env_local(key: str) -> str | None:
    path = os.path.join(ROOT, ".env.local")
    if not os.path.exists(path):
        return None
    for line in open(path, encoding="utf-8"):
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
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


def gl_get_all(base: str, token: str, path: str, max_pages: int = 50) -> list:
    out = []
    for page in range(1, max_pages + 1):
        sep = "&" if "?" in path else "?"
        req = urllib.request.Request(f"{base}/api/v4{path}{sep}per_page=100&page={page}", headers={"PRIVATE-TOKEN": token})
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.load(r)
        out.extend(batch)
        if len(batch) < 100:
            break
    return out


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
            agg[k] = {"day": day, "user_email": email, "project_path": project, "commits": 0, "mrs_opened": 0, "mrs_merged": 0, "mr_lead_hours_sum": 0.0}
        return agg[k]

    q_from = urllib.parse.quote(from_iso)
    q_to = urllib.parse.quote(to_iso)
    for i, p in enumerate(projects, 1):
        pid, path = p["id"], p["path_with_namespace"]
        try:
            commits = gl_get_all(gitlab_url, token, f"/projects/{pid}/repository/commits?since={q_from}&until={q_to}&all=true")
            for cm in commits:
                email = normalize_email(cm.get("author_email"))
                when = cm.get("committed_date")
                if email and when:
                    bump(kst_day(when), email, path)["commits"] += 1
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

    for i in range(0, len(rows), 5000):
        chunk = rows[i : i + 5000]
        req = urllib.request.Request(
            f"{app_url}/api/admin/work-metrics/sync",
            data=json.dumps({"source": "gitlab", "rows": chunk}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {ingest}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            print("→", json.load(r))


if __name__ == "__main__":
    main()
