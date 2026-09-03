import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd, numify } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { selectAll } from "@/lib/work-metrics/common";

export const runtime = "nodejs";

/** GET /api/usage/tools?from&to — 개인/조직장용 도구 사용 집계(claude_code_tool_daily, 허용 이메일 범위). users = 도구를 쓴 고유 사용자 수 */
export async function GET(request: NextRequest) {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope, admin } = r;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  const emails = scope.members.map((m) => m.email);

  // 사용자 × 도구 × 일 행이라 조직장 범위에서는 1000행(PostgREST 상한)을 쉽게 넘는다 → selectAll
  type ToolDaily = { user_email: string; tool_name: string; calls: number | string; errors: number | string; duration_ms_sum: number | string; accepts: number | string; rejects: number | string };
  const res = await selectAll<ToolDaily>(() =>
    admin
      .from("claude_code_tool_daily")
      .select("user_email, tool_name, calls, errors, duration_ms_sum, accepts, rejects", { count: "exact" })
      .in("user_email", emails)
      .gte("day", from)
      .lte("day", to)
      .order("day").order("org_id").order("user_email").order("tool_name")
  );
  if (res.error) {
    if (/does not exist|schema cache/i.test(res.error.message)) return NextResponse.json({ range: { from, to }, rows: [], notReady: true });
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }

  const byTool = new Map<string, { tool: string; calls: number; errors: number; duration_ms_sum: number; accepts: number; rejects: number; users: Set<string> }>();
  for (const raw of res.data ?? []) {
    const row = numify(raw as unknown as Record<string, unknown>) as { user_email: string; tool_name: string; calls: number; errors: number; duration_ms_sum: number; accepts: number; rejects: number };
    let t = byTool.get(row.tool_name);
    if (!t) { t = { tool: row.tool_name, calls: 0, errors: 0, duration_ms_sum: 0, accepts: 0, rejects: 0, users: new Set() }; byTool.set(row.tool_name, t); }
    t.calls += row.calls; t.errors += row.errors; t.duration_ms_sum += row.duration_ms_sum; t.accepts += row.accepts; t.rejects += row.rejects;
    t.users.add(row.user_email);
  }
  const rows = [...byTool.values()]
    .map(({ users, ...t }) => ({ ...t, users: users.size }))
    .sort((a, b) => b.calls - a.calls);
  return NextResponse.json({ range: { from, to }, scope: { scopeLabel: scope.scopeLabel }, rows, notReady: false });
}
