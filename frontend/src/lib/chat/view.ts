import type { ChatEvent, Location, PendingCall } from "./events";

export type ToolView = { id: string; tool: string; location: Location | null; status: "running" | "ok" | "error" | "timeout" | "cancelled"; summary: string };
export type ViewMessage = { id: string; role: "user" | "assistant"; text: string; attachments: Array<{ id: string; name: string }>; tools: ToolView[]; status: "ok" | "failed" | "stopped" | "streaming"; masked: number };
export type ChatView = { conversationId: string | null; messages: ViewMessage[]; pending: PendingCall[] | null; error: { message: string; retryable: boolean } | null; busy: boolean };
type Block = { type: string; text?: string; id?: string; name?: string };
type Row = { id: string; role: "user" | "assistant"; content: Block[]; status: "ok" | "failed" | "stopped"; masked_count: number };
type ToolCallRow = { message_id: string; tool_use_id: string; tool: string; location: Location; status: ToolView["status"]; summary: string };

export const SUGGESTIONS = ["오늘 일정 정리해 줘", "안 읽은 메일 요약해 줘", "Confluence에서 휴가 규정 찾아 줘", "이번 주 주간보고 초안 써 줘"];
export const DRAFT_KEY = "innobot:draft";
export const kstNow = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);
export const emptyView = (id: string | null): ChatView => ({ conversationId: id, messages: [], pending: null, error: null, busy: false });

let seq = 0;
const draft = (): ViewMessage => ({ id: `draft-${++seq}`, role: "assistant", text: "", attachments: [], tools: [], status: "streaming", masked: 0 });
const textOf = (blocks: Block[]) => blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");

/** 저장된 기록 → 말풍선. 도구 결과만 든 user 행은 숨기고(가린 건수는 다음 답에), 도구 왕복으로 이어진 assistant 행은 한 말풍선으로 합친다. */
export function toViewMessages(rows: Row[], toolCalls: ToolCallRow[]): ViewMessage[] {
  const out: ViewMessage[] = [];
  let carryMasked = 0;
  for (const r of rows) {
    const onlyResults = r.role === "user" && r.content.length > 0 && r.content.every((b) => b.type === "tool_result");
    if (onlyResults) { carryMasked += r.masked_count; continue; }
    const tools = toolCalls.filter((t) => t.message_id === r.id).map((t) => ({ id: t.tool_use_id, tool: t.tool, location: t.location, status: t.status, summary: t.summary }));
    const last = out.at(-1);
    if (r.role === "assistant" && last?.role === "assistant") {
      out[out.length - 1] = { ...last, id: r.id, text: last.text + textOf(r.content), tools: [...last.tools, ...tools], status: r.status, masked: last.masked + carryMasked };
    } else {
      out.push({ id: r.id, role: r.role, text: textOf(r.content), attachments: r.content.filter((b) => b.type === "attachment").map((b) => ({ id: b.id!, name: b.name! })), tools, status: r.status, masked: r.role === "user" ? r.masked_count : carryMasked });
    }
    carryMasked = 0;
  }
  return out;
}

const withLast = (v: ChatView, f: (m: ViewMessage) => ViewMessage): ChatView => {
  const i = v.messages.length - 1;
  if (i < 0 || v.messages[i].role !== "assistant") return v;
  const messages = v.messages.slice();
  messages[i] = f(messages[i]);
  return { ...v, messages };
};

export function applyEvent(v: ChatView, e: ChatEvent): ChatView {
  switch (e.type) {
    case "conversation": return { ...v, conversationId: e.id };
    case "text": return withLast(v, (m) => ({ ...m, text: m.text + e.delta }));
    case "tool": return withLast(v, (m) => {
      const t: ToolView = { id: e.id, tool: e.tool, location: e.location, status: e.status, summary: e.summary ?? "" };
      return { ...m, tools: m.tools.some((x) => x.id === e.id) ? m.tools.map((x) => (x.id === e.id ? t : x)) : [...m.tools, t] };
    });
    case "masked": {
      const last = v.messages.at(-1);
      // 답이 아직 비어 있으면 방금 보낸 입력에서 가린 것, 아니면 도구 결과에서 가린 것
      if (last?.role === "assistant" && !last.text && !last.tools.length) {
        const messages = v.messages.slice();
        const ui = messages.length - 2;
        if (ui >= 0 && messages[ui].role === "user") messages[ui] = { ...messages[ui], masked: messages[ui].masked + e.count };
        return { ...v, messages };
      }
      return withLast(v, (m) => ({ ...m, masked: m.masked + e.count }));
    }
    case "needs_action": return { ...withLast(v, (m) => ({ ...m, status: "ok" })), pending: e.calls, busy: false };
    case "done": return { ...withLast(v, (m) => ({ ...m, status: "ok" })), busy: false };
    case "error": return { ...withLast(v, (m) => ({ ...m, status: "failed" })), error: { message: e.message, retryable: e.retryable }, busy: false };
  }
}

export function startUserTurn(v: ChatView, text: string, attachments: Array<{ id: string; name: string }>): ChatView {
  const user: ViewMessage = { id: `local-${++seq}`, role: "user", text, attachments, tools: [], status: "ok", masked: 0 };
  return { ...v, messages: [...v.messages, user, draft()], pending: null, error: null, busy: true };
}
export const startContinuation = (v: ChatView): ChatView => ({ ...v, messages: [...v.messages, draft()], pending: null, error: null, busy: true });
export const startRetry = (v: ChatView): ChatView => ({ ...v, messages: [...v.messages.filter((m) => m.status !== "failed"), draft()], error: null, busy: true });
export const stopView = (v: ChatView): ChatView => ({ ...withLast(v, (m) => (m.status === "streaming" ? { ...m, status: "stopped" } : m)), busy: false });

const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
/** 대화 목록 묶음 — KST 날짜 기준 오늘·어제·지난 7일·이전(빈 묶음은 뺀다). */
export function groupByDate<T extends { last_message_at: string }>(items: T[], now: Date): Array<{ label: string; items: T[] }> {
  const today = Date.parse(kstDate(now));
  const groups: Record<string, T[]> = { "오늘": [], "어제": [], "지난 7일": [], "이전": [] };
  for (const it of items) {
    const days = Math.round((today - Date.parse(kstDate(new Date(it.last_message_at)))) / 86_400_000);
    groups[days <= 0 ? "오늘" : days === 1 ? "어제" : days <= 7 ? "지난 7일" : "이전"].push(it);
  }
  return Object.entries(groups).filter(([, v]) => v.length).map(([label, v]) => ({ label, items: v }));
}
