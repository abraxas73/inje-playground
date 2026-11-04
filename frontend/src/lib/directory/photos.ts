/**
 * 조직도 사진 — 아마란스 사진은 로그인 쿠키가 있어야 받혀(2026-11-04 실측) 매일 동기화가 비공개 버킷에 복사한다.
 * 객체 키: thumb/{id}·large/{id}, id = 아마란스 picFileId(사진이 바뀌면 id도 바뀐다). 화면은 GET /api/directory/photo/{id}.
 */
export const PHOTO_BUCKET = "directory-photos";
export const PHOTO_MAX_BYTES = 512 * 1024;
const ID = /^[A-Za-z0-9_.-]{1,80}$/;

export const isPhotoId = (id: unknown): id is string => typeof id === "string" && ID.test(id) && !id.includes("..");

/** company_directory.photo_path "{group}/empPic/{id}" → id. */
export function photoIdOf(path: string | null | undefined): string | null {
  const m = path ? /^[A-Za-z0-9_-]{1,64}\/empPic\/([A-Za-z0-9_.-]{1,80})$/.exec(path) : null;
  return m && isPhotoId(m[1]) ? m[1] : null;
}

/** 실제 그림인지 머리 바이트로 확인 — JPEG·PNG만. */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}
