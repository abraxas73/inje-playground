import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { mapRequirement, type RequirementDbRow } from "@/lib/rfp/mappers";
import { parseReqId } from "@/lib/rfp/requirements";

export const runtime = "nodejs";

type Params = { params: Promise<{ requirementId: string }> };
const TEXT_FIELDS = ["title", "definition", "details", "deliverables", "related", "categoryName"] as const;
const COLUMN: Record<(typeof TEXT_FIELDS)[number], string> = {
  title: "title", definition: "definition", details: "details", deliverables: "deliverables", related: "related", categoryName: "category_name",
};

/** PATCH /api/rfp/requirements/[requirementId] — 셀 단위 부분 갱신. reqId를 바꾸면 category_code도 따라간다. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { requirementId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });
  if ("solution" in body) return NextResponse.json({ error: "solution은 매핑에서 관리합니다. 요구사항 행을 펼쳐 매핑을 편집하세요." }, { status: 400 });

  const patch: Record<string, unknown> = { updated_by: auth.userId };
  for (const f of TEXT_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (typeof v !== "string") return NextResponse.json({ error: `${f}는 문자열이어야 합니다.` }, { status: 400 });
    if (v.length > 20000) return NextResponse.json({ error: `${f}는 20000자 이하여야 합니다.` }, { status: 400 });
    patch[COLUMN[f]] = v;
  }
  if (typeof body.reqId === "string") {
    const reqId = body.reqId.replace(/\s+/g, "").toUpperCase();
    const parsed = parseReqId(reqId);
    if (!parsed) return NextResponse.json({ error: "요구사항 ID 형식은 SER-001 같은 코드-숫자입니다." }, { status: 400 });
    patch.req_id = reqId;
    patch.category_code = parsed.code;
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "바꿀 필드가 없습니다." }, { status: 400 });

  const { data, error } = await auth.admin.from("rfp_requirements").update(patch).eq("id", requirementId).select("*").maybeSingle();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 요구사항 ID가 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "요구사항이 없습니다." }, { status: 404 });
  return NextResponse.json(mapRequirement(data as RequirementDbRow));
}

/** DELETE /api/rfp/requirements/[requirementId] → 204 (프로젝트 건수 갱신) */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { requirementId } = await params;
  const { data: row } = await auth.admin.from("rfp_requirements").select("id, project_id").eq("id", requirementId).maybeSingle();
  if (!row) return NextResponse.json({ error: "요구사항이 없습니다." }, { status: 404 });
  const { error } = await auth.admin.from("rfp_requirements").delete().eq("id", requirementId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { count } = await auth.admin.from("rfp_requirements").select("id", { count: "exact", head: true }).eq("project_id", row.project_id);
  await auth.admin.from("rfp_projects").update({ requirement_count: count ?? 0, updated_by: auth.userId }).eq("id", row.project_id);
  return new NextResponse(null, { status: 204 });
}
