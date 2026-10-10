/**
 * pptx 본문 읽기 — ppt-service /extract는 Supabase 스토리지 주소만 받으므로(허용 호스트, 리디렉션 금지) 받은 파일을 ppt 버킷에 잠깐 두고
 * 서명 URL로 추출한 뒤 지운다. 서비스 미설정이면 undefined(readDoc이 503 안내).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPptServiceClient, PptServiceError } from "@/lib/ppt/service";
import { extractionText } from "@/lib/ppt/source";
import { newSourcePath, PPT_BUCKET } from "@/lib/ppt/store";

export function pptxExtractor(admin: SupabaseClient): ((buf: Buffer, name: string) => Promise<string>) | undefined {
  let service: ReturnType<typeof createPptServiceClient>;
  try { service = createPptServiceClient(); } catch (e) { if (e instanceof PptServiceError) return undefined; throw e; }
  return async (buf) => {
    const path = newSourcePath("pptx");
    const up = await admin.storage.from(PPT_BUCKET).upload(path, buf, { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    if (up.error) throw new Error(`임시 저장 실패: ${up.error.message}`);
    try {
      const signed = await admin.storage.from(PPT_BUCKET).createSignedUrl(path, 300);
      if (signed.error || !signed.data) throw new Error(`서명 URL 실패: ${signed.error?.message ?? ""}`);
      return extractionText(await service.extract(signed.data.signedUrl));
    } finally {
      await admin.storage.from(PPT_BUCKET).remove([path]).catch(() => undefined);
    }
  };
}
