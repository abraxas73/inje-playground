import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { parseSharepointFolder } from "@/lib/rfp/mappers";
import { loadUploads } from "@/lib/rfp/sharepoint";
import type { SharepointResponse } from "@/types/rfp";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/rfp/projects/[id]/sharepoint — 폴더 설정 + 마지막 업로드 + 이력 20건 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });

  const { data: project, error } = await auth.admin.from("rfp_projects").select("id, sharepoint_folder").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });

  try {
    const uploads = await loadUploads(auth.admin, id, 20);
    const res: SharepointResponse = { folder: parseSharepointFolder(project.sharepoint_folder), lastUpload: uploads[0] ?? null, uploads };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "업로드 이력을 불러오지 못했습니다." }, { status: 500 });
  }
}
