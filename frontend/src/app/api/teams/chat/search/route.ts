import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { getConnectionStatus } from "@/lib/ms/connections";
import { TEAMS_SEARCH_SCOPE } from "@/lib/ms/oauth";
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
  // 토큰 발급이 빠진 스코프를 재연결 없이 받아 저장하므로(connections.refreshWithUpgrade) 권한 확인은 발급 뒤에
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok.response;
  const status = await getConnectionStatus(auth.admin, auth.userId);
  if (status.connected && !status.scopes.includes(TEAMS_SEARCH_SCOPE)) {
    return NextResponse.json({ error: "메시지 검색 권한이 아직 없습니다. Microsoft 계정을 다시 연결하면 권한이 추가됩니다.", code: "reconnect_search" }, { status: 409 });
  }
  try {
    return NextResponse.json({ hits: await searchChatMessages(tok.token, q) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
