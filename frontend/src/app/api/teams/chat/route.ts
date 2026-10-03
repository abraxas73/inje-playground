import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { getConnectionStatus } from "@/lib/ms/connections";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { fetchMe, TEAMS_CHAT_SCOPE } from "@/lib/ms/oauth";
import { getChatInfo } from "@/lib/teams/chat";
import { graphErrorResponse, loadChatTarget } from "@/lib/teams/chat-route";

export const runtime = "nodejs";

/**
 * GET /api/teams/chat — 채팅 페이지 준비 상태.
 * configured(관리자가 그룹 채팅을 지정했나) → connected/hasChatScope(내 Microsoft 연결에 Chat.ReadWrite가 있나) → 준비되면 주제·webUrl·내 Graph id.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const target = await loadChatTarget();
  if (!target.chatId) return NextResponse.json({ configured: false });
  const status = await getConnectionStatus(auth.admin, auth.userId);
  const hasChatScope = status.connected && status.scopes.includes(TEAMS_CHAT_SCOPE);
  if (!status.connected || !hasChatScope) return NextResponse.json({ configured: true, topic: target.topic, connected: status.connected, hasChatScope: false });
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok.response;
  try {
    const [info, me] = await Promise.all([getChatInfo(tok.token, target.chatId), fetchMe(tok.token)]);
    return NextResponse.json({ configured: true, topic: info.topic ?? target.topic, connected: true, hasChatScope: true, webUrl: info.webUrl, meId: me.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
