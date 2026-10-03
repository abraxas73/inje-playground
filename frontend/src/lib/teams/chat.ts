/**
 * Teams 그룹 채팅(지정 1개) — Microsoft Graph 위임 호출(Chat.ReadWrite). 서버 전용.
 * 메시지 본문(HTML)은 텍스트로 정리해 돌려주고, 채팅 내용은 저장·로그하지 않는다.
 */
import type { FetchLike } from "@/lib/notify/types";
import { GRAPH_BASE } from "@/lib/teams-graph";
import { GraphError, fetchWithRetry } from "@/lib/ms/graph-drive";

export const TEAMS_CHAT_SETTING_KEYS = ["teams_chat_id", "teams_chat_topic"] as const;
export const CHAT_MESSAGE_MAX = 4000;

export interface ChatMessage {
  id: string;
  createdAt: string;
  modifiedAt: string;
  from: { id: string; name: string } | null;
  text: string;
  attachments: number;
}

export interface GroupChatSummary {
  id: string;
  topic: string;
  members: string[];
  webUrl: string | null;
  lastUpdated: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Teams 메시지 HTML → 읽기 좋은 텍스트. 멘션은 @이름, 링크는 "글 (주소)", 이미지는 [이미지], 첨부 자리표시자는 제거, 빈 줄은 버린다. */
export function teamsHtmlToText(html: string): string {
  let s = html;
  s = s.replace(/<attachment\b[^>]*>[\s\S]*?<\/attachment>/gi, "").replace(/<attachment\b[^>]*\/?>/gi, "");
  s = s.replace(/<img\b[^>]*>/gi, "[이미지]");
  s = s.replace(/<at\b[^>]*>([\s\S]*?)<\/at>/gi, "@$1");
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
    const t = decodeEntities(text.replace(/<[^>]+>/g, "")).trim();
    const h = decodeEntities(href);
    return !t || t === h ? h : `${t} (${h})`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, "\n");
  s = decodeEntities(s.replace(/<[^>]+>/g, ""));
  return s.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l !== "").join("\n");
}

export function normalizeChatMessage(r: unknown): ChatMessage | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (o.messageType !== "message" || o.deletedDateTime) return null;
  const from = o.from as Record<string, Record<string, unknown> | undefined> | null | undefined;
  const who = from?.user ?? from?.application ?? null;
  const body = o.body as { contentType?: string; content?: string } | undefined;
  const content = body?.content ?? "";
  return {
    id: String(o.id ?? ""),
    createdAt: String(o.createdDateTime ?? ""),
    modifiedAt: String(o.lastModifiedDateTime ?? o.createdDateTime ?? ""),
    from: who ? { id: String(who.id ?? ""), name: String(who.displayName ?? "") } : null,
    text: body?.contentType === "html" ? teamsHtmlToText(content) : content.trim(),
    attachments: Array.isArray(o.attachments) ? o.attachments.length : 0,
  };
}

/** 목록 응답 → message 종류만(시스템 이벤트·삭제 제외), 오래된 것부터 */
export function normalizeChatMessages(json: unknown): ChatMessage[] {
  const value = (json as { value?: unknown } | null)?.value;
  const list = Array.isArray(value) ? value : [];
  return list.map(normalizeChatMessage).filter((m): m is ChatMessage => m !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function chatMessagesUrl(chatId: string, since?: string): string {
  const base = `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages?$top=50`;
  return since ? `${base}&$filter=${encodeURIComponent(`lastModifiedDateTime gt ${since}`)}` : base;
}

async function graph(token: string, url: string, init: RequestInit, fetchImpl: FetchLike): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) };
  const res = await fetchWithRetry(fetchImpl, url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let code = `http_${res.status}`;
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      // JSON이 아닌 오류 본문
    }
    throw new GraphError(res.status, code, message, res.headers.get("request-id"));
  }
  return res.status === 204 ? null : res.json();
}

export async function listChatMessages(token: string, chatId: string, since?: string, fetchImpl: FetchLike = fetch): Promise<ChatMessage[]> {
  return normalizeChatMessages(await graph(token, chatMessagesUrl(chatId, since), {}, fetchImpl));
}

export async function sendChatMessage(token: string, chatId: string, text: string, fetchImpl: FetchLike = fetch): Promise<ChatMessage> {
  const j = await graph(token, `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages`, { method: "POST", body: JSON.stringify({ body: { contentType: "text", content: text } }) }, fetchImpl);
  const now = new Date().toISOString();
  return normalizeChatMessage(j) ?? { id: String((j as { id?: unknown } | null)?.id ?? ""), createdAt: now, modifiedAt: now, from: null, text, attachments: 0 };
}

/** 관리자 "고르기"용: 내가 참여한 그룹 채팅. 주제가 없으면 구성원 이름을 주제로. 최근 활동 순. */
export async function listMyGroupChats(token: string, fetchImpl: FetchLike = fetch): Promise<GroupChatSummary[]> {
  const url = `${GRAPH_BASE}/me/chats?$filter=${encodeURIComponent("chatType eq 'group'")}&$expand=${encodeURIComponent("members($select=displayName)")}&$top=50`;
  const j = (await graph(token, url, {}, fetchImpl)) as { value?: Array<Record<string, unknown>> } | null;
  return (j?.value ?? [])
    .map((c) => {
      const members = (Array.isArray(c.members) ? c.members : []).map((m) => String((m as { displayName?: unknown }).displayName ?? "")).filter(Boolean);
      return {
        id: String(c.id ?? ""),
        topic: typeof c.topic === "string" && c.topic ? c.topic : members.join(", "),
        members,
        webUrl: typeof c.webUrl === "string" ? c.webUrl : null,
        lastUpdated: typeof c.lastUpdatedDateTime === "string" ? c.lastUpdatedDateTime : null,
      };
    })
    .sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""));
}

export async function getChatInfo(token: string, chatId: string, fetchImpl: FetchLike = fetch): Promise<{ id: string; topic: string | null; webUrl: string | null }> {
  const j = (await graph(token, `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}?$select=id,topic,webUrl,chatType`, {}, fetchImpl)) as Record<string, unknown>;
  return { id: String(j.id ?? chatId), topic: typeof j.topic === "string" && j.topic ? j.topic : null, webUrl: typeof j.webUrl === "string" ? j.webUrl : null };
}
