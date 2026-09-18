import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { isApiCostAvailable } from "@/lib/claude-cost/anthropic-cost-report";
import { selectAll } from "@/lib/work-metrics/common";
import type { ApiCostRow } from "@/types/claude-cost";

/** GET ?from&to — Admin API 일별 비용(기본 30일). 키가 없으면 available:false만(화면은 탭을 그리지 않는다) */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isApiCostAvailable()) return NextResponse.json({ available: false, rows: [], lastSyncedAt: null });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  if (from > to) return NextResponse.json({ error: "from이 to보다 늦습니다." }, { status: 400 });
  const rows = await selectAll<ApiCostRow & { synced_at: string }>(() =>
    c.admin.from("claude_api_cost_daily").select("day, workspace_id, description, cost_type, model, amount_cents, currency, synced_at", { count: "exact" }).gte("day", from).lte("day", to).order("day").order("workspace_id").order("description"),
  );
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });
  const last = await c.admin.from("claude_api_cost_daily").select("synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({
    available: true,
    rows: rows.data.map(({ synced_at: _s, ...r }) => ({ ...r, amount_cents: String(r.amount_cents) })),
    lastSyncedAt: (last.data?.synced_at as string | undefined) ?? null,
  });
}
