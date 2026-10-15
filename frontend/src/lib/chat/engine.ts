import type Anthropic from "@anthropic-ai/sdk";
import type { PageKey } from "@/lib/page-access";
import { assistantSystemPrompt } from "@/lib/assistant/tools";
import type { ToolRun } from "@/lib/assistant/server-tools";
import type { ActionReply, ChatEvent, Location, PendingCall } from "./events";
import { maskText } from "./mask";
import { ORG_TOOLS, buildToolset, clientPromptLines, needsAction, tierOf } from "./toolset";
import { summarizeToolResult } from "./summary";
import { attachmentIdsIn, cancelResult, expiresAt, historyForModel, pendingCalls, titleFrom, type ChatStore, type StoredBlock, type ToolCallRecord } from "./store";

export const MAX_SERVER_ROUNDS = 3;
export const TEXT_MAX = 20_000, ATTACH_MAX = 5, ACTIONS_MAX = 20;
const FAIL_MSG = "이노봇이 답하지 못했습니다. 다시 시도해 주세요.";

export type StreamFn = (p: { model: string; system: Anthropic.TextBlockParam[]; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[]; noTools: boolean }, onText: (t: string) => void, signal?: AbortSignal) => Promise<Anthropic.Message>;
export type TurnInput = { userId: string; name: string; email: string; client: "web" | "app"; conversationId?: string; text?: string; attachmentIds?: string[]; actions?: ActionReply[]; retry?: boolean; model: string; ephemeral: boolean; desktopOnline: boolean; now: string };
export type TurnDeps = {
  store: ChatStore; allowed: (k: PageKey) => boolean; retentionDays: number; stream: StreamFn;
  runServer: (tool: string, args: Record<string, unknown>) => Promise<ToolRun>;
  runRelay: (tool: string, args: Record<string, unknown>) => Promise<ToolRun>;
  loadAttachments: (ids: string[]) => Promise<Map<string, Anthropic.ContentBlockParam[]>>;
  recordUsage: (u: { model: string; inputTokens: number; outputTokens: number; masked: number }) => Promise<void>;
  audit: (d: { tools: string[]; model: string; inputTokens: number; outputTokens: number; masked: number; client: string }) => Promise<void>;
  signal?: AbortSignal;
};
export class TurnInputError extends Error {}

type Call = { id: string; tool: string; input: Record<string, unknown>; location: Location | null; tier: string };

/**
 * 한 요청 = 사용자 입력(또는 확인·앱 결과, 다시 시도) → Claude 호출(서버·중계 읽기 도구는 최대 3회 왕복) → 저장.
 * 확인·앱 실행이 필요한 호출이 나오면 needs_action으로 멈춘다. 결과 원문은 이 요청 안에서만 Claude에 넘기고 DB엔 요약만 남긴다.
 */
