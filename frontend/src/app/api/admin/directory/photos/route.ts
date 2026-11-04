import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { isPhotoId, PHOTO_BUCKET, PHOTO_MAX_BYTES, sniffImage } from "@/lib/directory/photos";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 한 번에 받는 사진 수 — 스크립트가 base64 합계 3MB로도 끊는다(Vercel 요청 본문 상한 4.5MB). */
const MAX_PER_REQUEST = 25;

/** 명부 동기화 토큰(DIRECTORY_SYNC_TOKEN — 직원 PC에 배포되는 사용량 수집 토큰과 별개) 또는 관리자 세션. */
async function authorize(request: NextRequest) {
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.DIRECTORY_SYNC_TOKEN)) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth;
  }
  return adminClientOr500();
}

/** GET — 이미 저장한 사진 id 목록(동기화 스크립트가 새 사진만 받도록). */
export async function GET(request: NextRequest) {
  const c = await authorize(request);
  if (!c.ok) return c.response;
  const ids: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await c.admin.storage.from(PHOTO_BUCKET).list("large", { limit: 1000, offset });
    if (error) return NextResponse.json({ error: `사진 목록 조회 실패: ${error.message}` }, { status: 500 });
    ids.push(...(data ?? []).map((o) => o.name).filter(isPhotoId));
    if ((data ?? []).length < 1000) break;
  }
  return NextResponse.json({ ids });
}

/**
 * POST {photos: [{id, thumb, large}]} — 동기화 스크립트(GitHub Actions, 수집 토큰)가 아마란스에서 받은 사진을 넣는다. thumb·large는 base64.
 * JPEG·PNG만, 하나 512KB까지. 이미 있는 id는 덮어쓰지 않는다(id = picFileId는 사진이 바뀌면 바뀐다 — 수집 토큰으로 기존 사진을 바꿔치기 못 하게).
 */
export async function POST(request: NextRequest) {
  const c = await authorize(request);
  if (!c.ok) return c.response;
  const body = (await request.json().catch(() => null)) as { photos?: unknown } | null;
  if (!body || !Array.isArray(body.photos) || body.photos.length > MAX_PER_REQUEST) {
    return NextResponse.json({ error: `photos 배열(최대 ${MAX_PER_REQUEST}개)이 필요합니다.` }, { status: 400 });
  }
  let stored = 0, rejected = 0;
  for (const raw of body.photos as Array<{ id?: unknown; thumb?: unknown; large?: unknown }>) {
    const files = [["thumb", raw?.thumb], ["large", raw?.large]] as const;
    const decoded = files.map(([k, v]) => [k, typeof v === "string" ? Buffer.from(v, "base64") : null] as const);
    if (!isPhotoId(raw?.id) || decoded.some(([, b]) => !b || !b.length || b.length > PHOTO_MAX_BYTES || !sniffImage(b))) {
      rejected++;
      continue;
    }
    for (const [k, b] of decoded) {
      const { error } = await c.admin.storage.from(PHOTO_BUCKET).upload(`${k}/${raw.id}`, b!, { contentType: sniffImage(b!)!, upsert: false });
      if (error && /exists|duplicate/i.test(error.message)) continue; // 이미 있음 — 그대로 둔다
      if (error) return NextResponse.json({ error: `사진 저장 실패: ${error.message}`, stored }, { status: 500 });
    }
    stored++;
  }
  return NextResponse.json({ stored, rejected });
}
