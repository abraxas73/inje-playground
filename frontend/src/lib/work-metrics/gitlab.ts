import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, kstDay, kstDayBoundsUtc, hoursBetween, dayList, upsertChunked, deleteDayRange, type CollectResult } from "./common";
import { loadEmailResolver, resolveAndMergeGitlabRows, resolveCommitterEmail } from "./email-resolve";

/**
 * GitLab(self-managed, https://rnd-app.innogrid.com) 일 집계 — 전체 커밋·Claude 경유 커밋·MR.
 * env: GITLAB_URL, GITLAB_TOKEN(read_api), GITLAB_GROUPS(선택, 쉼표 구분 그룹 경로; 없으면 토큰이 보는 전체 프로젝트)
 *
 * 실제 운영은 로컬 스크립트 frontend/scripts/gitlab-metrics-sync.py가 맡는다(사내 IP 화이트리스트로 Vercel에서 접근 불가).
 * 두 구현은 같은 규칙이어야 하므로 규칙을 바꾸면 양쪽을 함께 고칠 것.
 *
 * 집계 규칙:
 *  - 커밋 조회는 페이지네이션 대신 시간 창 이분(fetchCommitsWindowed). commits API는 all=true일 때 page를 무시하고
 *    매 페이지 같은 최신 100건을 돌려준다(2026-09-03 확인) — 옛 코드는 이를 페이지 수만큼 중복 집계해 08-27~28에
 *    하루 4~6천 커밋(실제 200~300)의 허위 급증을 만들었고, 긴 창에서는 프로젝트당 최신 100건만 남아 과거가 비었다.
 *  - 커밋 날짜 = authored_date(KST). committed_date는 리베이스 때 재스탬프된다.
 *  - 같은 (author_email, authored_date, title) 커밋은 1건 — 리베이스·체리픽으로 SHA만 바뀐 중복 제거.
 *  - claude_commits = 메시지에 "Co-Authored-By: Claude" 트레일러(또는 noreply@anthropic.com)가 있는 커밋. commits의 부분집합(하한값).
 *  - 이메일은 email-resolve 규칙(조직도·오타 도메인·수동 매핑)으로 회사 이메일에 맞춘다.
 *  - 기간 내 기존 행을 지우고 다시 넣는다(force-push로 사라진 커밋·이전 규칙 행 정리).
 */

export interface GlCommit { id?: string; author_email?: string; authored_date?: string; committed_date?: string; title?: string; message?: string }
interface GlProject { id: number; path_with_namespace: string; last_activity_at: string }
interface GlMr { author?: { username?: string }; created_at: string; merged_at?: string | null; state: string }

/** Claude Code가 남기는 공동 저자 트레일러 */
export const CLAUDE_TRAILER = /co-authored-by:[^\n]*(claude|anthropic)|noreply@anthropic\.com/i;
export const isClaudeCommit = (message: string | undefined): boolean => CLAUDE_TRAILER.test(message ?? "");

export interface CommitSummary { day: string; email: string; commits: number; claude_commits: number }

