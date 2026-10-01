import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { mapRequirement, type RequirementDbRow } from "@/lib/rfp/mappers";
import { parseDetailUnits, splitDetailChildren, readDetailSplits, EXPANDED_DETAIL_UNITS_MAX } from "@/lib/rfp/mapping/detail-items";

export const runtime = "nodejs";
type Params = { params: Promise<{ requirementId: string }> };

/** 원문과 기존 매핑은 그대로 두고 추출 메타데이터에 선택한 세분화만 저장한다. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { requirementId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.detailKey !== "string" || !/^\d+$/.test(body.detailKey) || typeof body.updatedAt !== "string") {
    return NextResponse.json({ error: "세부 항목과 현재 수정 시각이 필요합니다." }, { status: 400 });
  }
  const { data: row, error } = await auth.admin.from("rfp_requirements").select("*").eq("id", requirementId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "요구사항이 없습니다." }, { status: 404 });
  if (row.updated_at !== body.updatedAt) return NextResponse.json({ error: "요구사항이 변경되었습니다. 새로고침 후 다시 시도하세요." }, { status: 409 });
  const { data: project, error: projectError } = await auth.admin.from("rfp_projects").select("status, mapping_status").eq("id", row.project_id).maybeSingle();
  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
  if (!project || project.status !== "ready" || project.mapping_status === "running") {
    return NextResponse.json({ error: "추출·매핑이 끝난 뒤 더 상세하게 추출할 수 있습니다." }, { status: 409 });
  }
  const splits = readDetailSplits(row.source, row.details);
  const current = parseDetailUnits(row.details, splits);
  const unit = current.units.find((u) => u.key === body.detailKey);
  if (!unit || splitDetailChildren(unit).length < 2) return NextResponse.json({ error: "분리할 하위 대시 항목이 없습니다." }, { status: 400 });
  const nextSplits = { ...splits, [unit.key]: unit.text };
  if (parseDetailUnits(row.details, nextSplits).units.length > EXPANDED_DETAIL_UNITS_MAX) {
    return NextResponse.json({ error: `요구사항당 세부 항목은 ${EXPANDED_DETAIL_UNITS_MAX}개까지 지원합니다.` }, { status: 400 });
  }
  const source = row.source && typeof row.source === "object" && !Array.isArray(row.source) ? row.source : {};
  const { data, error: saveError } = await auth.admin.from("rfp_requirements")
    .update({ source: { ...source, detailSplits: nextSplits }, updated_by: auth.userId })
    .eq("id", requirementId).eq("updated_at", body.updatedAt).select("*").maybeSingle();
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "요구사항이 변경되었습니다. 새로고침 후 다시 시도하세요." }, { status: 409 });
  return NextResponse.json(mapRequirement(data as RequirementDbRow));
}
