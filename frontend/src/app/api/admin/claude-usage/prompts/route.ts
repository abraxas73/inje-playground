import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";

export const runtime = "nodejs";

/**
 * GET /api/admin/claude-usage/prompts?from&to&org&q&email&limit
 * 수집된 사용자 프롬프트 내용(claude_code_prompts) — 최신순, 기본 200건.
 * q = 내용 부분검색(ilike), email = 사용자 이메일 부분검색. 사내 조직도(이름·팀) 조인.
 * 마이그레이션 전(테이블 없음)이면 notReady로 응답한다.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("7d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  const org = sp.get("org");
  const q = (sp.get("q") ?? "").trim();
  const email = (sp.get("email") ?? "").trim();
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 200));
  const fromTs = `${from}T00:00:00+09:00`;
  const toTs = `${to}T23:59:59.999+09:00`;

  const build = (head: boolean) => {
    let query = head
      ? admin.from("claude_code_prompts").select("*", { count: "exact", head: true })
      : admin.from("claude_code_prompts").select("*").order("ts", { ascending: false }).limit(limit);
    query = query.gte("ts", fromTs).lte("ts", toTs);
    if (org && org !== "all") query = query.eq("org_id", org);
    if (q) query = query.ilike("prompt", `%${q.replace(/[%_]/g, "\\$&")}%`);
    if (email) query = query.ilike("user_email", `%${email.replace(/[%_]/g, "\\$&")}%`);
    return query;
  };

  const [rowsRes, countRes, directory] = await Promise.all([
    build(false),
    build(true),
    admin.from("company_directory").select("email, name, team, headquarters").eq("active", true).limit(1000),
  ]);
  if (rowsRes.error) {
    if (/does not exist|schema cache|could not find/i.test(rowsRes.error.message)) {
      return NextResponse.json({ range: { from, to }, rows: [], total: 0, notReady: true });
    }
    return NextResponse.json({ error: rowsRes.error.message }, { status: 500 });
  }

  const dirByEmail = new Map(
    ((directory.error ? [] : directory.data ?? []) as { email: string; name: string | null; team: string | null; headquarters: string | null }[])
      .map((d) => [d.email.toLowerCase(), d])
  );
  const rows = (rowsRes.data ?? []).map((r) => {
    const d = dirByEmail.get(String(r.user_email).toLowerCase());
    return { ...r, employee_name: d?.name ?? null, team: d?.team ?? null, headquarters: d?.headquarters ?? null };
  });
  return NextResponse.json({ range: { from, to }, rows, total: countRes.count ?? rows.length, notReady: false });
}
