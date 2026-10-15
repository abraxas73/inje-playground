import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Location } from "./events";

export type StoredBlock = Anthropic.ContentBlockParam | { type: "attachment"; id: string; name: string };
export type ConvRow = { id: string; user_id: string; title: string; model: string; ephemeral: boolean; created_at: string; last_message_at: string; expires_at: string };
export type MsgRow = { id: string; role: "user" | "assistant"; content: StoredBlock[]; status: "ok" | "failed" | "stopped"; masked_count: number; created_at: string };
export type AttachmentRow = { id: string; name: string; mime: string; kind: "text" | "image" | "pdf"; storage_path: string; masked_count: number };
export type ToolCallRecord = { toolUseId: string; tool: string; location: Location; status: "ok" | "error" | "timeout" | "cancelled"; summary: string };

export interface ChatStore {
  create(o: { userId: string; model: string; ephemeral: boolean; title: string; expiresAt: string }): Promise<ConvRow>;
  get(userId: string, id: string): Promise<ConvRow | null>;
  messages(convId: string): Promise<MsgRow[]>;
  append(convId: string, m: { role: "user" | "assistant"; content: StoredBlock[]; status?: MsgRow["status"]; inputTokens?: number; outputTokens?: number; masked?: number }): Promise<string>;
  toolCalls(messageId: string, rows: ToolCallRecord[]): Promise<void>;
  /** 실행 전 선점 — 이미 선점됐으면 false(승인 요청 중복 실행 방지). */
  claimToolCalls(messageId: string, rows: Array<{ toolUseId: string; tool: string; location: Location }>): Promise<boolean>;
  touch(convId: string, o: { model: string; expiresAt: string }): Promise<void>;
  linkAttachments(userId: string, ids: string[], convId: string): Promise<AttachmentRow[]>;
}

const CONV_COLS = "id,user_id,title,model,ephemeral,created_at,last_message_at,expires_at";
const ATT_COLS = "id,name,mime,kind,storage_path,masked_count";
const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error || r.data === null) throw new Error(`${what} 실패: ${r.error?.message ?? "no data"}`);
  return r.data;
};

/** service_role 클라이언트 위의 저장소. 소유자 확인은 get·linkAttachments가 user_id로 건다(다른 메서드는 확인된 대화 id로만 불린다). */
export function supabaseChatStore(admin: SupabaseClient): ChatStore {
  return {
    async create(o) {
      return must(await admin.from("chat_conversations").insert({ user_id: o.userId, model: o.model, ephemeral: o.ephemeral, title: o.title, expires_at: o.expiresAt }).select(CONV_COLS).single(), "대화 만들기") as ConvRow;
    },
    async get(userId, id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await admin.from("chat_conversations").select(CONV_COLS).eq("id", id).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`대화 조회 실패: ${error.message}`);
      return (data as ConvRow | null) ?? null;
    },
    async messages(convId) {
      return (must(await admin.from("chat_messages").select("id,role,content,status,masked_count,created_at").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(400), "메시지 조회") as MsgRow[]).reverse();
    },
    async append(convId, m) {
      const row = must(await admin.from("chat_messages").insert({ conversation_id: convId, role: m.role, content: m.content, status: m.status ?? "ok", input_tokens: m.inputTokens ?? 0, output_tokens: m.outputTokens ?? 0, masked_count: m.masked ?? 0 }).select("id").single(), "메시지 저장") as { id: string };
      return row.id;
    },
    async toolCalls(messageId, rows) {
      if (!rows.length) return;
      const { error } = await admin.from("chat_tool_calls").upsert(rows.map((r) => ({ message_id: messageId, tool_use_id: r.toolUseId, tool: r.tool, location: r.location, status: r.status, summary: r.summary })), { onConflict: "message_id,tool_use_id" });
      if (error) throw new Error(`도구 기록 실패: ${error.message}`);
    },
    async claimToolCalls(messageId, rows) {
      const { error } = await admin.from("chat_tool_calls").insert(rows.map((r) => ({ message_id: messageId, tool_use_id: r.toolUseId, tool: r.tool, location: r.location, status: "running", summary: "" })));
      if (error?.code === "23505") return false;
      if (error) throw new Error(`도구 선점 실패: ${error.message}`);
      return true;
    },
    async touch(convId, o) {
      const { error } = await admin.from("chat_conversations").update({ model: o.model, last_message_at: new Date().toISOString(), expires_at: o.expiresAt }).eq("id", convId);
      if (error) throw new Error(`대화 갱신 실패: ${error.message}`);
    },
    async linkAttachments(userId, ids, convId) {
      if (!ids.length) return [];
      const { data, error } = await admin.from("chat_attachments").update({ conversation_id: convId }).in("id", ids).eq("user_id", userId).is("conversation_id", null).select(ATT_COLS);
      if (error) throw new Error(`첨부 연결 실패: ${error.message}`);
      return (data ?? []) as AttachmentRow[];
    },
  };
}

