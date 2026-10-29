/** Teams 채팅 첨부(화면 쪽) — 본문 그림으로 보낼 것과 파일로 올릴 것을 가르고, 업로드 세션 주소에 조각으로 올린다. 서버 상한은 lib/teams/chat-files.ts와 같다. */
export const INLINE_IMAGES_MAX_BYTES = 3 * 1024 * 1024;
export const INLINE_IMAGES_MAX = 4;
const INLINE_TYPE_RE = /^image\/(png|jpeg|gif|webp)$/;
/** 조각 크기 — 320KiB의 배수여야 한다(OneDrive 업로드 세션 규칙) */
export const UPLOAD_CHUNK = 10 * 320 * 1024;

type Sized = { type: string; size: number };
/** 앞에서부터 그림(형식·합계 3MB·4장 안)은 본문 그림, 나머지는 파일 */
export function splitAttachments<T extends Sized>(files: T[]): { images: T[]; files: T[] } {
  const images: T[] = [], rest: T[] = [];
  let total = 0;
  for (const f of files) {
    if (INLINE_TYPE_RE.test(f.type) && images.length < INLINE_IMAGES_MAX && total + f.size <= INLINE_IMAGES_MAX_BYTES) { images.push(f); total += f.size; }
    else rest.push(f);
  }
  return { images, files: rest };
}

/** 업로드 세션 주소에 조각(Content-Range)으로 PUT — 마지막 응답의 driveItem id */
export async function uploadToSession(blob: Blob, uploadUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  for (let at = 0; at < blob.size; at += UPLOAD_CHUNK) {
    const end = Math.min(at + UPLOAD_CHUNK, blob.size);
    const res = await fetchImpl(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${at}-${end - 1}/${blob.size}` }, body: blob.slice(at, end) });
    if (!res.ok) throw new Error(`파일을 올리지 못했습니다 (${res.status})`);
    if (end === blob.size) {
      const id = ((await res.json().catch(() => ({}))) as { id?: unknown }).id;
      if (typeof id !== "string") throw new Error("올린 파일을 확인하지 못했습니다.");
      return id;
    }
  }
  throw new Error("빈 파일은 보낼 수 없습니다.");
}

/** File → base64(접두사 없이) */
export const toBase64 = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
  r.onerror = () => reject(r.error ?? new Error("read_failed"));
  r.readAsDataURL(f);
});
