import { NextRequest } from "next/server";
import { JiraError } from "@/lib/jira/config";
import { feed } from "@/lib/confluence/client";
import { FEED_KINDS, type FeedKind } from "@/lib/confluence/core";
import { withConfluence } from "@/lib/confluence/route";
export const runtime = "nodejs";
/** GET /api/confluence/feed?kind=mentions|watching|recent&limit= — 나를 멘션·내가 지켜보는(14일)·내가 편집한 문서 */
export async function GET(request: NextRequest) {
  const kind = (request.nextUrl.searchParams.get("kind") ?? "mentions") as FeedKind;
  const limit = Number(request.nextUrl.searchParams.get("limit")) || 10;
  return withConfluence(async (c) => {
    if (!FEED_KINDS.includes(kind)) throw new JiraError("목록 종류가 올바르지 않습니다.", 400);
    return { kind, items: await feed(c.request, kind, limit), canWrite: c.canWrite };
  });
}
