/**
 * Teams 답장 대기(멘션·DM) 선별 — 홈 브리핑용. 그룹 채팅은 내 이름이 들어간 남의 메시지, 1:1은 남의 메시지 전부,
 * 그 뒤에 내가 보낸 메시지가 있으면(이미 답함) 제외, 짧은 맞장구("네"·"넵 감사합니다")도 제외. 순수 함수만 두고 Graph 호출은 라우트가 한다. 본문은 저장·로그하지 않는다.
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

/**
 * 답이 필요 없는 짧은 맞장구 — "네", "넵!!", "네 감사합니다", "넵 괜찮아요." 같은 글. 모든 낱말이 맞장구 낱말이고 물음표가 없을 때만.
 * 질문·요청이 섞이면(예: "네 내일 몇 시죠?") 맞장구가 아니다.
 */
const ACK_WORDS = new Set([
  "네", "넵", "넹", "네네", "넵넵", "예", "옙", "예예", "ㅇㅇ", "ㅇㅋ", "ㅇㅋㅇㅋ", "오케이", "ok", "okay", "okk", "굿", "good", "thanks", "thx", "감사", "땡큐",
  "알겠습니다", "알겠어요", "알겠습니당", "알겠슴다", "알았어요", "알았습니다", "확인", "확인했습니다", "확인했어요", "확인했습니당", "확인완료",
  "감사합니다", "감사해요", "감사합니당", "감사드립니다", "고맙습니다", "고마워요", "고마워",
  "좋아요", "좋습니다", "좋네요", "괜찮아요", "괜찮습니다", "괜찮네요", "수고하셨습니다", "수고하세요", "수고하셨어요", "넵알겠습니다", "네알겠습니다",
]);
export function isAcknowledgement(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 30 || /[?？]/.test(t)) return false;
  // 문장부호·이모지·웃음(ㅎㅎ·ㅋㅋ)·물결은 걷어 낸다
  const words = t
    .replace(/[ㅎㅋ]{2,}/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((w) => ACK_WORDS.has(w));
}

/**
 * 답장이 필요한 글 — 질문(물음표·"~까요/~나요/~죠" 같은 물음 끝말)이거나 요청("~주세요", "부탁", "회신", "알려" 등)일 때만.
 * 알림·소감·맞장구("네 좋은 생각입니다!", "공유드립니다")는 답장 대기로 보지 않는다(2026-10-23 사용자 결정 — 놓치는 건이 조금 생길 수 있음).
 */
const QUESTION_END = /(인가요|신가요|는가요|던가요|한가요|있나요|없나요|나요|까요|세요|죠|지요|니까|는지|을까|할까|건가|인가|냐)$/;
const REQUEST = /(주세요|주시겠|주실|주시면|주시기|주십|부탁|해줘|해 줘|줄래|줄 수|바랍니다|바래요|요청드|회신|답변|알려|가능할까|가능하신|가능한지|가능하실|어떠세요|어떠신|어때요|어떨까|어떻게 생각)/;
export function needsReply(text: string): boolean {
  const t = text.trim();
  if (!t || isAcknowledgement(t)) return false;
  if (/[?？]/.test(t)) return true;
  if (REQUEST.test(t)) return true;
  // 문장 끝마다(마침표·느낌표·줄바꿈으로 나눈 조각) 물음 끝말인지 — 웃음·이모지·물결은 걷어 낸다
  return t.split(/[.!\n。]+/).some((p) => QUESTION_END.test(p.replace(/[ㅎㅋ]{2,}/g, "").replace(/[^\p{L}\p{N}\s]/gu, "").trim()));
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
      if (!needsReply(m.text)) continue; // 질문·요청만 — 맞장구·알림·소감은 답할 필요 없음
      if (chat.type === "group" && !mentionsName(m.text, names)) continue;
      out.push({ id: m.id, chatId: chat.id, topic: chat.topic, type: chat.type, from: m.from.name, text: m.text.length > MENTION_TEXT_MAX ? `${m.text.slice(0, MENTION_TEXT_MAX)}…` : m.text, at: m.createdAt, webUrl: chat.webUrl });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MENTION_RESULT_LIMIT);
}
