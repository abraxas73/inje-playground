import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd, numify } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { DAILY_NUMERIC_FIELDS, emptyDailyMetrics, type DailyMetrics } from "@/types/claude-usage";

/**
 * GET /api/usage/code?from&to — 개인/팀장용 Claude Code 사용량(어드민 아님).
 * 조회 범위는 서버가 resolveUsageScope로 결정(본인 / 팀장이면 팀 / 임원이면 본부).
 */
export async function GET(request: NextRequest) {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope, admin } = r;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;

  const emails = scope.members.map((m) => m.email);
  const res = await admin
    .from("claude_code_daily")
    .select("*")
    .in("user_email", emails)
    .gte("day", from)
    .lte("day", to)
    .limit(20000);
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });

  const totals: DailyMetrics & { active_days: number } = { ...emptyDailyMetrics(), active_days: 0 };
  const byUser = new Map<string, DailyMetrics & { active_days: number }>();
  const byDay = new Map<string, { day: string; cost_usd: number; sessions: number; prompts: number }>();
  const activeDays = new Set<string>();

  for (const raw of res.data ?? []) {
    const row = numify(raw as Record<string, unknown>) as { day: string; user_email: string } & DailyMetrics;
    const email = row.user_email.toLowerCase();
    let u = byUser.get(email);
    if (!u) { u = { ...emptyDailyMetrics(), active_days: 0 }; byUser.set(email, u); }
    u.active_days += 1;
    activeDays.add(`${email}|${row.day}`);
    let d = byDay.get(row.day);
    if (!d) { d = { day: row.day, cost_usd: 0, sessions: 0, prompts: 0 }; byDay.set(row.day, d); }
    d.cost_usd += row.cost_usd;
    d.sessions += row.sessions;
    d.prompts += row.prompts;
    for (const f of DAILY_NUMERIC_FIELDS) {
      totals[f] += row[f];
      u[f] += row[f];
    }
  }
  totals.active_days = activeDays.size;

  const users = scope.members
    .map((m) => ({ email: m.email, name: m.name, team: m.team, ...(byUser.get(m.email) ?? { ...emptyDailyMetrics(), active_days: 0 }) }))
    .sort((a, b) => b.cost_usd - a.cost_usd);

  return NextResponse.json({
    range: { from, to },
    scope: { scope: scope.scope, scopeLabel: scope.scopeLabel },
    totals,
    users,
    daily: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
  });
}
