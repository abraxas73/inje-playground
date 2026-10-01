import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { logAudit } from "@/lib/audit";
import { mapTemplate, TEMPLATE_COLUMNS, type TemplateRow } from "@/lib/ppt/store";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** PATCH /api/admin/ppt/templates/[id] {isDefault?, status?, name?, note?} — 기본 지정은 하나만, 삭제는 없다(버전이 참조) */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { isDefault?: boolean; status?: string; name?: string; note?: string | null } | null;
  if (!body) return NextResponse.json({ error: "요청 본문이 없습니다." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if (body.note === null || typeof body.note === "string") patch.note = body.note ? body.note.trim().slice(0, 500) : null;
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "disabled") return NextResponse.json({ error: "status는 active|disabled" }, { status: 400 });
    patch.status = body.status;
    if (body.status === "disabled") patch.is_default = false;
  }
  if (body.isDefault === true) {
    const { error } = await a.admin.from("ppt_templates").update({ is_default: false }).eq("is_default", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    patch.is_default = true; patch.status = "active";
  } else if (body.isDefault === false) patch.is_default = false;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "바꿀 항목이 없습니다." }, { status: 400 });
  const { data, error } = await a.admin.from("ppt_templates").update(patch).eq("id", id).select(TEMPLATE_COLUMNS).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "템플릿이 없습니다." }, { status: 404 });
  await logAudit(a.admin, request, { userId: auth.userId, userEmail: auth.email, action: "PPT 템플릿 변경", category: "ppt", detail: { id, ...patch } });
  return NextResponse.json({ template: mapTemplate(data as TemplateRow) });
}