/** 커밋 목록 → (KST authored 일, author_email)별 전체/Claude 커밋 수. 리베이스 중복 제거 */
export function summarizeCommits(commits: GlCommit[]): CommitSummary[] {
  const seen = new Set<string>();
  const out = new Map<string, CommitSummary>();
  for (const c of commits) {
    const email = normalizeEmail(c.author_email);
    const when = c.authored_date ?? c.committed_date;
    if (!email || !when) continue;
    const dedupe = `${email}|${when}|${c.title ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const day = kstDay(when);
    const k = `${day}|${email}`;
    let v = out.get(k);
    if (!v) { v = { day, email, commits: 0, claude_commits: 0 }; out.set(k, v); }
    v.commits += 1;
    if (isClaudeCommit(c.message)) v.claude_commits += 1;
  }
  return [...out.values()];
}

/**
 * 커밋을 시간 창 이분으로 모두 읽는다. 창의 결과가 100건(한 페이지)이면 창을 반으로 쪼개 재귀하고,
 * 1시간 미만 창은 그대로 받는다(같은 시각 100건 초과는 사실상 없음). since/until이 양끝 포함이라 SHA로 중복 제거.
 * fetchWindow는 한 창을 per_page=100 단일 요청으로 읽는 함수(테스트에서 주입).
 */
export async function fetchCommitsWindowed(
  fetchWindow: (sinceIso: string, untilIso: string) => Promise<GlCommit[]>,
  sinceIso: string,
  untilIso: string,
  minWindowMs = 3600_000
): Promise<GlCommit[]> {
  const bySha = new Map<string, GlCommit>();
  const walk = async (a: number, b: number): Promise<void> => {
    const batch = await fetchWindow(new Date(a).toISOString(), new Date(b).toISOString());
    if (batch.length >= 100 && b - a > minWindowMs) {
      const mid = a + Math.floor((b - a) / 2);
      await walk(a, mid);
      await walk(mid, b);
      return;
    }
    for (const c of batch) bySha.set(c.id ?? `${c.author_email}|${c.authored_date}|${c.title}`, c);
  };
  await walk(new Date(sinceIso).getTime(), new Date(untilIso).getTime());
  return [...bySha.values()];
}

function cfg() {
  const url = (process.env.GITLAB_URL ?? "").replace(/\/+$/, "");
  const token = process.env.GITLAB_TOKEN ?? "";
  if (!url || !token) return null;
  return { url, token };
}

/** 단일 요청(5xx·429·네트워크 오류는 3회 재시도) */
async function glGet<T>(pathWithQuery: string): Promise<T[]> {
  const c = cfg()!;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try {
      const r = await fetch(`${c.url}/api/v4${pathWithQuery}`, { headers: { "PRIVATE-TOKEN": c.token }, signal: AbortSignal.timeout(60_000) });
      if (r.status >= 500 || r.status === 429) { lastErr = new Error(`GitLab ${pathWithQuery.split("?")[0]} ${r.status}`); continue; }
      if (!r.ok) throw new Error(`GitLab ${pathWithQuery.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return (await r.json()) as T[];
    } catch (e) {
      if (e instanceof Error && /^GitLab .* \d{3}:/.test(e.message)) throw e; // 4xx는 즉시
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 페이지네이션이 정상인 엔드포인트(projects, merge_requests, groups)용. commits?all=true에는 쓰지 말 것 — fetchCommitsWindowed 참고 */
async function glFetchAll<T>(path: string, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const j = await glGet<T>(`${path}${sep}per_page=100&page=${page}`);
    out.push(...j);
    if (j.length < 100) break;
  }
  return out;
}

async function listProjects(sinceIso: string): Promise<GlProject[]> {
  const groups = (process.env.GITLAB_GROUPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let projects: GlProject[] = [];
  if (groups.length) {
    for (const g of groups) {
      projects.push(...(await glFetchAll<GlProject>(`/groups/${encodeURIComponent(g)}/projects?include_subgroups=true&archived=false&order_by=last_activity_at`)));
    }
  } else {
    projects = await glFetchAll<GlProject>(`/projects?membership=false&archived=false&order_by=last_activity_at&simple=false`, 30);
  }
  // 수집 기간에 활동 없는 프로젝트는 스킵
  return projects.filter((p) => p.last_activity_at >= sinceIso);
}

type Row = { day: string; user_email: string; project_path: string; commits: number; claude_commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number };

export async function collectGitlab(admin: SupabaseClient, from: string, to: string): Promise<CollectResult> {
  if (!cfg()) return { source: "gitlab", rows: 0, notes: "미설정(GITLAB_*)" };
  const { fromIso } = kstDayBoundsUtc(from);
  const { toIso } = kstDayBoundsUtc(to);
  const projects = await listProjects(fromIso);

  const agg = new Map<string, Row>();
  const bump = (day: string, email: string, project: string) => {
    const k = `${day}|${email}|${project}`;
    let v = agg.get(k);
    if (!v) { v = { day, user_email: email, project_path: project, commits: 0, claude_commits: 0, mrs_opened: 0, mrs_merged: 0, mr_lead_hours_sum: 0 }; agg.set(k, v); }
    return v;
  };

  for (const p of projects) {
    // since/until은 committed_date 기준 창(git log). 창 밖에서 authored된 리베이스 커밋은 아래 days 필터에서 빠진다.
    const commits = await fetchCommitsWindowed(
      (s, u) => glGet<GlCommit>(`/projects/${p.id}/repository/commits?since=${encodeURIComponent(s)}&until=${encodeURIComponent(u)}&all=true&per_page=100`),
      fromIso, toIso
    );
    for (const s of summarizeCommits(commits)) {
      const v = bump(s.day, s.email, p.path_with_namespace);
      v.commits += s.commits;
      v.claude_commits += s.claude_commits;
    }
    const mrs = await glFetchAll<GlMr>(`/projects/${p.id}/merge_requests?updated_after=${encodeURIComponent(fromIso)}&scope=all`);
    for (const mr of mrs) {
      const email = normalizeEmail(mr.author?.username);
      if (!email) continue;
      if (mr.created_at >= fromIso && mr.created_at < toIso) bump(kstDay(mr.created_at), email, p.path_with_namespace).mrs_opened += 1;
      if (mr.merged_at && mr.merged_at >= fromIso && mr.merged_at < toIso) {
        const v = bump(kstDay(mr.merged_at), email, p.path_with_namespace);
        v.mrs_merged += 1;
        v.mr_lead_hours_sum += hoursBetween(mr.created_at, mr.merged_at);
      }
    }
  }

  const days = new Set(dayList(from, to));
  const resolver = await loadEmailResolver(admin);
  const rows = resolveAndMergeGitlabRows([...agg.values()].filter((r) => days.has(r.day)), (e) => resolveCommitterEmail(e, resolver));
  await deleteDayRange(admin, "gitlab_daily", from, to);
  await upsertChunked(admin, "gitlab_daily", rows, "day,user_email,project_path");
  return { source: "gitlab", rows: rows.length, notes: `프로젝트 ${projects.length}개 순회` };
}