export async function runTurn(d: TurnDeps, inp: TurnInput, emit: (e: ChatEvent) => void): Promise<void> {
  let conv = inp.conversationId ? await d.store.get(inp.userId, inp.conversationId) : null;
  if (inp.conversationId && !conv) throw new TurnInputError("대화를 찾지 못했습니다.");
  if (!conv) {
    if (inp.text === undefined && !inp.attachmentIds?.length) throw new TurnInputError("첫 메시지가 필요합니다.");
    conv = await d.store.create({ userId: inp.userId, model: inp.model, ephemeral: inp.ephemeral, title: titleFrom(maskText(inp.text ?? "").text || "첨부 파일"), expiresAt: expiresAt(new Date(), inp.ephemeral, d.retentionDays) });
  }
  const convId = conv.id, ephemeral = conv.ephemeral;
  emit({ type: "conversation", id: convId });
  const toolset = buildToolset({ client: inp.client, desktopOnline: inp.desktopOnline, allowed: d.allowed });
  const callOf = (u: { id: string; name: string; input: unknown }): Call => ({ id: u.id, tool: u.name, input: (u.input ?? {}) as Record<string, unknown>, location: toolset.location[u.name] ?? null, tier: tierOf(u.name) });
  const live = new Map<string, string>();
  const used: string[] = [];
  let masked = 0, tin = 0, tout = 0, lastMasked = 0;
  const finish = () => d.audit({ tools: used, model: inp.model, inputTokens: tin, outputTokens: tout, masked, client: inp.client });

  const rows = await d.store.messages(convId);
  const pending = pendingCalls(rows);
  if (inp.actions) {
    if (!pending) throw new TurnInputError("처리할 작업이 없습니다.");
    if (!(await d.store.claimToolCalls(pending.messageId, pending.uses.map((u) => { const c = callOf(u); return { toolUseId: c.id, tool: c.tool, location: c.location ?? "server" }; })))) throw new TurnInputError("이미 처리 중인 작업입니다.");
    const r = await executeCalls(d, pending.uses.map(callOf), inp.actions, emit);
    await d.store.toolCalls(pending.messageId, r.records);
    await d.store.append(convId, { role: "user", content: r.stored, masked: r.masked });
    r.live.forEach((v, k) => live.set(k, v)); masked += r.masked; used.push(...r.records.map((x) => x.tool));
  } else if (inp.retry) {
    const last = rows.filter((r) => r.status !== "failed").at(-1);
    if (!last || last.role !== "user") throw new TurnInputError("다시 시도할 질문이 없습니다.");
  } else {
    if (pending) await d.store.append(convId, { role: "user", content: pending.uses.map((u) => cancelResult(u.id)) });
    const m = maskText(inp.text ?? "");
    const atts = inp.attachmentIds?.length ? await d.store.linkAttachments(inp.userId, inp.attachmentIds, convId) : [];
    masked += m.count + atts.reduce((s, a) => s + a.masked_count, 0);
    const content: StoredBlock[] = [...(m.text ? [{ type: "text" as const, text: m.text }] : []), ...atts.map((a) => ({ type: "attachment" as const, id: a.id, name: a.name }))];
    if (!content.length) throw new TurnInputError("보낼 내용이 없습니다.");
    await d.store.append(convId, { role: "user", content, masked });
  }
  if (masked) emit({ type: "masked", count: masked });

  const system = assistantSystemPrompt({ now: inp.now, name: inp.name, email: inp.email }, clientPromptLines(inp.client, inp.desktopOnline));
  for (let round = 0; ; round++) {
    const all = await d.store.messages(convId);
    const atts = await d.loadAttachments(attachmentIdsIn(all));
    const messages = withLive(historyForModel(all, atts), live);
    let partial = "";
    let msg: Anthropic.Message;
    try {
      msg = await d.stream({ model: inp.model, system, tools: toolset.tools, messages, noTools: round >= MAX_SERVER_ROUNDS }, (t) => { partial += t; emit({ type: "text", delta: t }); }, d.signal);
    } catch (e) {
      if (d.signal?.aborted) {
        if (partial) await d.store.append(convId, { role: "assistant", content: [{ type: "text", text: partial }], status: "stopped" });
      } else {
        console.error("[chat] Claude 호출 실패:", e instanceof Error ? e.message.slice(0, 200) : e);
        await d.store.append(convId, { role: "assistant", content: [{ type: "text", text: partial }], status: "failed" });
        emit({ type: "error", message: FAIL_MSG, retryable: true });
      }
      await d.store.touch(convId, { model: inp.model, expiresAt: expiresAt(new Date(), ephemeral, d.retentionDays) });
      return finish();
    }
    tin += msg.usage.input_tokens; tout += msg.usage.output_tokens;
    const messageId = await d.store.append(convId, { role: "assistant", content: msg.content as unknown as StoredBlock[], inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });
    await d.recordUsage({ model: inp.model, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, masked: round === 0 ? masked : lastMasked });
    await d.store.touch(convId, { model: inp.model, expiresAt: expiresAt(new Date(), ephemeral, d.retentionDays) });
    const calls = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use").map(callOf);
    if (!calls.length || round >= MAX_SERVER_ROUNDS) { emit({ type: "done", messageId }); return finish(); }
    if (calls.some(needsAction)) {
      used.push(...calls.map((c) => c.tool));
      emit({ type: "needs_action", messageId, calls: calls.map((c) => ({ ...c, location: c.location ?? "server" })) as PendingCall[] });
      return finish();
    }
    const r = await executeCalls(d, calls, null, emit);
    await d.store.toolCalls(messageId, r.records);
    await d.store.append(convId, { role: "user", content: r.stored, masked: r.masked });
    r.live.forEach((v, k) => live.set(k, v)); masked += r.masked; lastMasked = r.masked; used.push(...r.records.map((x) => x.tool));
    if (r.masked) emit({ type: "masked", count: r.masked });
  }
}

/** 이번 요청에서 실행한 도구 결과는 요약 대신 가린 원문으로 Claude에 넘긴다. */
function withLive(messages: Anthropic.MessageParam[], live: Map<string, string>): Anthropic.MessageParam[] {
  if (!live.size) return messages;
  return messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.map((b) => (b.type === "tool_result" && live.has(b.tool_use_id) ? { ...b, content: live.get(b.tool_use_id)! } : b)) } : m));
}

