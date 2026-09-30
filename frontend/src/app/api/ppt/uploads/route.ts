import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { extensionOf, PPT_SOURCE_EXTENSIONS, PPT_SOURCE_EXTENSIONS_TEXT } from "@/lib/ppt/source";
import { newSourcePath, PPT_BUCKET } from "@/lib/ppt/store";
import type { PptUploadTicket } from "@/types/ppt";

export const runtime = "nodejs";
const MAX_BYTES = 50 * 1024 * 1024;

/** POST /api/ppt/uploads {fileName, size} → 서명 업로드 URL. 파일은 서버를 거치지 않고 Storage로 바로 올라간다. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { fileName?: string; size?: number } | null;
  const fileName = typeof body?.fileName === "string" ? body.fileName.trim() : "";
  const size = Number(body?.size);
  if (!fileName || !Number.isFinite(size)) return NextResponse.json({ error: "fileName과 size가 필요합니다." }, { status: 400 });
  const ext = extensionOf(fileName);
  if (!(PPT_SOURCE_EXTENSIONS as readonly string[]).includes(ext)) {
    return NextResponse.json({ error: `${PPT_SOURCE_EXTENSIONS_TEXT} 파일만 올릴 수 있습니다.` }, { status: 415 });
  }
  if (size <= 0 || size > MAX_BYTES) return NextResponse.json({ error: "파일은 50MB 이하여야 합니다." }, { status: 400 });
  const storagePath = newSourcePath(ext);
  const { data, error } = await auth.admin.storage.from(PPT_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return NextResponse.json({ error: `업로드 URL 생성에 실패했습니다: ${error?.message ?? ""}` }, { status: 500 });
  const ticket: PptUploadTicket = { storagePath, token: data.token, signedUrl: data.signedUrl };
  return NextResponse.json(ticket);
}
