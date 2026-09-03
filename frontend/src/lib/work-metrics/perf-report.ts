import type { SupabaseClient } from "@supabase/supabase-js";
import { numify } from "@/lib/claude-usage/require-admin";
import { selectAll } from "./common";

/**
 * 성과 지표 리포트 집계 — 개인용(/api/usage/perf)과 어드민(/api/admin/work-metrics/perf) 공용.
 * Claude 투입(claude_code_daily)과 산출(Jira·GitLab·Confluence 일 집계)을 이메일로 결합한다.
 * filterEmails가 null이면 무필터(전체) — 조직도 밖 이메일(퇴사자 등)도 데이터에 있으면 포함된다.
 *
 * 커밋 지표 두 가지는 모집단이 다르다:
 *  - claude_commits: OTel claude_code.commit.count — Claude Code가 실행한 git commit 수. 저장소 무관(GitHub·로컬 포함).
 *  - commits / gitlab_claude_commits: 사내 GitLab 커밋과 그중 Co-Authored-By: Claude 트레일러 커밋. 비중은 이 둘로 계산한다.
 */

export interface PerfMember {
  email: string;
  name: string | null;
  team: string | null;
}

export interface UserPerf {
  email: string;
  name: string | null;
  team: string | null;
  claude_cost: number;
  claude_sessions: number;
  claude_days: number;
  claude_commits: number;
  /** 사람이 친 Claude Code 프롬프트(자동화 제외) */
  claude_prompts: number;
  active_hours: number;
  loc_added: number;
  loc_removed: number;
  issues_created: number;
  issues_resolved: number;
  story_points: number;
  cycle_hours_sum: number;
  cycle_count: number;
  lead_hours_sum: number;
  /** GitLab 커밋(authored 기준, 리베이스 중복 제거) */
  commits: number;
  /** GitLab 커밋 중 Co-Authored-By: Claude 트레일러가 있는 커밋 — commits의 부분집합(하한값) */
  gitlab_claude_commits: number;
  mrs_opened: number;
  mrs_merged: number;
  mr_lead_hours_sum: number;
  pages_created: number;
  pages_updated: number;
}

export interface Weekly {
  week: string;
  claude_sessions: number;
  claude_cost: number;
  claude_commits: number;
  claude_prompts: number;
  issues_created: number;
  issues_resolved: number;
  story_points: number;
  cycle_hours_sum: number;
  cycle_count: number;
  commits: number;
  gitlab_claude_commits: number;
  mrs_opened: number;
  mrs_merged: number;
  mr_lead_hours_sum: number;
  pages_created: number;
  pages_updated: number;
}

export interface PerfReport {
  notReady: boolean;
  users: UserPerf[];
  weekly: Weekly[];
  jiraProjects: Array<{ key: string; issues_created: number; issues_resolved: number; story_points: number; cycle_hours_sum: number; cycle_count: number }>;
  repos: Array<{ key: string; commits: number; gitlab_claude_commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number }>;
  spaces: Array<{ key: string; pages_created: number; pages_updated: number }>;
}

/** KST 날짜 → 그 주 월요일(주 키) */
function weekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  return new Date(d.getTime() - dow * 86400_000).toISOString().slice(0, 10);
}

