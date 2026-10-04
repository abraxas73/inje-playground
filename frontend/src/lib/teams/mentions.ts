/**
 * Teams 답장 대기(멘션·DM) 선별 — 홈 브리핑용. 그룹 채팅은 내 이름이 들어간 남의 메시지, 1:1은 남의 메시지 전부,
 * 그 뒤에 내가 보낸 메시지가 있으면(이미 답함) 제외. 순수 함수만 두고 Graph 호출은 라우트가 한다. 본문은 저장·로그하지 않는다.
 */
import type { ChatMessage, ChatSummary } from "./chat";

export interface MentionItem { id: string; chatId: string; topic: string; type: "group" | "oneOnOne"; from: string; text: string; at: string; webUrl: string | null }
export interface MeLike { id: string; displayName: string; mail?: string | null; givenName?: string | null; koreanName?: string | null }
export const MENTION_TEXT_MAX = 200;
export const MENTION_CHAT_LIMIT = 15;
export const MENTION_RESULT_LIMIT = 10;
const DAY = 86400000;

/** 기간 안에 활동한 채팅만, 최근 순(listMyChats가 이미 정렬) 최대 limit */
export function recentChats(chats: ChatSummary[], now: Date, days: number, limit = MENTION_CHAT_LIMIT): ChatSummary[] {
  const since = now.getTime() - days * DAY;
  return chats.filter((c) => c.lastUpdated && Date.parse(c.lastUpdated) >= since).slice(0, limit);
}

/** 멘션으로 볼 이름 후보 — 표시 이름(영문일 수 있음), 이름, 메일 로컬파트, 알고 있는 한글 이름. 2글자 미만은 뺀다. */
export function nameCandidates(me: MeLike): string[] {
  const local = me.mail?.split("@")[0] ?? "";
  return [me.displayName, me.givenName ?? "", local, me.koreanName ?? ""].map((s) => s.trim()).filter((s, i, a) => s.length >= 2 && a.indexOf(s) === i);
}
export function mentionsName(text: string, candidates: string[]): boolean {
  return candidates.some((n) => text.includes(n));
}

export function pickMentions(chats: ChatSummary[], messagesByChat: Record<string, ChatMessage[]>, me: MeLike, now: Date, days: number): MentionItem[] {
  const since = now.getTime() - days * DAY;
  const names = nameCandidates(me);
  const out: MentionItem[] = [];
  for (const chat of chats) {
    const msgs = (messagesByChat[chat.id] ?? []).filter((m) => Date.parse(m.createdAt) >= since);
    const myLast = Math.max(0, ...msgs.filter((m) => m.from?.id === me.id).map((m) => Date.parse(m.createdAt)));
    for (const m of msgs) {
      if (!m.from || m.from.id === me.id || !m.text.trim()) continue;
      if (Date.parse(m.createdAt) <= myLast) continue; // 이미 답함
      if (chat.type === "group" && !mentionsName(m.text, names)) continue;
      out.push({ id: m.id, chatId: chat.id, topic: chat.topic, type: chat.type, from: m.from.name, text: m.text.length > MENTION_TEXT_MAX ? `${m.text.slice(0, MENTION_TEXT_MAX)}…` : m.text, at: m.createdAt, webUrl: chat.webUrl });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MENTION_RESULT_LIMIT);
}
