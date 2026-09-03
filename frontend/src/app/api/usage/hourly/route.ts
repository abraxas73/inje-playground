import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";

export const runtime = "nodejs";

/** GET /api/usage/hourly?from&to — 개인/조직장용 시간대 패턴(KST isodow×시각, RPC claude_code_hourly_emails → dow·hour·requests·cost_usd·users). SQL docs/sql/2026-09-03-usage-hourly-users.sql */
export async function GET(request: NextRequest) {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope, admin } = r;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  const emails = scope.members.map((m) => m.email);

  const res = await admin.rpc("claude_code_hourly_emails", { p_from: from, p_to: to, p_emails: emails });
  if (res.error) {
    if (/could not find|does not exist|schema cache/i.test(res.error.message)) {
      return NextResponse.json({ range: { from, to }, cells: [], notReady: true });
    }
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  return NextResponse.json({ range: { from, to }, scope: { scopeLabel: scope.scopeLabel }, cells: res.data ?? [], notReady: false });
}
