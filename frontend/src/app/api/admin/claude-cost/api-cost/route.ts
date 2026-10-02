import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { isApiCostAvailable } from "@/lib/claude-cost/anthropic-cost-report";
import { selectAll } from "@/lib/work-metrics/common";
import { allocateCostByKey } from "@/lib/claude-cost/api-key-usage";
import type { ApiCostRow, ApiKeyInfo, ApiUsageRow } from "@/types/claude-cost";

/** GET ?from&to — Admin API 일별 비용(기본 30일). 키가 없으면 available:false만(화면은 탭을 그리지 않는다) */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isApiCostAvailable()) return NextResponse.json({ available: false, rows: [], keys: [], keyRows: [], lastSyncedAt: null });
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
  const [usage, keys] = await Promise.all([
    selectAll<ApiUsageRow>(() => c.admin.from("claude_api_usage_daily").select("day, api_key_id, model, uncached_input, cache_write_5m, cache_write_1h, cache_read, output, web_search", { count: "exact" }).gte("day", from).lte("day", to).order("day").order("api_key_id").order("model")),
    c.admin.from("claude_api_keys").select("id, name, status, workspace_id, hint, created_at").order("name"),
  ]);
  if (usage.error || keys.error) return NextResponse.json({ error: (usage.error ?? keys.error)!.message }, { status: 500 });
  const costRows = rows.data.map(({ synced_at: _s, ...r }) => ({ ...r, amount_cents: String(r.amount_cents) }));
  const last = await c.admin.from("claude_api_cost_daily").select("synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({
    available: true,
    rows: costRows,
    keys: (keys.data ?? []) as ApiKeyInfo[],
    keyRows: allocateCostByKey(costRows, usage.data.map((u) => ({ ...u, uncached_input: Number(u.uncached_input), cache_write_5m: Number(u.cache_write_5m), cache_write_1h: Number(u.cache_write_1h), cache_read: Number(u.cache_read), output: Number(u.output) }))),
    lastSyncedAt: (last.data?.synced_at as string | undefined) ?? null,
  });
}
