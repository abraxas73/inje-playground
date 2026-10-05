import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnectionStatus } from "@/lib/ms/connections";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { fetchMe, TEAMS_CHAT_SCOPE } from "@/lib/ms/oauth";
import { listChatMessages, listMyChats, type ChatMessage } from "@/lib/teams/chat";
import { pickMentions, recentChats, type MentionItem } from "@/lib/teams/mentions";

export type MentionsResult = { connected: false; items: [] } | { connected: true; items: MentionItem[] } | { connected: true; response: Response };

/** /api/teams/mentions와 비서 teams_mentions가 공유. Graph 오류는 호출자가 처리하도록 던진다. 토큰 실패는 response로. */
export async function collectMentions(admin: SupabaseClient, userId: string, days: number): Promise<MentionsResult> {
  const status = await getConnectionStatus(admin, userId);
  if (!status.connected || !status.scopes.includes(TEAMS_CHAT_SCOPE)) return { connected: false, items: [] };
  const tok = await graphTokenForRoute(admin, userId);
  if (!tok.ok) return { connected: true, response: tok.response };
  const me = await fetchMe(tok.token);
  const { data: profile } = await admin.from("user_profiles").select("display_name").eq("user_id", userId).maybeSingle();
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
  return { connected: true, items: pickMentions(chats, messagesByChat, { id: me.id, displayName: me.displayName, mail: me.mail, koreanName }, now, days) };
}
