import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { numifyOfficeRow, summarizeOffice } from "@/lib/claude-usage/office-usage";
import { parentUnitFromUnits } from "@/lib/usage-scope";

export const runtime = "nodejs";

/**
 * GET /api/admin/claude-usage/office?from&to&org — Claude for M365(Excel·Word·PowerPoint·Outlook) 추가 기능 사용량(admin).
 * RPC claude_office_usage(일·사용자·표면)를 사용자별로 합치고 사내 조직도(이름·소속)를 조인한다.
 * 원천은 조직 설정의 커스텀 OTel 수집기(POST /api/otel/v1/traces)라 수집기를 등록한 Claude 조직만 잡힌다. 함수가 없으면 notReady.
 */
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
  const org = sp.get("org");

  const res = await admin.rpc("claude_office_usage", { p_from: from, p_to: to, p_emails: null, p_org: org && org !== "all" ? org : null });
  if (res.error) {
    if (/could not find|does not exist|schema cache/i.test(res.error.message)) {
      return NextResponse.json({ range: { from, to }, notReady: true, totals: null, users: [], surfaces: [], daily: [] });
    }
    return NextResponse.json({ error: res.error.message }, { status: 500 });
  }
  const summary = summarizeOffice(((res.data ?? []) as Record<string, unknown>[]).map(numifyOfficeRow), from, to);

  // 사내 조직도 명부(재직자)로 이름·소속 조인 — 실패해도 표는 내려준다
  const directory = await admin.from("company_directory").select("email, name, team, headquarters, division, units").eq("active", true).limit(1000);
  type Dir = { email: string; name: string | null; team: string | null; headquarters: string | null; division: string | null; units: string[] | null };
  const dirByEmail = new Map(((directory.error ? [] : directory.data ?? []) as Dir[]).map((d) => [d.email.toLowerCase(), d]));
  const users = summary.users.map((u) => {
    const d = dirByEmail.get(u.user_email);
    return { ...u, employee_name: d?.name ?? null, team: d?.team ?? null, parent_unit: parentUnitFromUnits(d?.units), headquarters: d?.headquarters ?? null, division: d?.division ?? null };
  });

  return NextResponse.json({ range: { from, to }, notReady: false, ...summary, users });
}
