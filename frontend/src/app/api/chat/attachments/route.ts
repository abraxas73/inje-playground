import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { canUsePage } from "@/lib/page-access";
import { loadPermissions } from "@/lib/chat/access";
import { maskText } from "@/lib/chat/mask";
import { pptxExtractor } from "@/lib/sharepoint/pptx";
import { ATTACH_MAX_BYTES, CHAT_BUCKET, IMAGE_MIME, extOf, deleteAttachmentObjects, extractAttachment, textPathOf } from "@/lib/chat/attachments";

export const runtime = "nodejs";
export const maxDuration = 120;
const IMAGE_WARNING = "이미지·스캔 문서 안의 개인정보는 가려지지 않습니다.";

/** POST /api/chat/attachments — 파일 하나(multipart `file`). 텍스트는 뽑아 가린 뒤 따로 저장한다. 대화 연결은 턴에서. */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const perms = await loadPermissions(r.admin, r.userId);
  if (!perms) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!canUsePage(r.role, "assistant", perms)) return NextResponse.json({ error: "이노봇 권한이 없습니다." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > ATTACH_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "파일은 10MB까지 첨부할 수 있습니다." }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  if (file.size > ATTACH_MAX_BYTES) return NextResponse.json({ error: "파일은 10MB까지 첨부할 수 있습니다." }, { status: 413 });
  const name = file.name.replace(/[\\/]/g, "_").slice(0, 200) || "file";
  const buf = Buffer.from(await file.arrayBuffer());
  let extracted;
  try { extracted = await extractAttachment(buf, name, { pptx: pptxExtractor(r.admin) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "파일을 읽지 못했습니다." }, { status: 415 }); }
  const id = randomUUID();
  const ext = extOf(name);
  const storagePath = `${r.userId}/${id}/original.${ext}`;
  const mime = IMAGE_MIME[ext] ?? (ext === "pdf" ? "application/pdf" : file.type || "application/octet-stream");
  const bucket = r.admin.storage.from(CHAT_BUCKET);
  // 텍스트형은 가린 본문(text.txt)만 저장하고 원본은 보관하지 않는다. 이미지·스캔 PDF만 원본 저장.
  let masked = 0, excerpt = "";
  let body: Buffer, objectPath: string, contentType: string;
  if (extracted.kind === "text") {
    const m = maskText(extracted.text);
    masked = m.count; excerpt = m.text.slice(0, 300);
    body = Buffer.from(m.text, "utf8"); objectPath = textPathOf(storagePath); contentType = "text/plain; charset=utf-8";
  } else { body = buf; objectPath = storagePath; contentType = mime; }
  const up = await bucket.upload(objectPath, body, { contentType, upsert: false });
  if (up.error) return NextResponse.json({ error: "파일을 저장하지 못했습니다." }, { status: 500 });
  const { error } = await r.admin.from("chat_attachments").insert({ id, user_id: r.userId, name, mime, size: file.size, kind: extracted.kind, storage_path: storagePath, text_excerpt: excerpt, masked_count: masked });
  if (error) { await deleteAttachmentObjects(r.admin, [{ storage_path: storagePath }]); return NextResponse.json({ error: "파일을 저장하지 못했습니다." }, { status: 500 }); }
  return NextResponse.json({ id, name, kind: extracted.kind, maskedCount: masked, ...(extracted.kind === "text" ? {} : { warning: IMAGE_WARNING }) });
}
