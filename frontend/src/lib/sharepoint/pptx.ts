/** pptx 본문 읽기 — ppt-service /extract(장표 텍스트)에 Graph 사전 인증 downloadUrl을 넘긴다. 서비스 미설정이면 undefined(readDoc이 503 안내). */
import { createPptServiceClient, PptServiceError } from "@/lib/ppt/service";
import { extractionText } from "@/lib/ppt/source";

export function pptxExtractor(): ((downloadUrl: string) => Promise<string>) | undefined {
  try {
    const service = createPptServiceClient();
    return async (downloadUrl) => extractionText(await service.extract(downloadUrl));
  } catch (e) {
    if (e instanceof PptServiceError) return undefined;
    throw e;
  }
}
