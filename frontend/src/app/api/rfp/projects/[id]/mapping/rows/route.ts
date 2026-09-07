import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { validateManualMapping } from "@/lib/rfp/mapping/validate";
import { detailUnitMap } from "@/lib/rfp/mapping/detail-items";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow } from "@/lib/rfp/mappers";
import { normalizeHttpUrl } from "@/lib/rfp/url";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/rfp/projects/[id]/mapping/rows {requirementId, detailKey?, solutionCode?, featureId?, verdict, rationale?, evidenceUrl?} → edited=true, 201
 * detailKey를 주면 그 세부 항목 단위로 넣는다(같은 단위의 행끼리만 판정 조합 규칙을 검사).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.requirementId !== "string") return NextResponse.json({ error: "requirementId가 필요합니다." }, { status: 400 });
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  if (rationale.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
  const urlCheck = normalizeHttpUrl(body.evidenceUrl);
  if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.error }, { status: 400 });
  const evidenceUrl = urlCheck.value;

  const { data: req, error: reqError } = await auth.admin.from("rfp_requirements").select("id, project_id, details").eq("id", body.requirementId).maybeSingle();
  if (reqError) return NextResponse.json({ error: reqError.message }, { status: 500 });
  if (!req || req.project_id !== id) return NextResponse.json({ error: "요구사항이 없습니다." }, { status: 404 });

  // 세부 항목 단위 지정(선택). 세부 내용에서 실제로 뽑히는 키만 허용한다.
  const rawKey = typeof body.detailKey === "string" ? body.detailKey.trim() : "";
  const units = detailUnitMap(String((req as { details?: unknown }).details ?? ""));
  if (rawKey && !units.has(rawKey)) return NextResponse.json({ error: "세부 항목을 찾을 수 없습니다. 화면을 새로 불러오세요." }, { status: 400 });
  const detailKey = rawKey || null;
  const detailText = detailKey ? units.get(detailKey)!.label : null;

  let catalog: Awaited<ReturnType<typeof loadCatalog>>;
  try {
    catalog = await loadCatalog(auth.admin, { activeSolutionsOnly: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "카탈로그를 불러오지 못했습니다." }, { status: 500 });
  }
  const siblingsRes = await auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("requirement_id", req.id).order("sort_order");
  if (siblingsRes.error) return NextResponse.json({ error: siblingsRes.error.message }, { status: 500 });
  const siblings = ((siblingsRes.data ?? []) as MappingDbRow[]).map(mapMapping).filter((s) => (s.detailKey ?? null) === detailKey);
  const check = validateManualMapping({ verdict: body.verdict, solutionCode: body.solutionCode, featureId: body.featureId }, catalog, siblings);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1;
  const { data, error } = await auth.admin
    .from("rfp_requirement_mappings")
    .insert({
      project_id: id, requirement_id: req.id, solution_code: check.solutionCode, feature_id: check.featureId, verdict: check.verdict,
      rationale, evidence_url: evidenceUrl, edited: true, sort_order: sortOrder, engine: "manual", score: null, updated_by: auth.userId,
      detail_key: detailKey, detail_text: detailText,
    })
    .select(MAPPING_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: statusError } = await auth.admin
    .from("rfp_projects")
    .update({ mapping_status: "ready", updated_by: auth.userId })
    .eq("id", id)
    .eq("mapping_status", "none");
  if (statusError) console.error("[rfp] mapping status update failed", id, statusError.message);

  return NextResponse.json(mapMapping(data as MappingDbRow), { status: 201 });
}
