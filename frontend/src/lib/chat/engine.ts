import type Anthropic from "@anthropic-ai/sdk";
import type { PageKey } from "@/lib/page-access";
import { assistantSystemPrompt } from "@/lib/assistant/tools";
import type { ToolRun } from "@/lib/assistant/server-tools";
import type { ActionReply, ChatEvent, Location, PendingCall } from "./events";
import { maskText } from "./mask";
import { ORG_TOOLS, buildToolset, clientPromptLines, needsAction, tierOf } from "./toolset";
import { featureCard } from "@/lib/assistant/feature-tools";
import { summarizeToolResult } from "./summary";
import { attachmentIdsIn, cancelResult, expiresAt, historyForModel, pendingCalls, titleFrom, type ChatStore, type StoredBlock, type ToolCallRecord } from "./store";

export const MAX_SERVER_ROUNDS = 3;
export const TEXT_MAX = 20_000, ATTACH_MAX = 5, ACTIONS_MAX = 20;
const FAIL_MSG = "이노봇이 답하지 못했습니다. 다시 시도해 주세요.";
const TARGET_FAIL = "대상을 확인하지 못했습니다. 채팅방·공간을 다시 찾아 주세요.";

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

type Call = { id: string; tool: string; input: Record<string, unknown>; location: Location | null; tier: string; target?: string };

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
    if (!(await d.store.claimToolCalls(pending.messageId, pending.uses.map((u) => { const c = callOf(u); return { toolUseId: c.id, tool: c.tool, location: c.location ?? "server" }; })))) {
      // 앞선 승인 요청이 실행·기록까지 마치고 결과 행 저장 전에 끊긴 경우: 다시 실행하지 않고 그 기록으로 닫고 이어 간다
      const recs = await d.store.recordedCalls(pending.messageId);
      const byId = new Map(recs.map((r) => [r.toolUseId, r]));
      if (pending.uses.some((u) => (byId.get(u.id)?.status ?? "running") === "running")) throw new TurnInputError("이미 처리 중인 작업입니다.");
      for (const u of pending.uses) { const r = byId.get(u.id)!; emit({ type: "tool", id: u.id, tool: u.name, location: callOf(u).location, status: r.status === "ok" ? "ok" : "error", summary: r.summary }); }
      await d.store.append(convId, { role: "user", content: closeWithRecords(pending.uses, recs) });
      used.push(...pending.uses.map((u) => u.name));
    } else {
      const r = await executeCalls(d, pending.uses.map(callOf), inp.actions, emit);
      await d.store.toolCalls(pending.messageId, r.records);
      // 중지 뒤엔 결과 행을 붙이지 않는다 — 그새 시작된 다음 요청 뒤에 끼면 짝 없는 tool_result로 대화가 깨진다. 결과는 도구 기록에서 되살린다.
      if (d.signal?.aborted) return finish();
      await d.store.append(convId, { role: "user", content: r.stored, masked: r.masked });
      r.live.forEach((v, k) => live.set(k, v)); masked += r.masked; used.push(...r.records.map((x) => x.tool));
    }
  } else if (inp.retry) {
    const last = rows.filter((r) => r.status !== "failed").at(-1);
    if (!last || last.role !== "user") throw new TurnInputError("다시 시도할 질문이 없습니다.");
  } else {
    if (pending) await d.store.append(convId, { role: "user", content: closeWithRecords(pending.uses, await d.store.recordedCalls(pending.messageId)) });
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
    let unresolved = new Set<string>();
    if (calls.some(needsAction)) {
      unresolved = await resolveTargets(d, calls);
      // 대상을 못 찾은 호출이 있으면 확인 카드 없이 그 응답 전체를 닫는다(못 찾은 건 오류, 쓰기는 미승인) — 모델이 다시 묻는다
      if (!unresolved.size) {
        used.push(...calls.map((c) => c.tool));
        emit({ type: "needs_action", messageId, calls: calls.map((c) => ({ ...c, location: c.location ?? "server", ...(featureCard(c.tool, c.input) ? { card: featureCard(c.tool, c.input)! } : {}) })) as PendingCall[] });
        return finish();
      }
    }
    const r = await executeCalls(d, calls, null, emit, unresolved);
    await d.store.toolCalls(messageId, r.records);
    if (d.signal?.aborted) return finish();
    await d.store.append(convId, { role: "user", content: r.stored, masked: r.masked });
    r.live.forEach((v, k) => live.set(k, v)); masked += r.masked; lastMasked = r.masked; used.push(...r.records.map((x) => x.tool));
    if (r.masked) emit({ type: "masked", count: r.masked });
  }
}

