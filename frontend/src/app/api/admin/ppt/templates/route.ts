import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { logAudit } from "@/lib/audit";
import { createPptServiceClient, PptServiceError } from "@/lib/ppt/service";
import { mapTemplate, PPT_BUCKET, TEMPLATE_COLUMNS, TEMPLATE_PATH_RE, type TemplateRow } from "@/lib/ppt/store";
import type { PptTemplatesResponse } from "@/types/ppt";

export const runtime = "nodejs";
export const maxDuration = 300; // 검증 = 21MB 내려받기 + 샘플 덱 전체 빌드

/** GET /api/admin/ppt/templates — 업로드 템플릿 전체(비활성 포함) + 내장 템플릿 정보 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { data, error } = await a.admin.from("ppt_templates").select(TEMPLATE_COLUMNS).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let builtin: PptTemplatesResponse["builtin"] = { file: null, slides: null };
  try {
    const c = await createPptServiceClient().catalog();
    builtin = { file: c.templateFile ?? null, slides: c.templateSlides };
  } catch { /* 서비스가 꺼져 있어도 목록은 보인다 */ }
  const res: PptTemplatesResponse = { templates: ((data ?? []) as TemplateRow[]).map(mapTemplate), builtin };
  return NextResponse.json(res);
}

/** POST /api/admin/ppt/templates {storagePath, fileName, name?, note?} — 업로드한 pptx를 ppt-service가 검증(106장 + 샘플 덱 빌드)한 뒤 등록 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const body = (await request.json().catch(() => null)) as { storagePath?: string; fileName?: string; name?: string; note?: string } | null;
  const storagePath = typeof body?.storagePath === "string" ? body.storagePath : "";
  const fileName = typeof body?.fileName === "string" ? body.fileName.trim() : "";
  if (!TEMPLATE_PATH_RE.test(storagePath) || !fileName) return NextResponse.json({ error: "업로드 경로나 파일명이 올바르지 않습니다." }, { status: 400 });
  const name = (typeof body?.name === "string" && body.name.trim() ? body.name.trim() : fileName.replace(/\.pptx$/i, "")).slice(0, 120);
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const { data: signed, error: signError } = await a.admin.storage.from(PPT_BUCKET).createSignedUrl(storagePath, 900);
  if (signError || !signed) return NextResponse.json({ error: `업로드한 파일을 찾을 수 없습니다: ${signError?.message ?? ""}` }, { status: 400 });

  let service;
  try { service = createPptServiceClient(); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "PPT 서비스 설정 오류" }, { status: 500 }); }
  let result;
  try { result = await service.validateTemplate(signed.signedUrl); }
  catch (e) {
    if (e instanceof PptServiceError) return NextResponse.json({ error: `템플릿 검증 요청 실패: ${e.message}` }, { status: 502 });
    throw e;
  }
  if (!result.ok) {
    await a.admin.storage.from(PPT_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: `템플릿 검증 실패 — ${result.error}` }, { status: 422 });
  }
  const { data, error } = await a.admin.from("ppt_templates").insert({
    name, file_name: fileName, storage_path: storagePath, bytes: result.bytes, slides: result.slides, check_issues: result.issues, advisories: result.advisories,
    uploaded_by: auth.userId, uploaded_by_email: auth.email ?? "", note,
  }).select(TEMPLATE_COLUMNS).single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "템플릿을 저장하지 못했습니다." }, { status: 500 });
  await logAudit(a.admin, request, { userId: auth.userId, userEmail: auth.email, action: "PPT 템플릿 등록", category: "ppt", detail: { name, fileName, slides: result.slides, issues: Object.keys(result.issues).length } });
  return NextResponse.json({ template: mapTemplate(data as TemplateRow) }, { status: 201 });
}
