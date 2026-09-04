import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { validateManualMapping } from "@/lib/rfp/mapping/validate";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow } from "@/lib/rfp/mappers";
import { normalizeHttpUrl } from "@/lib/rfp/url";

export const runtime = "nodejs";
type Params = { params: Promise<{ mappingId: string }> };

/** PATCH /api/rfp/mappings/[mappingId] {solutionCode?, featureId?, verdict?, rationale?, evidenceUrl?} → 규칙 검사 → edited=true */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { mappingId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });

  const { data: cur, error: curError } = await auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("id", mappingId).maybeSingle();
  if (curError) return NextResponse.json({ error: curError.message }, { status: 500 });
  if (!cur) return NextResponse.json({ error: "매핑이 없습니다." }, { status: 404 });
  const row = cur as MappingDbRow;

  const patch: Record<string, unknown> = { edited: true, updated_by: auth.userId };
  if ("rationale" in body) {
    if (typeof body.rationale !== "string" || body.rationale.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하의 문자열이어야 합니다." }, { status: 400 });
    patch.rationale = body.rationale.trim();
  }
  if ("evidenceUrl" in body) {
    const urlCheck = normalizeHttpUrl(body.evidenceUrl);
    if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.error }, { status: 400 });
    patch.evidence_url = urlCheck.value;
  }
  const touchesRule = "verdict" in body || "solutionCode" in body || "featureId" in body;
  if (touchesRule) {
    let catalog: Awaited<ReturnType<typeof loadCatalog>>;
    try {
      catalog = await loadCatalog(auth.admin, { activeSolutionsOnly: true });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "카탈로그를 불러오지 못했습니다." }, { status: 500 });
    }
    const siblingsRes = await auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("requirement_id", row.requirement_id).neq("id", mappingId);
    if (siblingsRes.error) return NextResponse.json({ error: siblingsRes.error.message }, { status: 500 });
    const check = validateManualMapping(
      {
        verdict: "verdict" in body ? body.verdict : row.verdict,
        solutionCode: "solutionCode" in body ? body.solutionCode : row.solution_code,
        featureId: "featureId" in body ? body.featureId : row.feature_id,
      },
      catalog,
      ((siblingsRes.data ?? []) as MappingDbRow[]).map(mapMapping),
    );
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    patch.verdict = check.verdict;
    patch.solution_code = check.solutionCode;
    patch.feature_id = check.featureId;
  }
  if (Object.keys(patch).length === 2) return NextResponse.json({ error: "바꿀 필드가 없습니다." }, { status: 400 });

  const { data, error } = await auth.admin.from("rfp_requirement_mappings").update(patch).eq("id", mappingId).select(MAPPING_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(mapMapping(data as MappingDbRow));
}

/** DELETE /api/rfp/mappings/[mappingId] → 204 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { mappingId } = await params;
  const { data, error } = await auth.admin.from("rfp_requirement_mappings").delete().eq("id", mappingId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "매핑이 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
