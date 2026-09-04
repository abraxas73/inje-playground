import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOLUTION_CODE_RE, SOLUTION_COLUMNS, mapAdminSolution, type SolutionDbRow } from "@/lib/rfp/catalog/store";

export const runtime = "nodejs";

type Counts = { total: number; active: number; sources: number };

/** GET /api/admin/rfp-catalog/solutions — 솔루션 목록 + 기능·활성 기능·소스 건수 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const [sols, feats, srcs] = await Promise.all([
    a.admin.from("rfp_solutions").select(SOLUTION_COLUMNS).order("sort_order").order("code"),
    a.admin.from("rfp_solution_features").select("solution_code, is_active"),
    a.admin.from("rfp_solution_sources").select("solution_code"),
  ]);
  for (const r of [sols, feats, srcs]) if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  const counts = new Map<string, Counts>();
  const bump = (code: string): Counts => {
    let c = counts.get(code);
    if (!c) { c = { total: 0, active: 0, sources: 0 }; counts.set(code, c); }
    return c;
  };
  for (const f of (feats.data ?? []) as { solution_code: string; is_active: boolean }[]) {
    const c = bump(f.solution_code);
    c.total += 1;
    if (f.is_active) c.active += 1;
  }
  for (const s of (srcs.data ?? []) as { solution_code: string }[]) bump(s.solution_code).sources += 1;
  const empty: Counts = { total: 0, active: 0, sources: 0 };
  return NextResponse.json({ solutions: ((sols.data ?? []) as SolutionDbRow[]).map((r) => mapAdminSolution(r, counts.get(r.code) ?? empty)) });
}

/** POST /api/admin/rfp-catalog/solutions {code, name, description?} → 201 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const body = (await request.json().catch(() => null)) as { code?: unknown; name?: unknown; description?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!SOLUTION_CODE_RE.test(code)) return NextResponse.json({ error: "코드는 소문자 영숫자·하이픈 2~30자입니다." }, { status: 400 });
  if (!name || name.length > 100) return NextResponse.json({ error: "이름은 1~100자입니다." }, { status: 400 });
  if (description.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
  const { data: last } = await a.admin.from("rfp_solutions").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await a.admin
    .from("rfp_solutions")
    .insert({ code, name, description, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 1, updated_by: auth.userId })
    .select(SOLUTION_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 코드의 솔루션이 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(mapAdminSolution(data as SolutionDbRow, { total: 0, active: 0, sources: 0 }), { status: 201 });
}
