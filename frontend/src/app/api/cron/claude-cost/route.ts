import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { addDays } from "@/lib/claude-usage/aggregate";
import { isApiCostAvailable, syncApiCost } from "@/lib/claude-cost/anthropic-cost-report";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/cron/claude-cost — Admin API cost_report 최근 3일 재수집(값이 사후 보정되므로 하루치만 받지 않는다).
 * 인증: Vercel Cron(Authorization: Bearer CRON_SECRET) 또는 관리자 세션. 키가 없으면 건너뛴다.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || bearer !== secret) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  if (!isApiCostAvailable()) return NextResponse.json({ skipped: "no_key" });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const to = new Date().toISOString().slice(0, 10);
  const from = addDays(to, -3);
  try {
    const r = await syncApiCost(c.admin, from, to);
    return NextResponse.json({ from, to, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
