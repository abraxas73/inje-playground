import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd, numify } from "@/lib/claude-usage/require-admin";
import { dateRangePreset, summarize } from "@/lib/claude-usage/aggregate";
import type { ClaudeOrg, DailyRow, ModelRow } from "@/types/claude-usage";

const MAX_DAYS = 366;

/** GET /api/admin/claude-usage/summary?from&to&org — Claude Code(OTel) 요약 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  if (from > to) return NextResponse.json({ error: "from이 to보다 늦습니다." }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) {
    return NextResponse.json({ error: `기간은 최대 ${MAX_DAYS}일입니다.` }, { status: 400 });
  }
  const org = sp.get("org");

  let dailyQ = admin.from("claude_code_daily").select("*").gte("day", from).lte("day", to);
  let modelQ = admin.from("claude_code_daily_model").select("*").gte("day", from).lte("day", to);
  if (org && org !== "all") {
    dailyQ = dailyQ.eq("org_id", org);
    modelQ = modelQ.eq("org_id", org);
  }
  const [daily, models, orgs, imports] = await Promise.all([
    dailyQ,
    modelQ,
    admin.from("claude_orgs").select("id, name, seats_total, sort_order").order("sort_order").order("name"),
    admin.from("claude_csv_imports").select("id, org_id, period_end").order("period_end", { ascending: false }),
  ]);
  const err = daily.error ?? models.error ?? orgs.error ?? imports.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  // 조직별 최신 import 1개씩 → 이름/티어 조인용
  const latestByOrg = new Map<string, string>();
  for (const i of imports.data ?? []) if (!latestByOrg.has(i.org_id)) latestByOrg.set(i.org_id, i.id);
  const importIds = [...latestByOrg.values()];
  const members = importIds.length
    ? await admin.from("claude_member_activity").select("email, name, seat_tier").in("import_id", importIds)
    : { data: [] as { email: string; name: string; seat_tier: string }[], error: null };
  if (members.error) return NextResponse.json({ error: members.error.message }, { status: 500 });

  const summary = summarize({
    rows: (daily.data ?? []).map((r) => numify(r as Record<string, unknown>)) as unknown as DailyRow[],
    models: (models.data ?? []).map((r) => numify(r as Record<string, unknown>)) as unknown as ModelRow[],
    orgs: (orgs.data ?? []) as ClaudeOrg[],
    members: (members.data ?? []) as { email: string; name: string; seat_tier: string }[],
    from,
    to,
  });
  return NextResponse.json(summary);
}
