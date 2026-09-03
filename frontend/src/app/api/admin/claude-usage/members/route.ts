import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, numify } from "@/lib/claude-usage/require-admin";

/**
 * GET /api/admin/claude-usage/members?org=all|<id>&importId=latest|<uuid>&periodEnd=latest|YYYY-MM-DD — CSV 멤버 활동
 * - periodEnd(YYYY-MM-DD): 데이터 기간 종료일이 그 날짜인 CSV 중 조직별 최신 업로드를 고른다(화면의 "데이터 기간" 선택).
 * - importId(uuid): 특정 업로드 하나. 둘 다 없으면 조직별 최신 업로드.
 * 응답 imports는 선택과 무관하게 org 범위의 전체 업로드 목록(기간 옵션용), period는 선택된 CSV들의 데이터 기간.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const org = sp.get("org") ?? "all";
  const importId = sp.get("importId") ?? "latest";
  const periodEnd = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("periodEnd") ?? "") ? (sp.get("periodEnd") as string) : null;

  let importsQ = admin
    .from("claude_csv_imports")
    .select("id, org_id, period_start, period_end, filename, row_count, created_at")
    .order("period_end", { ascending: false })
    .order("created_at", { ascending: false });
  if (org !== "all") importsQ = importsQ.eq("org_id", org);
  const imports = await importsQ;
  if (imports.error) return NextResponse.json({ error: imports.error.message }, { status: 500 });

  type Imp = { id: string; org_id: string; period_start: string; period_end: string };
  const all = (imports.data ?? []) as Imp[];
  let selected: Imp[];
  if (importId !== "latest") {
    selected = all.filter((i) => i.id === importId);
  } else {
    // period_end desc, created_at desc 정렬이라 조직별 첫 항목이 최신 업로드
    const pool = periodEnd ? all.filter((i) => i.period_end === periodEnd) : all;
    const seen = new Map<string, Imp>();
    for (const i of pool) if (!seen.has(i.org_id)) seen.set(i.org_id, i);
    selected = [...seen.values()];
  }
  const ids = selected.map((i) => i.id);
  const period = selected.length
    ? { start: selected.map((i) => i.period_start).sort()[0], end: selected.map((i) => i.period_end).sort().at(-1)! }
    : null;
  const rows = ids.length
    ? await admin.from("claude_member_activity").select("*").in("import_id", ids).order("chats", { ascending: false })
    : { data: [] as Record<string, unknown>[], error: null };
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });

  // 사내 조직도 명부(재직자)로 소속(team/division) 조인 — 실패해도 표는 내려준다
  const directory = await admin.from("company_directory").select("email, name, team, headquarters, division").eq("active", true).limit(1000);
  const dirByEmail = new Map(((directory.error ? [] : directory.data ?? []) as { email: string; name: string | null; team: string | null; headquarters: string | null; division: string | null }[]).map((d) => [d.email.toLowerCase(), d]));
  const withTeam = (rows.data ?? []).map((r) => {
    const rec = numify(r as Record<string, unknown>) as Record<string, unknown>;
    const d = dirByEmail.get(String(rec.email ?? "").toLowerCase());
    return { ...rec, employee_name: d?.name ?? null, team: d?.team ?? null, headquarters: d?.headquarters ?? null, division: d?.division ?? null };
  });
  return NextResponse.json({ imports: all, rows: withTeam, period });
}
