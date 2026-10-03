import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { getConnectionStatus } from "@/lib/ms/connections";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { fetchMe, TEAMS_CHAT_SCOPE } from "@/lib/ms/oauth";
import { listMyChats } from "@/lib/teams/chat";
import { graphErrorResponse } from "@/lib/teams/chat-route";

export const runtime = "nodejs";

/**
 * GET /api/teams/chat — 채팅 페이지 준비 상태 + 내가 속한 채팅 목록.
 * connected/hasChatScope(내 Microsoft 연결에 Chat.ReadWrite가 있나) → 준비되면 meId와 chats(그룹·1:1, 최근 순).
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const status = await getConnectionStatus(auth.admin, auth.userId);
  const hasChatScope = status.connected && status.scopes.includes(TEAMS_CHAT_SCOPE);
  if (!status.connected || !hasChatScope) return NextResponse.json({ connected: status.connected, hasChatScope: false });
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok.response;
  try {
    const me = await fetchMe(tok.token);
    const chats = await listMyChats(tok.token, me.id);
    return NextResponse.json({ connected: true, hasChatScope: true, meId: me.id, chats }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
