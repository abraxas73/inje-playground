import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { CHAT_SEARCH_MAX, CHAT_SEARCH_MIN, searchChatMessages } from "@/lib/teams/chat";
import { graphErrorResponse } from "@/lib/teams/chat-route";

export const runtime = "nodejs";

/** GET /api/teams/chat/search?q= — 내가 속한 그룹·1:1 채팅 메시지 검색(본인 위임 토큰). 검색어·결과는 저장·로그하지 않는다. */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
  if (q.length < CHAT_SEARCH_MIN || q.length > CHAT_SEARCH_MAX) return NextResponse.json({ error: `검색어는 ${CHAT_SEARCH_MIN}~${CHAT_SEARCH_MAX}자로 입력하세요.` }, { status: 400 });
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok.response;
  try {
    return NextResponse.json({ hits: await searchChatMessages(tok.token, q) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
