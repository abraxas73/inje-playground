import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { isPhotoId, PHOTO_BUCKET } from "@/lib/directory/photos";

export const runtime = "nodejs";

/**
 * GET /api/directory/photo/{id}[?size=large] — 조직도 직원 사진(비공개 버킷 사본). 로그인 + org_chart 권한(proxy가 /api/directory로 확인).
 * id(아마란스 picFileId)는 사진이 바뀌면 바뀌므로 브라우저에 오래 캐시해도 된다(공유 캐시는 안 됨).
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!isPhotoId(id)) return NextResponse.json({ error: "잘못된 사진입니다." }, { status: 400 });
  const size = request.nextUrl.searchParams.get("size") === "large" ? "large" : "thumb";
  const { data, error } = await auth.admin.storage.from(PHOTO_BUCKET).download(`${size}/${id}`);
  if (error || !data) return NextResponse.json({ error: "사진이 없습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(await data.arrayBuffer(), {
    headers: { "Content-Type": data.type === "image/png" ? "image/png" : "image/jpeg", "Cache-Control": "private, max-age=604800, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
