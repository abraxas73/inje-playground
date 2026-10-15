import type { SupabaseClient } from "@supabase/supabase-js";

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
