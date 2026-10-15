import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { textFromDocument } from "@/lib/ppt/source";
import { parseDocumentAsync } from "@/lib/rfp/parse";
import { documentText } from "@/lib/rfp/document-model";
import type { AttachmentRow } from "./store";

export const CHAT_BUCKET = "chat";
/** 원본 경로(`<user>/<id>/original.<ext>`) 옆의 추출 텍스트 경로 */
export const textPathOf = (storagePath: string) => storagePath.replace(/\/[^/]+$/, "/text.txt");

/** 첨부 원본·추출 텍스트 객체를 지운다(없는 객체는 무시). 실패는 기록만 — 남은 객체는 보존 크론이 다시 지운다. */
export async function deleteAttachmentObjects(admin: SupabaseClient, rows: Array<{ storage_path: string }>): Promise<void> {
  const paths = rows.flatMap((r) => [r.storage_path, textPathOf(r.storage_path)]);
  if (!paths.length) return;
  const { error } = await admin.storage.from(CHAT_BUCKET).remove(paths);
  if (error) console.error("[chat] 첨부 객체 삭제 실패:", error.message);
}

export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACH_TEXT_MAX = 50_000;
export const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export const ATTACH_EXTS = ["docx", "pdf", "pptx", "xlsx", "hwp", "hwpx", "txt", "md", ...Object.keys(IMAGE_MIME)];
export const extOf = (name: string) => { const i = name.lastIndexOf("."); return i < 0 ? "" : name.slice(i + 1).toLowerCase(); };

/** 첨부 → 텍스트(마스킹 대상) 또는 원본 그대로(이미지·스캔 PDF, 가릴 수 없음). */
export async function extractAttachment(buf: Buffer, name: string, deps: { pptx?: (buf: Buffer, name: string) => Promise<string> }): Promise<{ kind: "text"; text: string } | { kind: "image" | "pdf" }> {
  const ext = extOf(name);
  if (!ATTACH_EXTS.includes(ext)) throw new Error(`${ext || "확장자 없는"} 파일은 첨부할 수 없는 형식입니다(${ATTACH_EXTS.join("·")}).`);
  if (IMAGE_MIME[ext]) return { kind: "image" };
  if (ext === "pptx") {
    if (!deps.pptx) throw new Error("PPT 본문 읽기를 쓸 수 없습니다(관리자 설정 필요).");
    return { kind: "text", text: (await deps.pptx(buf, name)).slice(0, ATTACH_TEXT_MAX) };
  }
  const text = ext === "xlsx" ? documentText(await parseDocumentAsync(buf, name)) : await textFromDocument(buf, name);
  if (ext === "pdf" && !text.trim()) return { kind: "pdf" };
  return { kind: "text", text: text.slice(0, ATTACH_TEXT_MAX) };
}

/** 저장된 첨부 → Claude 블록. 텍스트는 가린 추출본, 이미지·PDF는 원본 base64. */
export function attachmentBlocks(row: AttachmentRow, data: { original?: Buffer; text?: string }): Anthropic.ContentBlockParam[] {
  const head = `[첨부: ${row.name}]`;
  if (row.kind === "text" && data.text !== undefined) return [{ type: "text", text: `${head}\n${data.text}` }];
  if (row.kind === "image" && data.original) return [{ type: "text", text: head }, { type: "image", source: { type: "base64", media_type: row.mime as "image/png", data: data.original.toString("base64") } }];
  if (row.kind === "pdf" && data.original) return [{ type: "text", text: head }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: data.original.toString("base64") } }];
  return [{ type: "text", text: `[첨부: ${row.name} — 파일을 읽지 못함]` }];
}

async function download(admin: SupabaseClient, path: string): Promise<Buffer | undefined> {
  const { data, error } = await admin.storage.from(CHAT_BUCKET).download(path);
  if (error || !data) return undefined;
  return Buffer.from(await data.arrayBuffer());
}

/** 턴 엔진의 loadAttachments — 내 첨부만 읽는다. */
export function attachmentLoader(admin: SupabaseClient, userId: string) {
  return async (ids: string[]): Promise<Map<string, Anthropic.ContentBlockParam[]>> => {
    const out = new Map<string, Anthropic.ContentBlockParam[]>();
    if (!ids.length) return out;
    const { data, error } = await admin.from("chat_attachments").select("id,name,mime,kind,storage_path,masked_count").in("id", ids).eq("user_id", userId);
    if (error) throw new Error(`첨부 조회 실패: ${error.message}`);
    for (const row of (data ?? []) as AttachmentRow[]) {
      if (row.kind === "text") {
        const t = await download(admin, textPathOf(row.storage_path));
        out.set(row.id, attachmentBlocks(row, { text: t?.toString("utf8") }));
      } else {
        out.set(row.id, attachmentBlocks(row, { original: await download(admin, row.storage_path) }));
      }
    }
    return out;
  };
}
