import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOLUTION_CODE_RE, SOLUTION_COLUMNS, mapAdminSolution, type SolutionDbRow } from "@/lib/rfp/catalog/store";

export const runtime = "nodejs";
type Params = { params: Promise<{ code: string }> };

/** PATCH /api/admin/rfp-catalog/solutions/[code] {name?, description?, isActive?, sortOrder?} — code는 바꿀 수 없다 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  if (!SOLUTION_CODE_RE.test(code)) return NextResponse.json({ error: "잘못된 솔루션 코드입니다." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });
  const patch: Record<string, unknown> = { updated_by: auth.userId };
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) return NextResponse.json({ error: "이름은 1~100자입니다." }, { status: 400 });
    patch.name = body.name.trim();
  }
  if ("description" in body) {
    if (typeof body.description !== "string" || body.description.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
    patch.description = body.description.trim();
  }
  if ("isActive" in body) {
    if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "isActive는 불리언이어야 합니다." }, { status: 400 });
    patch.is_active = body.isActive;
  }
  if ("sortOrder" in body) {
    if (typeof body.sortOrder !== "number" || !Number.isInteger(body.sortOrder)) return NextResponse.json({ error: "sortOrder는 정수여야 합니다." }, { status: 400 });
    patch.sort_order = body.sortOrder;
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "바꿀 필드가 없습니다." }, { status: 400 });
  const { data, error } = await a.admin.from("rfp_solutions").update(patch).eq("code", code).select(SOLUTION_COLUMNS).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });
  const [feats, srcs] = await Promise.all([
    a.admin.from("rfp_solution_features").select("is_active").eq("solution_code", code),
    a.admin.from("rfp_solution_sources").select("id", { count: "exact", head: true }).eq("solution_code", code),
  ]);
  const list = (feats.data ?? []) as { is_active: boolean }[];
  return NextResponse.json(mapAdminSolution(data as SolutionDbRow, { total: list.length, active: list.filter((f) => f.is_active).length, sources: srcs.count ?? 0 }));
}

/** DELETE /api/admin/rfp-catalog/solutions/[code] — 기능·매핑이 참조하면 409(비활성으로 바꾸라고 안내) */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const [feats, maps] = await Promise.all([
    a.admin.from("rfp_solution_features").select("id", { count: "exact", head: true }).eq("solution_code", code),
    a.admin.from("rfp_requirement_mappings").select("id", { count: "exact", head: true }).eq("solution_code", code),
  ]);
  if (feats.error) return NextResponse.json({ error: feats.error.message }, { status: 500 });
  if (maps.error) return NextResponse.json({ error: maps.error.message }, { status: 500 });
  if ((feats.count ?? 0) > 0 || (maps.count ?? 0) > 0) {
    return NextResponse.json({ error: `기능 ${feats.count ?? 0}개·매핑 ${maps.count ?? 0}건이 참조합니다. 삭제 대신 비활성으로 바꾸세요.` }, { status: 409 });
  }
  const { data, error } = await a.admin.from("rfp_solutions").delete().eq("code", code).select("code").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
