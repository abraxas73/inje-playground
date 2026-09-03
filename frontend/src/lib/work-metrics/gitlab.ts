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
 *  - 커밋 날짜 = authored_date(KST). committed_date는 리베이스 때 재스탬프되어 하루에 수천 커밋이 몰리는
 *    허위 급증을 만든다(2026-08-27~28 관측: API상 61건인 날이 1,800건으로 집계됨).
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

function cfg() {
  const url = (process.env.GITLAB_URL ?? "").replace(/\/+$/, "");
  const token = process.env.GITLAB_TOKEN ?? "";
  if (!url || !token) return null;
  return { url, token };
}

async function glFetchAll<T>(path: string, maxPages = 20): Promise<T[]> {
  const c = cfg()!;
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${c.url}/api/v4${path}${sep}per_page=100&page=${page}`, { headers: { "PRIVATE-TOKEN": c.token } });
    if (!r.ok) throw new Error(`GitLab ${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as T[];
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
    const commits = await glFetchAll<GlCommit>(`/projects/${p.id}/repository/commits?since=${encodeURIComponent(fromIso)}&until=${encodeURIComponent(toIso)}&all=true`);
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
