import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { parseFolderUrl, resolveFolderForUser } from "@/lib/ms/folder-route";

export const runtime = "nodejs";
export const maxDuration = 30;
type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/rfp/projects/[id]/sharepoint/folder {url} — 폴더 링크를 Graph shares로 해석해 프로젝트에 저장(스펙 §4).
 * 검증·오류 규격은 개인 기본 폴더와 공용(`lib/ms/folder-route.ts`).
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const parsed = parseFolderUrl(body?.url);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data: project, error } = await auth.admin.from("rfp_projects").select("id").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });

  const resolved = await resolveFolderForUser(auth.admin, auth.userId, parsed.url);
  if (!resolved.ok) return resolved.response;

  const { error: upErr } = await auth.admin.from("rfp_projects").update({ sharepoint_folder: resolved.folder, updated_by: auth.userId }).eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ folder: resolved.folder });
}

/** DELETE /api/rfp/projects/[id]/sharepoint/folder — 폴더 지정 해제(이력은 남는다) */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });
  const { data, error } = await auth.admin.from("rfp_projects").update({ sharepoint_folder: null, updated_by: auth.userId }).eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