/** 답 없이 남은 도구 호출을 닫는 결과 — 실행 기록이 있으면 그 요약(끊긴 요청에서 실제로 실행된 쓰기를 '취소'로 남기지 않게), 실행 중이면 "실행됐을 수 있음", 없으면 취소. */
function closeWithRecords(uses: Anthropic.ToolUseBlockParam[], recs: Awaited<ReturnType<ChatStore["recordedCalls"]>>): Anthropic.ToolResultBlockParam[] {
  const byId = new Map(recs.map((r) => [r.toolUseId, r]));
  return uses.map((u) => {
    const r = byId.get(u.id);
    if (!r) return cancelResult(u.id);
    if (r.status === "running") return cancelResult(u.id, "처리 중 연결이 끊겨 결과를 확인하지 못함 — 실행됐을 수 있음");
    return { type: "tool_result", tool_use_id: u.id, content: r.summary, ...(r.status === "ok" ? {} : { is_error: true }) };
  });
}

/** 이번 요청에서 실행한 도구 결과는 요약 대신 가린 원문으로 Claude에 넘긴다. */
function withLive(messages: Anthropic.MessageParam[], live: Map<string, string>): Anthropic.MessageParam[] {
  if (!live.size) return messages;
  return messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.map((b) => (b.type === "tool_result" && live.has(b.tool_use_id) ? { ...b, content: live.get(b.tool_use_id)! } : b)) } : m));
}

/** 확인 카드에 보일 실제 대상(채팅방·공간 이름)을 서버가 조회해 c.target에 넣는다. 못 찾은 호출 id를 돌려준다. 조회는 사용량·감사에 세지 않는다. */
async function resolveTargets(d: TurnDeps, calls: Call[]): Promise<Set<string>> {
  const bad = new Set<string>();
  for (const c of calls) {
    if (c.location !== "server" || c.tier === "read") continue;
    if (c.tool === "teams_send") {
      const r = await d.runServer("teams_chats", {});
      const hit = r.ok ? (r.result as { chats?: Array<{ id: string; name?: string | null }> }).chats?.find((x) => x.id === c.input.chat_id) : undefined;
      if (hit) c.target = hit.name?.trim() || "이름 없는 채팅"; else bad.add(c.id);
    } else if (c.tool === "confluence_create_page") {
      const key = typeof c.input.space_key === "string" ? c.input.space_key.trim() : "";
      const r = key ? await d.runServer("confluence_spaces", { key }) : null;
      const s = r?.ok ? (r.result as { spaces?: Array<{ key: string; name: string }> }).spaces?.find((x) => x.key === key) : undefined;
      if (s) c.target = `${s.name} (${s.key})`; else bad.add(c.id);
    }
  }
  return bad;
}

async function executeCalls(d: TurnDeps, calls: Call[], replies: ActionReply[] | null, emit: (e: ChatEvent) => void, unresolved = new Set<string>()) {
  const stored: Anthropic.ToolResultBlockParam[] = [];
  const records: ToolCallRecord[] = [];
  const live = new Map<string, string>();
  let masked = 0;
  for (const c of calls) {
    emit({ type: "tool", id: c.id, tool: c.tool, location: c.location, status: "running" });
    const reply = replies?.find((r) => r.id === c.id);
    let run: ToolRun, status: ToolCallRecord["status"];
    if (!c.location) { run = { ok: false, error: "이 화면에서 쓸 수 없는 도구입니다." }; status = "error"; }
    else if (unresolved.has(c.id)) { run = { ok: false, error: TARGET_FAIL }; status = "error"; }
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
