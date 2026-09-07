import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { numifyOfficeRow, summarizeOffice } from "@/lib/claude-usage/office-usage";

export const runtime = "nodejs";

/**
 * GET /api/usage/office?from&to — 개인/조직장용 Claude for M365(Excel·Word·PowerPoint·Outlook) 추가 기능 사용량(어드민 아님).
 * 범위는 서버가 resolveUsageScope로 결정하고 RPC claude_office_usage에 허용 이메일만 넘긴다. 프롬프트 내용은 다루지 않는다.
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
  const scopeOut = { scope: scope.scope, scopeLabel: scope.scopeLabel };

  const emails = scope.members.map((m) => m.email);
  const res = await admin.rpc("claude_office_usage", { p_from: from, p_to: to, p_emails: emails, p_org: null });
  if (res.error) {
    if (/could not find|does not exist|schema cache/i.test(res.error.message)) {
      return NextResponse.json({ range: { from, to }, scope: scopeOut, notReady: true, totals: null, users: [], surfaces: [], daily: [] });
    }
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  const summary = summarizeOffice(((res.data ?? []) as Record<string, unknown>[]).map(numifyOfficeRow), from, to);
  const memberOf = new Map(scope.members.map((m) => [m.email, m]));
  const users = summary.users.map((u) => {
    const m = memberOf.get(u.user_email);
    return { ...u, employee_name: m?.name ?? null, team: m?.team ?? null, parent_unit: m?.parent_unit ?? null, headquarters: m?.headquarters ?? null, division: m?.division ?? null };
  });

  return NextResponse.json({ range: { from, to }, scope: scopeOut, notReady: false, ...summary, users });
}