export async function buildPerfReport(
  admin: SupabaseClient,
  opts: { from: string; to: string; members: PerfMember[]; filterEmails: string[] | null }
): Promise<{ ok: true; report: PerfReport } | { ok: false; error: string }> {
  const { from, to, members, filterEmails } = opts;

  // Supabase 응답 상한(1000행)에 잘리지 않도록 PK 순서로 끝까지 페이지 조회 — 90일 전사 범위는 테이블당 수천 행
  const q = (table: string, cols: string, orderBy: string[]) =>
    selectAll<Record<string, unknown>>(() => {
      let b = admin.from(table).select(cols, { count: "exact" }).gte("day", from).lte("day", to);
      if (filterEmails) b = b.in("user_email", filterEmails);
      for (const k of orderBy) b = b.order(k);
      return b;
    });
  const [code, jira, gitlab, conf] = await Promise.all([
    q("claude_code_daily", "day, user_email, cost_usd, sessions, prompts, prompts_auto, commits, pull_requests, loc_added, loc_removed, active_user_seconds", ["day", "org_id", "user_email"]),
    q("jira_issue_daily", "day, user_email, project_key, issues_created, issues_resolved, story_points, cycle_hours_sum, cycle_count, lead_hours_sum", ["day", "user_email", "project_key"]),
    q("gitlab_daily", "day, user_email, project_path, commits, claude_commits, mrs_opened, mrs_merged, mr_lead_hours_sum", ["day", "user_email", "project_path"]),
    q("confluence_daily", "day, user_email, space_key, pages_created, pages_updated", ["day", "user_email", "space_key"]),
  ]);
  const missing = [jira, gitlab, conf].some((x) => x.error && /does not exist|schema cache/i.test(x.error.message));
  for (const [name, res] of [["claude", code], ["jira", jira], ["gitlab", gitlab], ["confluence", conf]] as const) {
    if (res.error && !/does not exist|schema cache/i.test(res.error.message)) {
      return { ok: false, error: `${name}: ${res.error.message}` };
    }
  }

  const memberMap = new Map(members.map((m) => [m.email, m]));
  const byUser = new Map<string, UserPerf>();
  const userOf = (email: string): UserPerf => {
    let u = byUser.get(email);
    if (!u) {
      const m = memberMap.get(email);
      u = {
        email, name: m?.name ?? null, team: m?.team ?? null,
        claude_cost: 0, claude_sessions: 0, claude_days: 0, claude_commits: 0, claude_prompts: 0, active_hours: 0, loc_added: 0, loc_removed: 0,
        issues_created: 0, issues_resolved: 0, story_points: 0, cycle_hours_sum: 0, cycle_count: 0, lead_hours_sum: 0,
        commits: 0, gitlab_claude_commits: 0, mrs_opened: 0, mrs_merged: 0, mr_lead_hours_sum: 0, pages_created: 0, pages_updated: 0,
      };
      byUser.set(email, u);
    }
    return u;
  };
  const weekly = new Map<string, Weekly>();
  const weekOfDay = (day: string): Weekly => {
    const w = weekOf(day);
    let v = weekly.get(w);
    if (!v) {
      v = { week: w, claude_sessions: 0, claude_cost: 0, claude_commits: 0, claude_prompts: 0, issues_created: 0, issues_resolved: 0, story_points: 0, cycle_hours_sum: 0, cycle_count: 0, commits: 0, gitlab_claude_commits: 0, mrs_opened: 0, mrs_merged: 0, mr_lead_hours_sum: 0, pages_created: 0, pages_updated: 0 };
      weekly.set(w, v);
    }
    return v;
  };
  const dim = <T extends Record<string, number>>() => new Map<string, T>();
  const jiraProjects = dim<{ issues_created: number; issues_resolved: number; story_points: number; cycle_hours_sum: number; cycle_count: number }>();
  const repos = dim<{ commits: number; gitlab_claude_commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number }>();
  const spaces = dim<{ pages_created: number; pages_updated: number }>();

  for (const raw of code.data ?? []) {
    const row = numify(raw as unknown as Record<string, unknown>) as { day: string; user_email: string; cost_usd: number; sessions: number; prompts: number; prompts_auto: number; commits: number; pull_requests: number; loc_added: number; loc_removed: number; active_user_seconds: number };
    const humanPrompts = row.prompts - row.prompts_auto; // 사람이 친 프롬프트만(자동화 제외)
    const u = userOf(row.user_email.toLowerCase());
    u.claude_cost += row.cost_usd; u.claude_sessions += row.sessions; u.claude_days += 1; u.claude_commits += row.commits;
    u.claude_prompts += humanPrompts; u.active_hours += row.active_user_seconds / 3600; u.loc_added += row.loc_added; u.loc_removed += row.loc_removed;
    const w = weekOfDay(row.day); w.claude_sessions += row.sessions; w.claude_cost += row.cost_usd; w.claude_commits += row.commits; w.claude_prompts += humanPrompts;
  }
  for (const raw of jira.data ?? []) {
    const row = numify(raw as unknown as Record<string, unknown>) as { day: string; user_email: string; project_key: string; issues_created: number; issues_resolved: number; story_points: number; cycle_hours_sum: number; cycle_count: number; lead_hours_sum: number };
    const u = userOf(row.user_email.toLowerCase());
    u.issues_created += row.issues_created; u.issues_resolved += row.issues_resolved; u.story_points += row.story_points;
    u.cycle_hours_sum += row.cycle_hours_sum; u.cycle_count += row.cycle_count; u.lead_hours_sum += row.lead_hours_sum;
    const w = weekOfDay(row.day); w.issues_created += row.issues_created; w.issues_resolved += row.issues_resolved; w.story_points += row.story_points; w.cycle_hours_sum += row.cycle_hours_sum; w.cycle_count += row.cycle_count;
    const p = jiraProjects.get(row.project_key) ?? { issues_created: 0, issues_resolved: 0, story_points: 0, cycle_hours_sum: 0, cycle_count: 0 };
    p.issues_created += row.issues_created; p.issues_resolved += row.issues_resolved; p.story_points += row.story_points; p.cycle_hours_sum += row.cycle_hours_sum; p.cycle_count += row.cycle_count;
    jiraProjects.set(row.project_key, p);
  }
  for (const raw of gitlab.data ?? []) {
    const row = numify(raw as unknown as Record<string, unknown>) as { day: string; user_email: string; project_path: string; commits: number; claude_commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number };
    const u = userOf(row.user_email.toLowerCase());
    u.commits += row.commits; u.gitlab_claude_commits += row.claude_commits; u.mrs_opened += row.mrs_opened; u.mrs_merged += row.mrs_merged; u.mr_lead_hours_sum += row.mr_lead_hours_sum;
    const w = weekOfDay(row.day); w.commits += row.commits; w.gitlab_claude_commits += row.claude_commits; w.mrs_opened += row.mrs_opened; w.mrs_merged += row.mrs_merged; w.mr_lead_hours_sum += row.mr_lead_hours_sum;
    const p = repos.get(row.project_path) ?? { commits: 0, gitlab_claude_commits: 0, mrs_opened: 0, mrs_merged: 0, mr_lead_hours_sum: 0 };
    p.commits += row.commits; p.gitlab_claude_commits += row.claude_commits; p.mrs_opened += row.mrs_opened; p.mrs_merged += row.mrs_merged; p.mr_lead_hours_sum += row.mr_lead_hours_sum;
    repos.set(row.project_path, p);
  }
  for (const raw of conf.data ?? []) {
    const row = numify(raw as unknown as Record<string, unknown>) as { day: string; user_email: string; space_key: string; pages_created: number; pages_updated: number };
    const u = userOf(row.user_email.toLowerCase());
    u.pages_created += row.pages_created; u.pages_updated += row.pages_updated;
    const w = weekOfDay(row.day); w.pages_created += row.pages_created; w.pages_updated += row.pages_updated;
    const p = spaces.get(row.space_key) ?? { pages_created: 0, pages_updated: 0 };
    p.pages_created += row.pages_created; p.pages_updated += row.pages_updated;
    spaces.set(row.space_key, p);
  }

  // 데이터가 없는 구성원도 0으로 채워 목록에 포함(활동 없음이 보이도록)
  for (const m of members) userOf(m.email);
  const users = [...byUser.values()].sort((a, b) => b.issues_resolved - a.issues_resolved);
  const top = <T>(m: Map<string, T>, key: (v: T) => number, n = 25) =>
    [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => key(b as T) - key(a as T)).slice(0, n);

  return {
    ok: true,
    report: {
      notReady: missing,
      users,
      weekly: [...weekly.values()].sort((a, b) => (a.week < b.week ? -1 : 1)),
      jiraProjects: top(jiraProjects, (v) => v.issues_resolved),
      repos: top(repos, (v) => v.commits),
      spaces: top(spaces, (v) => v.pages_created + v.pages_updated),
    },
  };
}
