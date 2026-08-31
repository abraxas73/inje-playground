import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, kstDay, kstDayBoundsUtc, hoursBetween, dayList, upsertChunked, type CollectResult } from "./common";

/**
 * GitLab(self-managed, https://rnd-app.innogrid.com) 일 집계 — 전체 커밋·MR(Claude 경유 비중의 분모).
 * env: GITLAB_URL, GITLAB_TOKEN(read_api), GITLAB_GROUPS(선택, 쉼표 구분 그룹 경로; 없으면 토큰이 보는 전체 프로젝트)
 * 사용자명은 이메일 로컬파트 규칙 → normalizeEmail로 회사 이메일화.
 */

interface GlProject { id: number; path_with_namespace: string; last_activity_at: string }
interface GlCommit { author_email?: string; committed_date?: string }
interface GlMr { author?: { username?: string }; created_at: string; merged_at?: string | null; state: string }

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

export async function collectGitlab(admin: SupabaseClient, from: string, to: string): Promise<CollectResult> {
  if (!cfg()) return { source: "gitlab", rows: 0, notes: "미설정(GITLAB_*)" };
  const { fromIso } = kstDayBoundsUtc(from);
  const { toIso } = kstDayBoundsUtc(to);
  const projects = await listProjects(fromIso);

  const agg = new Map<string, { day: string; user_email: string; project_path: string; commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number }>();
  const bump = (day: string, email: string, project: string) => {
    const k = `${day}|${email}|${project}`;
    let v = agg.get(k);
    if (!v) { v = { day, user_email: email, project_path: project, commits: 0, mrs_opened: 0, mrs_merged: 0, mr_lead_hours_sum: 0 }; agg.set(k, v); }
    return v;
  };

  for (const p of projects) {
    const commits = await glFetchAll<GlCommit>(`/projects/${p.id}/repository/commits?since=${encodeURIComponent(fromIso)}&until=${encodeURIComponent(toIso)}&all=true`);
    for (const cm of commits) {
      const email = normalizeEmail(cm.author_email);
      if (!email || !cm.committed_date) continue;
      bump(kstDay(cm.committed_date), email, p.path_with_namespace).commits += 1;
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
  const rows = [...agg.values()].filter((r) => days.has(r.day));
  await upsertChunked(admin, "gitlab_daily", rows, "day,user_email,project_path");
  return { source: "gitlab", rows: rows.length, notes: `프로젝트 ${projects.length}개 순회` };
}
