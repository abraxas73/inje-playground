import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { FEATURE_COLUMNS, mapAdminFeature, type FeatureDbRow } from "@/lib/rfp/catalog/store";
import { FEATURE_NAME_MAX, normalizeFeatureName } from "@/lib/rfp/catalog/merge-features";

export const runtime = "nodejs";
type Params = { params: Promise<{ featureId: string }> };

/** PATCH /api/admin/rfp-catalog/features/[featureId] {name?, description?, evidenceUrl?, isActive?, sortOrder?} — 어떤 필드든 바꾸면 edited=true */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { featureId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });
  const patch: Record<string, unknown> = { edited: true, updated_by: auth.userId };
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > FEATURE_NAME_MAX) {
      return NextResponse.json({ error: `기능 이름은 1~${FEATURE_NAME_MAX}자입니다.` }, { status: 400 });
    }
    patch.name = body.name.trim();
    patch.name_norm = normalizeFeatureName(body.name);
  }
  if ("description" in body) {
    if (typeof body.description !== "string" || body.description.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
    patch.description = body.description.trim();
  }
  if ("evidenceUrl" in body) {
    if (body.evidenceUrl !== null && typeof body.evidenceUrl !== "string") return NextResponse.json({ error: "evidenceUrl은 문자열 또는 null이어야 합니다." }, { status: 400 });
    const v = typeof body.evidenceUrl === "string" ? body.evidenceUrl.trim() : "";
    if (v.length > 2000) return NextResponse.json({ error: "근거 URL이 너무 깁니다." }, { status: 400 });
    patch.evidence_url = v || null;
  }
  if ("isActive" in body) {
    if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "isActive는 불리언이어야 합니다." }, { status: 400 });
    patch.is_active = body.isActive;
  }
  if ("sortOrder" in body) {
    if (typeof body.sortOrder !== "number" || !Number.isInteger(body.sortOrder)) return NextResponse.json({ error: "sortOrder는 정수여야 합니다." }, { status: 400 });
    patch.sort_order = body.sortOrder;
  }
  if (Object.keys(patch).length === 2) return NextResponse.json({ error: "바꿀 필드가 없습니다." }, { status: 400 });
  const { data, error } = await a.admin.from("rfp_solution_features").update(patch).eq("id", featureId).select(FEATURE_COLUMNS).maybeSingle();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 이름의 기능이 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "기능이 없습니다." }, { status: 404 });
  const { count } = await a.admin.from("rfp_requirement_mappings").select("id", { count: "exact", head: true }).eq("feature_id", featureId);
  return NextResponse.json(mapAdminFeature(data as FeatureDbRow, count ?? 0));
}

/** DELETE /api/admin/rfp-catalog/features/[featureId] — 매핑이 참조하면 409 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { featureId } = await params;
  const { count, error: countError } = await a.admin.from("rfp_requirement_mappings").select("id", { count: "exact", head: true }).eq("feature_id", featureId);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  if ((count ?? 0) > 0) return NextResponse.json({ error: `매핑 ${count}건이 참조합니다. 삭제 대신 비활성으로 바꾸세요.` }, { status: 409 });
  const { data, error } = await a.admin.from("rfp_solution_features").delete().eq("id", featureId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "기능이 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
