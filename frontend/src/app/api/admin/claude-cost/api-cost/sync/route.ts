import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { isApiCostAvailable, syncApiCost } from "@/lib/claude-cost/anthropic-cost-report";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_DAYS = 93;

/** POST { from, to } — 지금 수집(최대 93일). 키가 없으면 404 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isApiCostAvailable()) return NextResponse.json({ error: "Admin API 키가 설정되지 않았습니다." }, { status: 404 });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const body = (await request.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
  const from = typeof body?.from === "string" ? body.from : null;
  const to = typeof body?.to === "string" ? body.to : null;
  if (!isYmd(from) || !isYmd(to) || from > to) return NextResponse.json({ error: "from·to(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) return NextResponse.json({ error: `기간은 최대 ${MAX_DAYS}일입니다.` }, { status: 400 });
  try {
    const r = await syncApiCost(c.admin, from, to);
    await logAudit(c.admin, request, { userId: auth.userId, action: "claude_cost.api_sync", category: "usage", detail: { from, to, upserted: r.upserted } });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