async function executeCalls(d: TurnDeps, calls: Call[], replies: ActionReply[] | null, emit: (e: ChatEvent) => void) {
  const stored: Anthropic.ToolResultBlockParam[] = [];
  const records: ToolCallRecord[] = [];
  const live = new Map<string, string>();
  let masked = 0;
  for (const c of calls) {
    emit({ type: "tool", id: c.id, tool: c.tool, location: c.location, status: "running" });
    const reply = replies?.find((r) => r.id === c.id);
    let run: ToolRun, status: ToolCallRecord["status"];
    if (!c.location) { run = { ok: false, error: "이 화면에서 쓸 수 없는 도구입니다." }; status = "error"; }
    else if (c.location === "device") {
      if (reply && "result" in reply) { run = reply.isError ? { ok: false, error: String(reply.result).slice(0, 2000) } : { ok: true, result: reply.result }; status = run.ok ? "ok" : "error"; }
      else { run = { ok: false, error: "앱 응답 없음" }; status = "timeout"; }
    } else if (c.tier !== "read" && !reply?.approve) { run = { ok: false, error: "사용자가 취소했습니다." }; status = "cancelled"; }
    else {
      run = c.location === "server" ? await d.runServer(c.tool, c.input) : await d.runRelay(c.tool, c.input);
      status = run.ok ? "ok" : /시간 초과/.test(run.error) ? "timeout" : "error";
    }
    const m = maskText(run.ok ? JSON.stringify(run.result ?? null) : run.error, { keepPhone: ORG_TOOLS.has(c.tool) });
    masked += m.count;
    let view: unknown = m.text;
    if (run.ok) { try { view = JSON.parse(m.text); } catch { view = m.text; } }
    const summary = summarizeToolResult(c.tool, run.ok, view);
    live.set(c.id, m.text);
    stored.push({ type: "tool_result", tool_use_id: c.id, content: summary, ...(run.ok ? {} : { is_error: true }) });
    records.push({ toolUseId: c.id, tool: c.tool, location: c.location ?? "server", status, summary });
    emit({ type: "tool", id: c.id, tool: c.tool, location: c.location, status: run.ok ? "ok" : "error", summary });
  }
  return { stored, records, live, masked };
}

export type TurnBody = { conversationId?: string; text?: string; attachmentIds?: string[]; actions?: ActionReply[]; retry?: boolean; model?: string; client: "web" | "app"; ephemeral: boolean; desktopOnline: boolean; now?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 요청 본문 검사 — 입력은 (text·첨부) | actions | retry 중 정확히 하나. */
export function parseTurnBody(raw: unknown): { ok: true; body: TurnBody } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "본문 형식이 올바르지 않습니다." };
  const o = raw as Record<string, unknown>;
  const bad = (error: string) => ({ ok: false as const, error });
  if (o.conversationId !== undefined && (typeof o.conversationId !== "string" || !UUID.test(o.conversationId))) return bad("대화 id가 올바르지 않습니다.");
  if (o.text !== undefined && (typeof o.text !== "string" || o.text.length > TEXT_MAX)) return bad(`메시지는 ${TEXT_MAX.toLocaleString("ko-KR")}자까지 보낼 수 있습니다.`);
  if (o.attachmentIds !== undefined && (!Array.isArray(o.attachmentIds) || o.attachmentIds.length > ATTACH_MAX || !o.attachmentIds.every((x) => typeof x === "string" && UUID.test(x)))) return bad(`첨부는 ${ATTACH_MAX}개까지입니다.`);
  if (o.actions !== undefined && (!Array.isArray(o.actions) || !o.actions.length || o.actions.length > ACTIONS_MAX || !o.actions.every((a) => a && typeof a === "object" && typeof (a as ActionReply).id === "string" && ("approve" in a || "result" in a)))) return bad("작업 응답 형식이 올바르지 않습니다.");
  const hasInput = o.text !== undefined || (Array.isArray(o.attachmentIds) && o.attachmentIds.length > 0);
  const kinds = [hasInput, o.actions !== undefined, o.retry === true].filter(Boolean).length;
  if (kinds !== 1) return bad("입력·작업 응답·다시 시도 중 하나만 보내세요.");
  if (o.actions !== undefined && o.conversationId === undefined) return bad("대화 id가 필요합니다.");
  if (o.retry === true && o.conversationId === undefined) return bad("대화 id가 필요합니다.");
  return { ok: true, body: {
    conversationId: o.conversationId as string | undefined,
    text: o.text as string | undefined,
    attachmentIds: o.attachmentIds as string[] | undefined,
    actions: o.actions as ActionReply[] | undefined,
    retry: o.retry === true,
    model: typeof o.model === "string" ? o.model : undefined,
    client: o.client === "app" ? "app" : "web",
    ephemeral: o.ephemeral === true,
    desktopOnline: o.desktopOnline === true,
    now: typeof o.now === "string" ? o.now : undefined,
  } };
}
