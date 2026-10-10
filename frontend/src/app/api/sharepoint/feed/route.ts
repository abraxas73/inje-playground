import { NextRequest } from "next/server";
import { feed } from "@/lib/sharepoint/client";
import { FEED_KINDS, SharepointError, type FeedKind } from "@/lib/sharepoint/core";
import { withSharepoint } from "@/lib/sharepoint/route";
export const runtime = "nodejs";
/** GET /api/sharepoint/feed?kind=used|shared|trending|recent&limit= — 자주 쓰는·나와 공유·주변에서 많이 보는·최근 연 문서(본인 권한). 인사이트가 꺼진 테넌트면 used는 recent로 갈음(source) */
export async function GET(request: NextRequest) {
  const kind = (request.nextUrl.searchParams.get("kind") ?? "used") as FeedKind;
  const limit = Number(request.nextUrl.searchParams.get("limit")) || 10;
  return withSharepoint(async (token) => {
    if (!FEED_KINDS.includes(kind)) throw new SharepointError("목록 종류가 올바르지 않습니다.", 400);
    return feed(token, kind, limit);
  });
}
