import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { mapRequirement, type RequirementDbRow } from "@/lib/rfp/mappers";
import { nextReqId, parseReqId } from "@/lib/rfp/requirements";

export const runtime = "nodejs";

const TEXT_FIELDS = ["title", "definition", "details", "deliverables", "related", "solution"] as const;

/** POST /api/rfp/projects/[id]/requirements {categoryCode, categoryName, reqId?, title?, …} → 201 행 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const categoryCode = typeof body?.categoryCode === "string" ? body.categoryCode.trim().toUpperCase() : "";
  const categoryName = typeof body?.categoryName === "string" ? body.categoryName.trim() : "";
  if (!/^[A-Z]{2,5}(-[A-Z]{2,5})*$/.test(categoryCode) || !categoryName) {
    return NextResponse.json({ error: "categoryCode(예: SER)와 categoryName이 필요합니다." }, { status: 400 });
  }
  const { data: project } = await auth.admin.from("rfp_projects").select("id").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });

  const { data: existing } = await auth.admin.from("rfp_requirements").select("req_id, sort_order").eq("project_id", id);
  const ids = (existing ?? []).map((r) => r.req_id as string);
  let reqId = typeof body?.reqId === "string" ? body.reqId.replace(/\s+/g, "").toUpperCase() : "";
  if (reqId) {
    const parsed = parseReqId(reqId);
    if (!parsed) return NextResponse.json({ error: "요구사항 ID 형식은 SER-001 같은 코드-숫자입니다." }, { status: 400 });
    if (parsed.code !== categoryCode) return NextResponse.json({ error: "요구사항 ID의 코드가 구분 코드와 다릅니다." }, { status: 400 });
  } else {
    reqId = nextReqId(categoryCode, ids);
  }
  const maxSort = Math.max(-1, ...(existing ?? []).map((r) => Number(r.sort_order)));
  const texts: Record<string, string> = {};
  for (const f of TEXT_FIELDS) {
    const v = body?.[f];
    if (v !== undefined && typeof v !== "string") return NextResponse.json({ error: `${f}는 문자열이어야 합니다.` }, { status: 400 });
    texts[f] = typeof v === "string" ? v : "";
  }
  const { data, error } = await auth.admin
    .from("rfp_requirements")
    .insert({ project_id: id, category_code: categoryCode, category_name: categoryName, req_id: reqId, ...texts, sort_order: maxSort + 1, source: { manual: true }, updated_by: auth.userId })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `요구사항 ID ${reqId}가 이미 있습니다.` }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { count } = await auth.admin.from("rfp_requirements").select("id", { count: "exact", head: true }).eq("project_id", id);
  await auth.admin.from("rfp_projects").update({ requirement_count: count ?? 0, updated_by: auth.userId }).eq("id", id);
  return NextResponse.json(mapRequirement(data as RequirementDbRow), { status: 201 });
}
