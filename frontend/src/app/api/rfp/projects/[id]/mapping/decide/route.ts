import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { validateManualMapping } from "@/lib/rfp/mapping/validate";
import { loadDetailSiblings } from "@/lib/rfp/mapping/siblings";
import { detailUnitMap } from "@/lib/rfp/mapping/detail-items";
import { cleanRationale, isConfirmed } from "@/lib/rfp/mapping/review";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow } from "@/lib/rfp/mappers";
import type { DecideResponse, ReviewDecision } from "@/types/rfp";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

function parseDecision(body: unknown): ReviewDecision | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.requirementId !== "string") return null;
  const detailKey = typeof b.detailKey === "string" && b.detailKey.trim() ? b.detailKey.trim() : null;
  const base = { requirementId: b.requirementId, detailKey };
  if (b.action === "confirm" && typeof b.mappingId === "string" && (b.verdict === "fulfilled" || b.verdict === "partial")) {
    return { action: "confirm", ...base, mappingId: b.mappingId, verdict: b.verdict };
  }
  if (b.action === "close" && (b.verdict === "build" || b.verdict === "na")) {
    const rationale = typeof b.rationale === "string" ? b.rationale.trim().slice(0, 4000) : undefined;
    return { action: "close", ...base, verdict: b.verdict, rationale };
  }
  if (b.action === "reuse" && typeof b.sourceMappingId === "string") return { action: "reuse", ...base, sourceMappingId: b.sourceMappingId };
  return null;
}

