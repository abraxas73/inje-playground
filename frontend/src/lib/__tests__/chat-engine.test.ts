import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { MAX_SERVER_ROUNDS, parseTurnBody, runTurn, type TurnDeps, type TurnInput } from "@/lib/chat/engine";
import type { ChatStore, ConvRow, MsgRow, StoredBlock } from "@/lib/chat/store";
import type { ChatEvent } from "@/lib/chat/events";

/** 메모리 저장소 — 테스트 전용 */
function memStore() {
  const convs: ConvRow[] = [];
  const msgs: Record<string, MsgRow[]> = {};
  const calls: Array<{ messageId: string; tool: string; status: string; summary: string }> = [];
  let n = 0;
  const claimed = new Set<string>();
  const store: ChatStore = {
    async create(o) { const c = { id: `00000000-0000-0000-0000-00000000000${convs.length + 1}`, user_id: o.userId, title: o.title, model: o.model, ephemeral: o.ephemeral, created_at: "", last_message_at: "", expires_at: o.expiresAt }; convs.push(c); msgs[c.id] = []; return c; },
    async get(userId, id) { return convs.find((c) => c.id === id && c.user_id === userId) ?? null; },
    async messages(id) { return msgs[id].map((m) => ({ ...m, content: JSON.parse(JSON.stringify(m.content)) })); },
    async append(id, m) { const row: MsgRow = { id: `m${++n}`, role: m.role, content: m.content as StoredBlock[], status: m.status ?? "ok", masked_count: m.masked ?? 0, created_at: "" }; msgs[id].push(row); return row.id; },
    async toolCalls(messageId, rows) { calls.push(...rows.map((r) => ({ messageId, tool: r.tool, status: r.status, summary: r.summary }))); },
    async claimToolCalls(messageId, rows) { if (rows.some((r) => claimed.has(`${messageId}:${r.toolUseId}`))) return false; rows.forEach((r) => claimed.add(`${messageId}:${r.toolUseId}`)); return true; },
    async touch() {},
    async linkAttachments() { return []; },
  };
  return { store, convs, msgs, calls };
}
const reply = (content: Anthropic.ContentBlock[], usage = { input_tokens: 10, output_tokens: 5 }) => ({ id: "x", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", content, usage }) as unknown as Anthropic.Message;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.ContentBlock;
const use = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: "tool_use", id, name, input }) as Anthropic.ContentBlock;

let mem: ReturnType<typeof memStore>, events: ChatEvent[], stream: ReturnType<typeof vi.fn>, d: TurnDeps;
const base: TurnInput = { userId: "u1", name: "강", email: "a@innogrid.com", client: "web", model: "claude-sonnet-5-5", ephemeral: false, desktopOnline: true, now: "2026-10-15T15:00" };
const emit = (e: ChatEvent) => { events.push(e); };
beforeEach(() => {
  mem = memStore(); events = [];
  stream = vi.fn();
  d = {
    store: mem.store, allowed: () => true, retentionDays: 90, stream,
    runServer: vi.fn().mockResolvedValue({ ok: true, result: { chats: [{ name: "개발팀" }] } }),
    runRelay: vi.fn().mockResolvedValue({ ok: true, result: { items: [{ subject: "주간보고", phone: "010-1234-5678" }] } }),
    loadAttachments: vi.fn().mockResolvedValue(new Map()),
    recordUsage: vi.fn().mockResolvedValue(undefined), audit: vi.fn().mockResolvedValue(undefined),
  };
});

