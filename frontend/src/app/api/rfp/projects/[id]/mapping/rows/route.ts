import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { validateManualMapping } from "@/lib/rfp/mapping/validate";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow } from "@/lib/rfp/mappers";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** POST /api/rfp/projects/[id]/mapping/rows {requirementId, solutionCode?, featureId?, verdict, rationale?, evidenceUrl?} → edited=true, 201 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.requirementId !== "string") return NextResponse.json({ error: "requirementId가 필요합니다." }, { status: 400 });
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  const evidenceUrl = typeof body.evidenceUrl === "string" && body.evidenceUrl.trim() ? body.evidenceUrl.trim() : null;
  if (rationale.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
  if (evidenceUrl && evidenceUrl.length > 2000) return NextResponse.json({ error: "근거 URL이 너무 깁니다." }, { status: 400 });

  const { data: req, error: reqError } = await auth.admin.from("rfp_requirements").select("id, project_id").eq("id", body.requirementId).maybeSingle();
  if (reqError) return NextResponse.json({ error: reqError.message }, { status: 500 });
  if (!req || req.project_id !== id) return NextResponse.json({ error: "요구사항이 없습니다." }, { status: 404 });

  let catalog: Awaited<ReturnType<typeof loadCatalog>>;
  try {
    catalog = await loadCatalog(auth.admin, { activeSolutionsOnly: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "카탈로그를 불러오지 못했습니다." }, { status: 500 });
  }
  const siblingsRes = await auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("requirement_id", req.id).order("sort_order");
  if (siblingsRes.error) return NextResponse.json({ error: siblingsRes.error.message }, { status: 500 });
  const siblings = ((siblingsRes.data ?? []) as MappingDbRow[]).map(mapMapping);
  const check = validateManualMapping({ verdict: body.verdict, solutionCode: body.solutionCode, featureId: body.featureId }, catalog, siblings);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1;
  const { data, error } = await auth.admin
    .from("rfp_requirement_mappings")
    .insert({
      project_id: id, requirement_id: req.id, solution_code: check.solutionCode, feature_id: check.featureId, verdict: check.verdict,
      rationale, evidence_url: evidenceUrl, edited: true, sort_order: sortOrder, updated_by: auth.userId,
    })
    .select(MAPPING_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(mapMapping(data as MappingDbRow), { status: 201 });
}
