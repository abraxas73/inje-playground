import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, extensionOf } from "@/lib/rfp/parse";
import { RFP_BUCKET } from "@/lib/rfp/pipeline";
import type { UploadTicket } from "@/types/rfp";

export const runtime = "nodejs";

/**
 * POST /api/rfp/uploads {fileName, size} → 서명 업로드 URL(기본 유효 시간 안에 브라우저가 Storage로 직접 PUT).
 * Vercel 서버리스 함수의 요청 본문 상한(4.5MB)을 피하기 위해 파일은 서버를 거치지 않는다.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { fileName?: string; size?: number } | null;
  const fileName = body?.fileName?.trim();
  const size = Number(body?.size);
  if (!fileName || !Number.isFinite(size)) return NextResponse.json({ error: "fileName과 size가 필요합니다." }, { status: 400 });
  const ext = extensionOf(fileName);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return NextResponse.json({ error: "hwp·hwpx·docx 파일만 올릴 수 있습니다." }, { status: 400 });
  }
  if (size <= 0 || size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "파일은 50MB 이하여야 합니다." }, { status: 400 });

  // 경로에 원본 파일명을 쓰지 않는다(한글·특수문자 키 문제 회피). 원본명은 rfp_files.original_filename에 저장.
  const storagePath = `uploads/${crypto.randomUUID()}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await auth.admin.storage.from(RFP_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) return NextResponse.json({ error: `업로드 URL 생성에 실패했습니다: ${error?.message ?? ""}` }, { status: 500 });
  const ticket: UploadTicket = { storagePath, token: data.token, signedUrl: data.signedUrl };
  return NextResponse.json(ticket);
}
