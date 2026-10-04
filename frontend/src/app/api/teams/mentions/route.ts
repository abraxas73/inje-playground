import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { getConnectionStatus } from "@/lib/ms/connections";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { fetchMe, TEAMS_CHAT_SCOPE } from "@/lib/ms/oauth";
import { listChatMessages, listMyChats, type ChatMessage } from "@/lib/teams/chat";
import { graphErrorResponse } from "@/lib/teams/chat-route";
import { pickMentions, recentChats } from "@/lib/teams/mentions";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/teams/mentions?days=2 — 홈 브리핑용 "Teams 답장 대기". 최근 days일 안에 활동한 채팅(최대 15)을 5개씩 읽어
 * 그룹은 내 이름(Graph displayName·메일 로컬파트·앱 표시 이름)이 든 남의 메시지, 1:1은 남의 메시지를 모으고 내가 그 뒤에 답한 건 뺀다.
 * Microsoft 미연결·Chat.ReadWrite 없음 → {connected:false}. 본문은 전달만, 저장·로그 없음.
 */
export async function GET(request: NextRequest) {
  const daysRaw = Number(request.nextUrl.searchParams.get("days") ?? "2");
  const days = Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 7 ? daysRaw : 2;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const status = await getConnectionStatus(auth.admin, auth.userId);
  if (!status.connected || !status.scopes.includes(TEAMS_CHAT_SCOPE)) return NextResponse.json({ connected: false, items: [] }, { headers: NO_STORE });
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok.response;
  try {
    const me = await fetchMe(tok.token);
    const { data: profile } = await auth.admin.from("user_profiles").select("display_name").eq("user_id", auth.userId).maybeSingle();
    const koreanName = (profile as { display_name?: string | null } | null)?.display_name ?? null;
    const now = new Date();
    const chats = recentChats(await listMyChats(tok.token, me.id), now, days);
    const since = new Date(now.getTime() - days * 86400000).toISOString();
    const messagesByChat: Record<string, ChatMessage[]> = {};
    for (let i = 0; i < chats.length; i += 5) {
      const batch = chats.slice(i, i + 5);
      const results = await Promise.all(batch.map((c) => listChatMessages(tok.token, c.id, since).catch(() => [] as ChatMessage[])));
      batch.forEach((c, k) => { messagesByChat[c.id] = results[k]; });
    }
    const items = pickMentions(chats, messagesByChat, { id: me.id, displayName: me.displayName, mail: me.mail, koreanName }, now, days);
    return NextResponse.json({ connected: true, items }, { headers: NO_STORE });
  } catch (e) {
    return graphErrorResponse(e);
  }
}
