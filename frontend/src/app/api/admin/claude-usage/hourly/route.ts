import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";

/** GET /api/admin/claude-usage/hourly?from&to&org — 요일×시각(KST) 요청 히트맵(RPC claude_code_hourly, claude_code_requests 기준) */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  const org = sp.get("org");

  const { data, error } = await c.admin.rpc("claude_code_hourly", {
    p_from: from,
    p_to: to,
    p_org: org && org !== "all" ? org : null,
  });
  if (error) {
    if (/could not find|does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ range: { from, to }, cells: [], notReady: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ range: { from, to }, cells: data ?? [], notReady: false });
}