describe("runTurn", () => {
  it("새 대화 — 마스킹해 저장·전송, 텍스트 스트림, done", async () => {
    stream.mockImplementation(async (_p, onText) => { onText("안녕"); onText("하세요"); return reply([text("안녕하세요")]); });
    await runTurn(d, { ...base, text: "내 번호 010-1111-2222" }, emit);
    expect(events[0]).toMatchObject({ type: "conversation" });
    expect(events).toContainEqual({ type: "masked", count: 1 });
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("안녕하세요");
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const sent = JSON.stringify(stream.mock.calls[0][0].messages);
    expect(sent).toContain("[전화번호]");
    expect(sent).not.toContain("010-1111-2222");
    const id = mem.convs[0].id;
    expect(JSON.stringify(mem.msgs[id])).not.toContain("010-1111-2222");
    expect(mem.convs[0].title).toBe("내 번호 [전화번호]");
    expect(d.recordUsage).toHaveBeenCalledWith({ model: "claude-sonnet-5-5", inputTokens: 10, outputTokens: 5, masked: 1 });
    expect(d.audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((d.audit as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain("번호");
  });
  it("중계 읽기 도구는 바로 실행 — Claude엔 가린 결과 원문, DB엔 요약만", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "list_mail_inbox")])).mockResolvedValueOnce(reply([text("주간보고가 있어요")]));
    await runTurn(d, { ...base, text: "메일 보여 줘" }, emit);
    expect(d.runRelay).toHaveBeenCalledWith("list_mail_inbox", {});
    const second = JSON.stringify(stream.mock.calls[1][0].messages);
    expect(second).toContain("주간보고");
    expect(second).toContain("[전화번호]");
    const stored = JSON.stringify(mem.msgs[mem.convs[0].id]);
    expect(stored).toContain("받은메일 목록 1건: 주간보고");
    expect(stored).not.toContain("phone");
    expect(mem.calls).toEqual([{ messageId: "m2", tool: "list_mail_inbox", status: "ok", summary: "받은메일 목록 1건: 주간보고" }]);
    expect(events.filter((e) => e.type === "tool").map((e) => (e as { status: string }).status)).toEqual(["running", "ok"]);
  });
  it("쓰기 서버 도구는 멈추고 needs_action, 승인하면 실행·이어서 답", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", chat_name: "개발팀", text: "안녕" })]));
    await runTurn(d, { ...base, text: "개발팀에 안녕 보내" }, emit);
    expect(d.runServer).not.toHaveBeenCalled();
    const na = events.find((e) => e.type === "needs_action") as Extract<ChatEvent, { type: "needs_action" }>;
    expect(na.calls).toEqual([{ id: "t1", tool: "teams_send", input: { chat_id: "19:x", chat_name: "개발팀", text: "안녕" }, location: "server", tier: "write" }]);
    events = [];
    stream.mockResolvedValueOnce(reply([text("보냈어요")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: true }] }, emit);
    expect(d.runServer).toHaveBeenCalledWith("teams_send", { chat_id: "19:x", chat_name: "개발팀", text: "안녕" });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
  it("같은 승인 요청이 동시에 두 번 와도 쓰기 도구는 한 번만", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    stream.mockResolvedValue(reply([text("보냈어요")]));
    const go = () => runTurn(d, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: true }] }, emit);
    const r = await Promise.allSettled([go(), go()]);
    expect(d.runServer).toHaveBeenCalledTimes(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason)).toContain("이미 처리 중");
  });
  it("거절하면 실행하지 않고 취소 결과", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    stream.mockResolvedValueOnce(reply([text("취소했어요")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: false }] }, emit);
    expect(d.runServer).not.toHaveBeenCalled();
    expect(mem.calls.at(-1)).toMatchObject({ tool: "teams_send", status: "cancelled" });
  });
  it("앱 — 기기 도구는 앱 결과로 이어 가고, 결과가 없으면 '앱 응답 없음'", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "mail_list"), use("t2", "attendance_today")]));
    await runTurn(d, { ...base, client: "app", text: "메일과 출근" }, emit);
    expect(events.find((e) => e.type === "needs_action")).toBeTruthy();
    stream.mockResolvedValueOnce(reply([text("완료")]));
    await runTurn(d, { ...base, client: "app", conversationId: mem.convs[0].id, actions: [{ id: "t1", result: { items: [{ subject: "a" }] } }] }, emit);
    const sent = JSON.stringify(stream.mock.calls[1][0].messages);
    expect(sent).toContain("앱 응답 없음");
    expect(mem.calls.map((c) => c.status)).toEqual(["ok", "timeout"]);
  });
  it("대기 중 새 입력 — 대기 호출을 취소로 닫고 새 질문 처리", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    stream.mockResolvedValueOnce(reply([text("네, 다른 거요")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, text: "아니 됐고 다른 질문" }, emit);
    const msgs = stream.mock.calls[1][0].messages as Anthropic.MessageParam[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "user"]);
    expect(JSON.stringify(msgs[2])).toContain('"tool_use_id":"t1"');
  });
  it(`서버 도구 왕복은 ${MAX_SERVER_ROUNDS}회까지 — 그다음 호출은 도구 없이`, async () => {
    stream.mockResolvedValue(reply([use("t", "teams_chats")]));
    stream.mockImplementation(async (p) => (p.noTools ? reply([text("끝")]) : reply([use(`t${Math.random()}`, "teams_chats")])));
    await runTurn(d, { ...base, text: "채팅 목록" }, emit);
    expect(stream).toHaveBeenCalledTimes(MAX_SERVER_ROUNDS + 1);
    expect(stream.mock.calls.at(-1)![0].noTools).toBe(true);
    expect(d.recordUsage).toHaveBeenCalledTimes(MAX_SERVER_ROUNDS + 1);
  });
  it("도구 없는 마지막 호출에서 tool_use가 와도 실행하지 않고 done", async () => {
    stream.mockImplementation(async () => reply([use(`t${Math.random()}`, "teams_chats")]));
    await runTurn(d, { ...base, text: "채팅 목록" }, emit);
    expect(stream).toHaveBeenCalledTimes(MAX_SERVER_ROUNDS + 1);
    expect(d.runServer).toHaveBeenCalledTimes(MAX_SERVER_ROUNDS);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
  it("Claude 실패 → failed 저장·error(retryable), 다시 시도 → 실패 응답 빼고 재호출", async () => {
    stream.mockRejectedValueOnce(new Error("overloaded"));
    await runTurn(d, { ...base, text: "질문" }, emit);
    expect(events.at(-1)).toEqual({ type: "error", message: "이노봇이 답하지 못했습니다. 다시 시도해 주세요.", retryable: true });
    expect(d.recordUsage).not.toHaveBeenCalled();
    const id = mem.convs[0].id;
    expect(mem.msgs[id].at(-1)!.status).toBe("failed");
    stream.mockResolvedValueOnce(reply([text("답")]));
    await runTurn(d, { ...base, conversationId: id, retry: true }, emit);
    expect((stream.mock.calls[1][0].messages as unknown[]).length).toBe(1);
  });
  it("중지 — 받은 데까지 stopped로 저장", async () => {
    const ac = new AbortController();
    stream.mockImplementationOnce(async (_p, onText) => { onText("반쯤"); ac.abort(); throw new Error("aborted"); });
    await runTurn({ ...d, signal: ac.signal }, { ...base, text: "길게" }, emit);
    const last = mem.msgs[mem.convs[0].id].at(-1)!;
    expect(last).toMatchObject({ role: "assistant", status: "stopped", content: [{ type: "text", text: "반쯤" }] });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
  it("남의 대화 id → TurnInputError", async () => {
    await expect(runTurn(d, { ...base, conversationId: "00000000-0000-0000-0000-000000000009", text: "x" }, emit)).rejects.toThrow("대화를 찾지 못했습니다");
  });
  it("모르는 도구 이름 → 오류 결과로 바로 답(멈추지 않음)", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "submit_approval")])).mockResolvedValueOnce(reply([text("못 해요")]));
    await runTurn(d, { ...base, text: "결재 올려" }, emit);
    expect(events.some((e) => e.type === "needs_action")).toBe(false);
    expect(mem.calls[0]).toMatchObject({ tool: "submit_approval", status: "error" });
  });
});

describe("parseTurnBody", () => {
  it("입력은 text/첨부·actions·retry 중 하나", () => {
    expect(parseTurnBody({ text: "a" })).toMatchObject({ ok: true, body: { client: "web", ephemeral: false, desktopOnline: false } });
    expect(parseTurnBody({ text: "a", retry: true }).ok).toBe(false);
    expect(parseTurnBody({}).ok).toBe(false);
    expect(parseTurnBody({ actions: [{ id: "t1", approve: true }], conversationId: "00000000-0000-0000-0000-000000000001" }).ok).toBe(true);
    expect(parseTurnBody({ actions: [{ id: "t1" }] }).ok).toBe(false);
  });
  it("길이·개수 제한", () => {
    expect(parseTurnBody({ text: "가".repeat(20_001) }).ok).toBe(false);
    expect(parseTurnBody({ text: "a", attachmentIds: Array(6).fill("00000000-0000-0000-0000-000000000001") }).ok).toBe(false);
    expect(parseTurnBody({ text: "a", attachmentIds: ["../x"] }).ok).toBe(false);
  });
});
