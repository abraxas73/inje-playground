import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd, numify } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";

export const runtime = "nodejs";

/**
 * GET /api/usage/perf?from&to — 개인/팀장용 성과 지표(어드민 아님).
 * Claude 투입(claude_code_daily)과 산출(Jira·GitLab·Confluence 일 집계)을 이메일로 결합.
 * 범위는 서버가 resolveUsageScope로 결정(본인/팀/본부).
 */

interface UserPerf {
  email: string;
  name: string | null;
  team: string | null;
  claude_cost: number;
  claude_sessions: number;
  claude_days: number;
  claude_commits: number;
  issues_created: number;
  issues_resolved: number;
  story_points: number;
  cycle_hours_sum: number;
  cycle_count: number;
  lead_hours_sum: number;
  commits: number;
  mrs_opened: number;
  mrs_merged: number;
  mr_lead_hours_sum: number;
  pages_created: number;
  pages_updated: number;
}

/** KST 날짜 → 그 주 월요일(주 키) */
function weekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  return new Date(d.getTime() - dow * 86400_000).toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope, admin } = r;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  const emails = scope.members.map((m) => m.email);

  const q = (table: string, cols: string) =>
    admin.from(table).select(cols).in("user_email", emails).gte("day", from).lte("day", to).limit(20000);
  const [code, jira, gitlab, conf] = await Promise.all([
    q("claude_code_daily", "day, user_email, cost_usd, sessions, commits, pull_requests"),
    q("jira_issue_daily", "day, user_email, issues_created, issues_resolved, story_points, cycle_hours_sum, cycle_count, lead_hours_sum"),
    q("gitlab_daily", "day, user_email, commits, mrs_opened, mrs_merged, mr_lead_hours_sum"),
    q("confluence_daily", "day, user_email, pages_created, pages_updated"),
  ]);
  const missing = [jira, gitlab, conf].some((x) => x.error && /does not exist|schema cache/i.test(x.error.message));
  for (const [name, res] of [["claude", code], ["jira", jira], ["gitlab", gitlab], ["confluence", conf]] as const) {
    if (res.error && !/does not exist|schema cache/i.test(res.error.message)) {
      return NextResponse.json({ error: `${name}: ${res.error.message}` }, { status: 500 });
    }
  }

  const byUser = new Map<string, UserPerf>();
  const userOf = (email: string): UserPerf => {
    let u = byUser.get(email);
    if (!u) {
      const m = scope.members.find((x) => x.email === email);
      u = { email, name: m?.name ?? null, team: m?.team ?? null, claude_cost: 0, claude_sessions: 0, claude_days: 0, claude_commits: 0, issues_created: 0, issues_resolved: 0, story_points: 0, cycle_hours_sum: 0, cycle_count: 0, lead_hours_sum: 0, commits: 0, mrs_opened: 0, mrs_merged: 0, mr_lead_hours_sum: 0, pages_created: 0, pages_updated: 0 };
      byUser.set(email, u);
    }
    return u;
  };
  const weekly = new Map<string, { week: string; claude_sessions: number; claude_cost: number; issues_resolved: number; commits: number; mrs_merged: number; pages: number }>();
  const weekOfDay = (day: string) => {
    const w = weekOf(day);
    let v = weekly.get(w);
    if (!v) { v = { week: w, claude_sessions: 0, claude_cost: 0, issues_resolved: 0, commits: 0, mrs_merged: 0, pages: 0 }; weekly.set(w, v); }
    return v;
  };

  for (const raw of code.data ?? []) {
    const row = numify(raw as unknown as Record<string, unknown>) as { day: string; user_email: string; cost_usd: number; sessions: number; commits: number; pull_requests: number };
    const u = userOf(row.user_email.toLowerCase());
    u.claude_cost += row.cost_usd; u.claude_sessions += row.sessions; u.claude_days += 1; u.claude_commits += row.commits;
    const w = weekOfDay(row.day); w.claude_sessions += row.sessions; w.claude_cost += row.cost_usd;
  }
  for (const raw of jira.data ?? []) {
    const row = numify(raw as unknown as Record<string, unknown>) as { day: string; user_email: string; issues_created: number; issues_resolved: number; story_points: number; cycle_hours_sum: number; cycle_count: number; lead_hours_sum: number };
    const u = userOf(row.user_email.toLowerCase());
    u.issues_created += row.issues_created; u.issues_resolved += row.issues_resolved; u.story_points += row.story_points;
    u.cycle_hours_sum += row.cycle_hours_sum; u.cycle_count += row.cycle_count; u.lead_hours_sum += row.lead_hours_sum;
    weekOfDay(row.day).issues_resolved += row.issues_resolved;
  }
  for (const raw of gitlab.data ?? []) {
    const row = numify(raw as unknown as Record<string, unknown>) as { day: string; user_email: string; commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number };
    const u = userOf(row.user_email.toLowerCase());
    u.commits += row.commits; u.mrs_opened += row.mrs_opened; u.mrs_merged += row.mrs_merged; u.mr_lead_hours_sum += row.mr_lead_hours_sum;
    const w = weekOfDay(row.day); w.commits += row.commits; w.mrs_merged += row.mrs_merged;
  }
  for (const raw of conf.data ?? []) {
    const row = numify(raw as unknown as Record<string, unknown>) as { day: string; user_email: string; pages_created: number; pages_updated: number };
    const u = userOf(row.user_email.toLowerCase());
    u.pages_created += row.pages_created; u.pages_updated += row.pages_updated;
    weekOfDay(row.day).pages += row.pages_created + row.pages_updated;
  }

  const users = scope.members
    .map((m) => byUser.get(m.email) ?? { ...userOf(m.email) })
    .sort((a, b) => b.issues_resolved - a.issues_resolved);

  return NextResponse.json({
    range: { from, to },
    scope: { scope: scope.scope, scopeLabel: scope.scopeLabel },
    notReady: missing,
    users,
    weekly: [...weekly.values()].sort((a, b) => (a.week < b.week ? -1 : 1)),
  });
}
