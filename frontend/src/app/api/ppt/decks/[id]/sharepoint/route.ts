import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { uploadFile } from "@/lib/ms/graph-drive";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { mapGraphUploadError } from "@/lib/rfp/sharepoint";
import { loadUserDefaultFolder } from "@/lib/rfp/user-folder";
import { deckForRequest } from "@/lib/ppt/deck-access";
import { PPTX_MIME } from "@/lib/ppt/notice";
import { PPT_BUCKET, pptxFileName } from "@/lib/ppt/store";

export const runtime = "nodejs";
export const maxDuration = 60;
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/ppt/decks/[id]/sharepoint {no?} — 완료 버전 PPTX를 내 SharePoint 기본 폴더에 올린다.
 * 400 {code:"no_folder"|"not_connected"} / 409 {code:"reconnect"} / 403·404·502 Graph 오류(mapGraphUploadError)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const r = await deckForRequest(id, { ownerOnly: true });
  if (!r.ok) return r.response;
  const { admin, userId } = r.auth;
  const body = (await request.json().catch(() => ({}))) as { no?: number };
  const no = Number.isInteger(body.no) && (body.no as number) >= 1 ? (body.no as number) : r.deck.current_version;
  const { data } = await admin.from("ppt_deck_versions").select("id, status, pptx_path").eq("deck_id", id).eq("no", no).maybeSingle();
  const v = data as { id: string; status: string; pptx_path: string | null } | null;
  if (!v || v.status !== "done" || !v.pptx_path) return NextResponse.json({ error: "완료된 버전이 없습니다." }, { status: 409 });

  const token = await graphTokenForRoute(admin, userId);
  if (!token.ok) return token.response;
  const folder = await loadUserDefaultFolder(admin, userId);
  if (!folder) return NextResponse.json({ error: "SharePoint 기본 폴더를 먼저 설정하세요(설정 → SharePoint 업로드 기본 폴더).", code: "no_folder" }, { status: 400 });

  const { data: blob, error } = await admin.storage.from(PPT_BUCKET).download(v.pptx_path);
  if (error || !blob) return NextResponse.json({ error: `파일을 읽지 못했습니다: ${error?.message ?? ""}` }, { status: 500 });
  const fileName = pptxFileName(r.deck.title, no);
  let item: Awaited<ReturnType<typeof uploadFile>>;
  try {
    item = await uploadFile(token.token, { driveId: folder.driveId, itemId: folder.itemId, fileName, buffer: Buffer.from(await blob.arrayBuffer()), contentType: PPTX_MIME });
  } catch (e) {
    const f = mapGraphUploadError(e);
    return NextResponse.json({ error: f.message }, { status: f.status });
  }
  const { error: saveError } = await admin.from("ppt_deck_versions").update({ sharepoint_url: item.webUrl, sharepoint_at: new Date().toISOString() }).eq("id", v.id);
  if (saveError) console.error("[ppt] SharePoint 링크 저장 실패:", saveError.message);
  await logAudit(admin, request, { userId, action: "PPT SharePoint 업로드", category: "ppt", detail: { deckId: id, no, fileName, folder: folder.name } });
  return NextResponse.json({ webUrl: item.webUrl, name: item.name, folderName: folder.name, ...(saveError ? { warning: "업로드는 됐지만 링크 저장에 실패했습니다." } : {}) });
}
