import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";

/** GET /api/admin/claude-usage/tools?from&to&org — 도구별 사용 합계(RPC claude_code_tool_summary). 마이그레이션 전이면 notReady */
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

  const { data, error } = await c.admin.rpc("claude_code_tool_summary", {
    p_from: from,
    p_to: to,
    p_org: org && org !== "all" ? org : null,
  });
  if (error) {
    // 함수가 아직 없으면(마이그레이션 전) 빈 결과로 응답해 화면이 안내를 띄우게 한다
    if (/could not find|does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ range: { from, to }, byTool: [], notReady: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ range: { from, to }, byTool: data ?? [], notReady: false });
}
