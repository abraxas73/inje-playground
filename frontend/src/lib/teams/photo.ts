import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET, PHOTO_MAX_BYTES, sniffImage } from "@/lib/directory/photos";

/** Microsoft Entra 사용자 id(GUID) — 메시지 from.id·채팅 구성원 userId */
export const TEAMS_USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 받아 둔 사본을 이 시간 동안은 Graph에 다시 묻지 않는다(사진 바꾸면 하루 안에 반영) */
export const TEAMS_PHOTO_FRESH_MS = 86_400_000;
const GRAPH = "https://graph.microsoft.com/v1.0";

type Photo = { body: ArrayBuffer; type: "image/jpeg" | "image/png" };

/**
 * Teams(Entra) 프로필 사진 — 조직도 사진과 같은 비공개 버킷 `directory-photos`의 `teams/{id}`에 받아 두고,
 * 하루 지난 사본이면 부른 사람의 위임 토큰(User.Read로 충분)으로 다시 받는다. 사진이 없어졌으면 사본도 지운다.
 * Graph가 실패하면(토큰 없음·장애) 오래된 사본이라도 보인다. 사진이 없다고 확인되면 "none", 확인 못 하고 사본도 없으면 null.
 */
export async function teamsPhoto(admin: SupabaseClient, rawId: string, token: () => Promise<string | null>, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Photo | "none" | null> {
  const id = rawId.toLowerCase();
  const path = `teams/${id}`;
  const bucket = admin.storage.from(PHOTO_BUCKET);
  const listed = await bucket.list("teams", { search: id, limit: 1 });
  const stored = listed.data?.find((f) => f.name === id) ?? null;
  const savedAt = Date.parse(stored?.updated_at ?? stored?.created_at ?? "");
  const stale = !stored || !(now - savedAt < TEAMS_PHOTO_FRESH_MS); // 시각을 모르면(NaN) 다시 받는다
  const fromStore = async (): Promise<Photo | null> => {
    if (!stored) return null;
    const { data } = await bucket.download(path);
    if (!data) return null;
    const body = await data.arrayBuffer();
    const type = sniffImage(new Uint8Array(body));
    return type ? { body, type } : null;
  };
  if (!stale) return fromStore();

  const t = await token().catch(() => null);
  if (!t) return fromStore();
  const get = (p: string) => fetchImpl(`${GRAPH}/users/${id}/${p}`, { headers: { Authorization: `Bearer ${t}` } });
  try {
    let r = await get("photos/96x96/$value");
    if (r.status === 404) r = await get("photo/$value"); // Entra에만 있는 사진은 정해진 크기가 없을 수 있다
    if (r.status === 404) {
      if (stored) await bucket.remove([path]);
      return "none";
    }
    if (!r.ok) return fromStore();
    const body = await r.arrayBuffer();
    const type = sniffImage(new Uint8Array(body));
    if (!type || body.byteLength > PHOTO_MAX_BYTES) return fromStore();
    await bucket.upload(path, body, { contentType: type, upsert: true });
    return { body, type };
  } catch {
    return fromStore();
  }
}
