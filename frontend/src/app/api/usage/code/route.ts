import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd, numify } from "@/lib/claude-usage/require-admin";
import { addDays, dateRangePreset } from "@/lib/claude-usage/aggregate";
import { selectAll } from "@/lib/work-metrics/common";
import { DAILY_NUMERIC_FIELDS, emptyDailyMetrics, type DailyMetrics, type ModelRow } from "@/types/claude-usage";

export const runtime = "nodejs";

const MAX_DAYS = 366;

/**
 * GET /api/usage/code?from&to — 개인/조직장용 Claude Code 사용량(어드민 아님).
 * 조회 범위는 서버가 resolveUsageScope로 결정(본인 / 조직장이면 말단 조직 전체) — 클라이언트 필터는 표시용일 뿐.
 * 어드민 summary와 같은 구성(totals·users·daily·models)을 허용 이메일 범위로만 내려준다. 프롬프트 내용은 다루지 않는다.
 * 조회는 PostgREST 1000행 상한을 피하기 위해 selectAll로 페이지네이션한다(본부장 범위 × 90일이면 수천 행).
 */
export async function GET(request: NextRequest) {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope, admin } = r;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  if (from > to) return NextResponse.json({ error: "from이 to보다 늦습니다." }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) {
    return NextResponse.json({ error: `기간은 최대 ${MAX_DAYS}일입니다.` }, { status: 400 });
  }

  const emails = scope.members.map((m) => m.email);
  const [dailyRes, modelRes] = await Promise.all([
    selectAll<Record<string, unknown>>(() =>
      admin.from("claude_code_daily").select("*", { count: "exact" }).in("user_email", emails).gte("day", from).lte("day", to).order("day").order("org_id").order("user_email")
    ),
    selectAll<Record<string, unknown>>(() =>
      admin.from("claude_code_daily_model").select("*", { count: "exact" }).in("user_email", emails).gte("day", from).lte("day", to).order("day").order("org_id").order("user_email").order("model")
    ),
  ]);
  if (dailyRes.error) return NextResponse.json({ error: dailyRes.error.message }, { status: 500 });

  const totals: DailyMetrics & { active_days: number; active_users: number } = { ...emptyDailyMetrics(), active_days: 0, active_users: 0 };
  const byUser = new Map<string, DailyMetrics & { active_days: number }>();
  const byDay = new Map<string, { cost_usd: number; sessions: number; prompts: number; users: Set<string> }>();
  const activeDays = new Set<string>();
  const activeEmails = new Set<string>();

  for (const raw of dailyRes.data) {
    const row = numify(raw) as { day: string; user_email: string } & DailyMetrics;
    const email = row.user_email.toLowerCase();
    let u = byUser.get(email);
    if (!u) { u = { ...emptyDailyMetrics(), active_days: 0 }; byUser.set(email, u); }
    const active = row.sessions > 0 || row.prompts > 0 || row.cost_usd > 0;
    let d = byDay.get(row.day);
    if (!d) { d = { cost_usd: 0, sessions: 0, prompts: 0, users: new Set() }; byDay.set(row.day, d); }
    d.cost_usd += row.cost_usd;
    d.sessions += row.sessions;
    d.prompts += row.prompts;
    if (active) {
      u.active_days += 1;
      activeDays.add(`${email}|${row.day}`);
      activeEmails.add(email);
      d.users.add(email);
    }
    for (const f of DAILY_NUMERIC_FIELDS) {
      totals[f] += row[f];
      u[f] += row[f];
    }
  }
  totals.active_days = activeDays.size;
  totals.active_users = activeEmails.size;

  const users = scope.members
    .map((m) => ({
      email: m.email, name: m.name, team: m.team, parent_unit: m.parent_unit, headquarters: m.headquarters, division: m.division,
      ...(byUser.get(m.email) ?? { ...emptyDailyMetrics(), active_days: 0 }),
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd);

  // 기간 내 모든 날을 채워 일별 막대가 날짜 축과 맞게 한다(어드민 summary와 같은 형태)
  const daily: { day: string; cost_usd: number; sessions: number; prompts: number; active_users: number }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const d = byDay.get(day);
    daily.push({ day, cost_usd: d?.cost_usd ?? 0, sessions: d?.sessions ?? 0, prompts: d?.prompts ?? 0, active_users: d?.users.size ?? 0 });
  }

  // 모델별 비용 — 실패해도 요약은 내려준다
  const modelMap = new Map<string, { model: string; cost_usd: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number }>();
  for (const raw of modelRes.data ?? []) {
    const m = numify(raw) as unknown as ModelRow;
    const e = modelMap.get(m.model) ?? { model: m.model, cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
    e.cost_usd += m.cost_usd;
    e.input_tokens += m.input_tokens;
    e.output_tokens += m.output_tokens;
    e.cache_read_tokens += m.cache_read_tokens;
    e.cache_creation_tokens += m.cache_creation_tokens;
    modelMap.set(m.model, e);
  }
  const models = [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd);

  return NextResponse.json({
    range: { from, to },
    scope: { scope: scope.scope, scopeLabel: scope.scopeLabel },
    totals,
    users,
    daily,
    models,
  });
}