export const cancelResult = (id: string, why = "취소됨(사용자가 다른 요청을 함)"): Anthropic.ToolResultBlockParam => ({ type: "tool_result", tool_use_id: id, content: why, is_error: true });
const isToolUse = (b: StoredBlock): b is Anthropic.ToolUseBlockParam => b.type === "tool_use";
const hasToolResult = (r: MsgRow | undefined) => !!r && r.role === "user" && r.content.some((b) => b.type === "tool_result");

/** 저장된 기록 → Claude 메시지. 실패 응답 제외, 첨부 펼침, 답 없이 지나간 도구 호출은 취소 결과로 닫는다(Anthropic은 짝 없는 tool_use를 거부). */
export function historyForModel(rows: MsgRow[], attachments: Map<string, Anthropic.ContentBlockParam[]>): Anthropic.MessageParam[] {
  let live = rows.filter((r) => r.status !== "failed");
  // 최근 400행으로 잘렸을 때 앞쪽 고아(assistant·tool_result만 든 user)를 버린다 — Anthropic은 user 텍스트로 시작해야 한다.
  const start = live.findIndex((r) => r.role === "user" && !hasToolResult(r));
  live = start < 0 ? [] : live.slice(start);
  const out: Anthropic.MessageParam[] = [];
  let missing: Anthropic.ToolResultBlockParam[] = [];
  live.forEach((r, i) => {
    const content = r.content.flatMap((b): Anthropic.ContentBlockParam[] => b.type === "attachment" ? (attachments.get(b.id) ?? [{ type: "text", text: `[첨부: ${b.name} — 보존 기간이 지나 내용을 읽을 수 없음]` }]) : [b]);
    if (!content.length) return;
    out.push({ role: r.role, content: [...missing, ...content] });
    missing = [];
    const uses = r.role === "assistant" ? r.content.filter(isToolUse) : [];
    const next = live[i + 1];
    if (!uses.length || !next) return;
    if (!hasToolResult(next)) out.push({ role: "user", content: uses.map((u) => cancelResult(u.id)) });
    else {
      // 일부 id에만 답한 경우: 빠진 id의 취소 결과를 다음 user 행 앞에 합친다(tool_result는 바로 다음 메시지에 있어야 함).
      const answered = new Set(next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : [])));
      missing = uses.filter((u) => !answered.has(u.id)).map((u) => cancelResult(u.id));
    }
  });
  return out;
}

/** 마지막 메시지가 답을 기다리는 도구 호출이면 그 호출들. */
export function pendingCalls(rows: MsgRow[]): { messageId: string; uses: Anthropic.ToolUseBlockParam[] } | null {
  const live = rows.filter((r) => r.status !== "failed");
  const last = live[live.length - 1];
  if (!last || last.role !== "assistant") return null;
  const uses = last.content.filter(isToolUse);
  return uses.length ? { messageId: last.id, uses } : null;
}

export const attachmentIdsIn = (rows: MsgRow[]) => rows.flatMap((r) => r.content.flatMap((b) => (b.type === "attachment" ? [b.id] : [])));
export const expiresAt = (now: Date, ephemeral: boolean, retentionDays: number) => new Date(now.getTime() + (ephemeral ? 24 : retentionDays * 24) * 3600_000).toISOString();
export const titleFrom = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 30) || "새 대화";