/**
 * POST /api/rfp/projects/[id]/mapping/decide — 확정 작업(리뷰 큐) 한 단위의 결정을 한 번에 적용한다.
 *
 * 편집기의 PATCH/POST를 화면에서 여러 번 부르지 않는 이유: 판정 조합 규칙이 "설계·구축영역/해당없음은 충족·부분충족·후보와
 * 함께 둘 수 없다"라서 단위를 닫으려면 후보를 먼저 지워야 하고, 그 순서를 화면이 맡으면 중간에 끊겼을 때 반쪽 상태가 남는다.
 * 후보 행은 규칙 엔진이 다시 만들 수 있는 것이라 지워도 잃는 게 없다.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const decision = parseDecision(await request.json().catch(() => null));
  if (!decision) return bad("결정 형식이 아닙니다(action confirm|close|reuse).");

  const { data: req, error: reqError } = await auth.admin.from("rfp_requirements").select("id, project_id, details").eq("id", decision.requirementId).maybeSingle();
  if (reqError) return bad(reqError.message, 500);
  if (!req || req.project_id !== id) return bad("요구사항이 없습니다.", 404);

  const siblingsRes = await loadDetailSiblings(auth.admin, req.id, decision.detailKey);
  if (!siblingsRes.ok) return bad(siblingsRes.error, 500);
  const unitRows = siblingsRes.siblings;
  // 세부 항목 키는 지금 세부 내용에서 뽑히는 것이거나, 이미 그 키로 저장된 행이 있는 것(세부 내용이 바뀐 뒤 남은 매핑)만
  const units = detailUnitMap(String((req as { details?: unknown }).details ?? ""));
  if (decision.detailKey && !units.has(decision.detailKey) && !unitRows.length) return bad("세부 항목을 찾을 수 없습니다. 화면을 새로 불러오세요.");
  const detailText = decision.detailKey ? units.get(decision.detailKey)?.label ?? unitRows[0]?.detailText ?? null : null;

  const candidates = unitRows.filter((r) => !isConfirmed(r));
  const confirmed = unitRows.filter(isConfirmed);

  let catalog: Awaited<ReturnType<typeof loadCatalog>>;
  try {
    catalog = await loadCatalog(auth.admin, { activeSolutionsOnly: true });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "카탈로그를 불러오지 못했습니다.", 500);
  }

  const deleteRows = async (ids: string[]) => {
    if (!ids.length) return null;
    const { error } = await auth.admin.from("rfp_requirement_mappings").delete().in("id", ids);
    return error?.message ?? null;
  };

  if (decision.action === "confirm") {
    const target = unitRows.find((r) => r.id === decision.mappingId);
    if (!target) return bad("확정할 후보가 이 단위에 없습니다. 화면을 새로 불러오세요.", 404);
    // 규칙 검사의 형제 = 확정 행들(지울 후보는 뺀다)
    const check = validateManualMapping(
      { verdict: decision.verdict, solutionCode: target.solutionCode, featureId: target.featureId },
      catalog,
      confirmed.filter((r) => r.id !== target.id),
    );
    if (!check.ok) return bad(check.error);
    const delError = await deleteRows(candidates.filter((r) => r.id !== target.id).map((r) => r.id));
    if (delError) return bad(delError, 500);
    const { error } = await auth.admin
      .from("rfp_requirement_mappings")
      .update({ verdict: check.verdict, solution_code: check.solutionCode, feature_id: check.featureId, edited: true, updated_by: auth.userId })
      .eq("id", target.id);
    if (error) return bad(error.message, 500);
  } else if (decision.action === "close") {
    if (confirmed.length) return bad("이미 확정된 행이 있는 단위는 닫을 수 없습니다. 편집기에서 그 행을 먼저 지우거나 바꾸세요.");
    const delError = await deleteRows(candidates.map((r) => r.id));
    if (delError) return bad(delError, 500);
    const { error } = await auth.admin.from("rfp_requirement_mappings").insert({
      project_id: id, requirement_id: req.id, solution_code: null, feature_id: null, verdict: decision.verdict,
      rationale: decision.rationale ?? "", evidence_url: null, edited: true, sort_order: 0, engine: "manual", score: null, updated_by: auth.userId,
      detail_key: decision.detailKey, detail_text: detailText,
    });
    if (error) return bad(error.message, 500);
  } else {
    const { data: srcRow, error: srcError } = await auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("id", decision.sourceMappingId).maybeSingle();
    if (srcError) return bad(srcError.message, 500);
    if (!srcRow) return bad("재사용할 확정 행이 없습니다.", 404);
    const src = mapMapping(srcRow as MappingDbRow);
    if (!isConfirmed(src)) return bad("후보 행은 재사용할 수 없습니다. 확정된 행만 가져옵니다.");
    const check = validateManualMapping({ verdict: src.verdict, solutionCode: src.solutionCode, featureId: src.featureId }, catalog, confirmed);
    if (!check.ok) return bad(check.error);
    // 출처를 설명에 남긴다 — 어느 문서의 어느 요구사항 확정을 가져왔는지 나중에 알 수 있게
    const { data: srcReq } = await auth.admin.from("rfp_requirements").select("req_id, project_id").eq("id", src.requirementId).maybeSingle();
    const { data: srcProject } = srcReq
      ? await auth.admin.from("rfp_projects").select("name").eq("id", (srcReq as { project_id: string }).project_id).maybeSingle()
      : { data: null };
    const origin = srcReq ? `${(srcProject as { name?: string } | null)?.name ?? ""} ${(srcReq as { req_id: string }).req_id}`.trim() : "이전 프로젝트";
    const reason = cleanRationale(src.rationale);
    const rationale = `이전 확정 재사용(${origin})${reason ? ` — ${reason}` : ""}`.slice(0, 4000);
    const delError = await deleteRows(candidates.map((r) => r.id));
    if (delError) return bad(delError, 500);
    const { error } = await auth.admin.from("rfp_requirement_mappings").insert({
      project_id: id, requirement_id: req.id, solution_code: check.solutionCode, feature_id: check.featureId, verdict: check.verdict,
      rationale, evidence_url: src.evidenceUrl, evidence_text: src.evidenceText ?? null, edited: true,
      sort_order: confirmed.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1, engine: "manual", score: null, updated_by: auth.userId,
      detail_key: decision.detailKey, detail_text: detailText,
    });
    if (error) return bad(error.message, 500);
  }

  // 수동 행만으로 매핑이 시작된 프로젝트도 "매핑 있음"으로(행 추가 라우트와 같은 처리)
  const { error: statusError } = await auth.admin.from("rfp_projects").update({ mapping_status: "ready", updated_by: auth.userId }).eq("id", id).eq("mapping_status", "none");
  if (statusError) console.error("[rfp] mapping status update failed", id, statusError.message);

  const { data: rows, error: rowsError } = await auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("requirement_id", req.id).order("sort_order").order("id");
  if (rowsError) return bad(rowsError.message, 500);
  const body: DecideResponse = { requirementId: req.id, rows: ((rows ?? []) as MappingDbRow[]).map(mapMapping) };
  return NextResponse.json(body);
}
