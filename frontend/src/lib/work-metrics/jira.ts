import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, kstDay, hoursBetween, dayList, upsertChunked, type CollectResult } from "./common";

/**
 * Jira Cloud 일 집계 수집기 — 이슈 생성(보고자)·해결(담당자)·리드/사이클타임·스토리포인트.
 * env: ATLASSIAN_SITE(https://pms-innogrid.atlassian.net), ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN,
 *      JIRA_PROJECTS(선택, 쉼표 구분 키 필터), JIRA_STORY_POINTS_FIELD(선택, 예: customfield_10016)
 * GDPR 모드에서 이메일이 가려진 계정은 atlassian_account_map으로 보정, 없으면 aid:<accountId>.
 */

interface JiraUser { accountId?: string; emailAddress?: string }
interface JiraIssue {
  key: string;
  fields: {
    project?: { key?: string };
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    created?: string;
    resolutiondate?: string | null;
    [k: string]: unknown;
  };
  changelog?: { histories?: { created: string; items: { field: string; toString?: string | null }[] }[] };
}

function cfg() {
  const site = (process.env.ATLASSIAN_SITE ?? "").replace(/\/+$/, "");
  const email = process.env.ATLASSIAN_EMAIL ?? "";
  const token = process.env.ATLASSIAN_API_TOKEN ?? "";
  if (!site || !email || !token) return null;
  return { site, auth: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` };
}

async function jiraFetch(path: string, init?: RequestInit): Promise<Response> {
  const c = cfg();
  if (!c) throw new Error("ATLASSIAN_* 환경변수 미설정");
  const r = await fetch(`${c.site}${path}`, { ...init, headers: { Authorization: c.auth, Accept: "application/json", "Content-Type": "application/json", ...init?.headers } });
  if (!r.ok) throw new Error(`Jira ${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

/** JQL 검색(신형 /search/jql, nextPageToken 페이지네이션) */
async function searchAll(jql: string, fields: string[], expandChangelog: boolean): Promise<JiraIssue[]> {
  const out: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  for (let page = 0; page < 40; page++) {
    const body: Record<string, unknown> = { jql, fields, maxResults: 100 };
    if (expandChangelog) body.expand = "changelog";
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const r = await jiraFetch("/rest/api/3/search/jql", { method: "POST", body: JSON.stringify(body) });
    const j = (await r.json()) as { issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean };
    out.push(...(j.issues ?? []));
    if (!j.nextPageToken || j.isLast) break;
    nextPageToken = j.nextPageToken;
  }
  return out;
}

async function resolveUserEmail(admin: SupabaseClient, u: JiraUser | null | undefined, mapCache: Map<string, string>): Promise<string | null> {
  if (!u) return null;
  const direct = normalizeEmail(u.emailAddress);
  if (direct) {
    if (u.accountId && !mapCache.has(u.accountId)) {
      mapCache.set(u.accountId, direct);
      await admin.from("atlassian_account_map").upsert({ account_id: u.accountId, email: direct }, { onConflict: "account_id" });
    }
    return direct;
  }
  if (!u.accountId) return null;
  if (mapCache.has(u.accountId)) return mapCache.get(u.accountId)!;
  return `aid:${u.accountId}`;
}

/** changelog에서 최초 In Progress(진행) 진입 시각 */
function cycleStart(issue: JiraIssue): string | null {
  for (const h of issue.changelog?.histories ?? []) {
    for (const it of h.items) {
      if (it.field === "status" && /in progress|진행/i.test(it.toString ?? "")) return h.created;
    }
  }
  return null;
}

export async function collectJira(admin: SupabaseClient, from: string, to: string): Promise<CollectResult> {
  if (!cfg()) return { source: "jira", rows: 0, notes: "미설정(ATLASSIAN_*)" };
  const projFilter = (process.env.JIRA_PROJECTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const spField = (process.env.JIRA_STORY_POINTS_FIELD ?? "").trim();
  const projJql = projFilter.length ? ` AND project in (${projFilter.map((p) => `"${p}"`).join(",")})` : "";
  const fields = ["project", "assignee", "reporter", "created", "resolutiondate", ...(spField ? [spField] : [])];

  // 매핑 캐시 로드
  const mapRes = await admin.from("atlassian_account_map").select("account_id, email").limit(3000);
  const mapCache = new Map<string, string>(((mapRes.data ?? []) as { account_id: string; email: string }[]).map((m) => [m.account_id, m.email]));

  type Key = string; // day|email|project
  const agg = new Map<Key, { day: string; user_email: string; project_key: string; issues_created: number; issues_resolved: number; lead_hours_sum: number; cycle_hours_sum: number; cycle_count: number; story_points: number }>();
  const bump = (day: string, email: string, project: string) => {
    const k = `${day}|${email}|${project}`;
    let v = agg.get(k);
    if (!v) { v = { day, user_email: email, project_key: project, issues_created: 0, issues_resolved: 0, lead_hours_sum: 0, cycle_hours_sum: 0, cycle_count: 0, story_points: 0 }; agg.set(k, v); }
    return v;
  };

  // 생성(보고자 기준) — KST 하루 경계는 JQL 타임존이 계정 설정을 따르므로 날짜 문자열로 안전하게 하루씩
  const created = await searchAll(`created >= "${from}" AND created <= "${to} 23:59"${projJql}`, fields, false);
  for (const is of created) {
    const email = await resolveUserEmail(admin, is.fields.reporter, mapCache);
    if (!email || !is.fields.created) continue;
    bump(kstDay(is.fields.created), email, is.fields.project?.key ?? "?").issues_created += 1;
  }

  // 해결(담당자 기준) + 리드/사이클타임 + 스토리포인트
  const resolved = await searchAll(`resolutiondate >= "${from}" AND resolutiondate <= "${to} 23:59"${projJql}`, fields, true);
  for (const is of resolved) {
    const email = await resolveUserEmail(admin, is.fields.assignee ?? is.fields.reporter, mapCache);
    const rd = is.fields.resolutiondate;
    if (!email || !rd) continue;
    const v = bump(kstDay(rd), email, is.fields.project?.key ?? "?");
    v.issues_resolved += 1;
    if (is.fields.created) v.lead_hours_sum += hoursBetween(is.fields.created, rd);
    const cs = cycleStart(is);
    if (cs) { v.cycle_hours_sum += hoursBetween(cs, rd); v.cycle_count += 1; }
    if (spField) {
      const sp = Number(is.fields[spField]);
      if (Number.isFinite(sp)) v.story_points += sp;
    }
  }

  // 기간 내 날짜만 남기고(계정 타임존 여유분 컷) upsert
  const days = new Set(dayList(from, to));
  const rows = [...agg.values()].filter((r) => days.has(r.day));
  await upsertChunked(admin, "jira_issue_daily", rows, "day,user_email,project_key");
  return { source: "jira", rows: rows.length, notes: `created ${created.length}건, resolved ${resolved.length}건` };
}
