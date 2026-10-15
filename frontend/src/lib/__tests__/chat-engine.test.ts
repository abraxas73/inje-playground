import { beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { MAX_SERVER_ROUNDS, parseTurnBody, runTurn, type TurnDeps, type TurnInput } from "@/lib/chat/engine";
import type { ChatStore, ConvRow, MsgRow, StoredBlock } from "@/lib/chat/store";
import type { ChatEvent } from "@/lib/chat/events";

/** 메모리 저장소 — 테스트 전용 */
function memStore() {
  const convs: ConvRow[] = [];
  const msgs: Record<string, MsgRow[]> = {};
  const calls: Array<{ messageId: string; toolUseId: string; tool: string; status: string; summary: string }> = [];
  let n = 0;
  const claimed = new Set<string>();
  const store: ChatStore = {
    async create(o) { const c = { id: `00000000-0000-0000-0000-00000000000${convs.length + 1}`, user_id: o.userId, title: o.title, model: o.model, ephemeral: o.ephemeral, created_at: "", last_message_at: "", expires_at: o.expiresAt }; convs.push(c); msgs[c.id] = []; return c; },
    async get(userId, id) { return convs.find((c) => c.id === id && c.user_id === userId) ?? null; },
    async messages(id) { return msgs[id].map((m) => ({ ...m, content: JSON.parse(JSON.stringify(m.content)) })); },
    async append(id, m) { const row: MsgRow = { id: `m${++n}`, role: m.role, content: m.content as StoredBlock[], status: m.status ?? "ok", masked_count: m.masked ?? 0, created_at: "" }; msgs[id].push(row); return row.id; },
    async toolCalls(messageId, rows) { calls.push(...rows.map((r) => ({ messageId, toolUseId: r.toolUseId, tool: r.tool, status: r.status, summary: r.summary }))); },
    async recordedCalls(messageId) { return [...claimed].filter((k) => k.startsWith(`${messageId}:`)).map((k) => { const id = k.slice(messageId.length + 1); const r = calls.filter((c) => c.messageId === messageId && c.toolUseId === id).at(-1); return { toolUseId: id, status: (r?.status ?? "running") as "running", summary: r?.summary ?? "" }; }); },
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
    runServer: vi.fn().mockResolvedValue({ ok: true, result: { chats: [{ id: "19:x", name: "개발1팀(실제)", type: "group" }] } }),
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
    expect(mem.calls).toEqual([{ messageId: "m2", toolUseId: "t1", tool: "list_mail_inbox", status: "ok", summary: "받은메일 목록 1건: 주간보고" }]);
    expect(events.filter((e) => e.type === "tool").map((e) => (e as { status: string }).status)).toEqual(["running", "ok"]);
  });
  it("쓰기 서버 도구는 멈추고 needs_action, 승인하면 실행·이어서 답", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", chat_name: "개발팀", text: "안녕" })]));
    await runTurn(d, { ...base, text: "개발팀에 안녕 보내" }, emit);
    expect(d.runServer).not.toHaveBeenCalledWith("teams_send", expect.anything());
    const na = events.find((e) => e.type === "needs_action") as Extract<ChatEvent, { type: "needs_action" }>;
    expect(na.calls).toEqual([{ id: "t1", tool: "teams_send", input: { chat_id: "19:x", chat_name: "개발팀", text: "안녕" }, location: "server", tier: "write", target: "개발1팀(실제)" }]);
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
    expect((d.runServer as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "teams_send")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason)).toContain("이미 처리 중");
  });
  it("거절하면 실행하지 않고 취소 결과", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    stream.mockResolvedValueOnce(reply([text("취소했어요")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: false }] }, emit);
    expect(d.runServer).not.toHaveBeenCalledWith("teams_send", expect.anything());
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
  it("확인 카드 대상은 서버가 조회한 실제 이름(모델이 쓴 chat_name 아님)", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", chat_name: "모델이 지어낸 이름", text: "안녕" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    expect(d.runServer).toHaveBeenCalledWith("teams_chats", {});
    const na = events.find((e) => e.type === "needs_action") as Extract<ChatEvent, { type: "needs_action" }>;
    expect(na.calls[0].target).toBe("개발1팀(실제)");
    expect(d.recordUsage).toHaveBeenCalledTimes(1);
    expect((d.audit as ReturnType<typeof vi.fn>).mock.calls[0][0].tools).toEqual(["teams_send"]);
  });
  it("Confluence 페이지 만들기 대상은 공간 이름(key)", async () => {
    (d.runServer as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, result: { spaces: [{ key: "DEV", name: "개발 공간" }], total: 1, canWrite: true } });
    stream.mockResolvedValueOnce(reply([use("t1", "confluence_create_page", { space_key: "DEV", space_name: "가짜", title: "회의록", markdown: "본문" })]));
    await runTurn(d, { ...base, text: "회의록 만들어" }, emit);
    expect(d.runServer).toHaveBeenCalledWith("confluence_spaces", { key: "DEV" });
    const na = events.find((e) => e.type === "needs_action") as Extract<ChatEvent, { type: "needs_action" }>;
    expect(na.calls[0].target).toBe("개발 공간 (DEV)");
  });
  it("대상을 찾지 못하면 확인 카드 없이 오류 결과로 닫고 이어서 답", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:없음", chat_name: "개발팀", text: "안녕" })])).mockResolvedValueOnce(reply([text("채팅방을 다시 찾을게요")]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    expect(events.some((e) => e.type === "needs_action")).toBe(false);
    expect(d.runServer).not.toHaveBeenCalledWith("teams_send", expect.anything());
    expect(mem.calls).toEqual([expect.objectContaining({ tool: "teams_send", status: "error" })]);
    expect(JSON.stringify(stream.mock.calls[1][0].messages)).toContain("대상을 확인하지 못했습니다");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
  it("자동 실행 중 중지되면 도구 기록만 남기고 tool_result 행은 저장하지 않음", async () => {
    const ac = new AbortController();
    stream.mockResolvedValueOnce(reply([use("t1", "list_mail_inbox")]));
    (d.runRelay as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { ac.abort(); return { ok: true, result: { items: [] } }; });
    await runTurn({ ...d, signal: ac.signal }, { ...base, text: "메일" }, emit);
    const rows = mem.msgs[mem.convs[0].id];
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(mem.calls).toHaveLength(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(d.audit).toHaveBeenCalledTimes(1);
  });
  it("승인 실행 중 중지되면 tool_result 행은 저장하지 않음", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    const ac = new AbortController();
    (d.runServer as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { ac.abort(); return { ok: true, result: { sent: true } }; });
    await runTurn({ ...d, signal: ac.signal }, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: true }] }, emit);
    expect(mem.msgs[mem.convs[0].id].map((r) => r.role)).toEqual(["user", "assistant"]);
    expect(mem.calls.at(-1)).toMatchObject({ tool: "teams_send", status: "ok" });
    expect(stream).toHaveBeenCalledTimes(1);
  });
  it("승인 실행 뒤 끊겨 같은 승인을 다시 보내면 — 다시 실행하지 않고 저장된 결과로 이어서 답", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    const ac = new AbortController();
    (d.runServer as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { ac.abort(); return { ok: true, result: { sent: true } }; });
    await runTurn({ ...d, signal: ac.signal }, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: true }] }, emit);
    events = [];
    stream.mockResolvedValueOnce(reply([text("보냈어요")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: true }] }, emit);
    expect((d.runServer as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "teams_send")).toHaveLength(1);
    const sent = JSON.stringify(stream.mock.calls[1][0].messages);
    expect(sent).toContain(JSON.stringify(mem.calls.at(-1)!.summary));
    expect(sent).not.toContain("취소됨");
    expect(events).toContainEqual(expect.objectContaining({ type: "tool", id: "t1", status: "ok" }));
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
  it("승인 실행 뒤 끊기고 새 입력이 오면 — 취소가 아니라 실행 결과로 닫는다", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    const ac = new AbortController();
    (d.runServer as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { ac.abort(); return { ok: true, result: { sent: true } }; });
    await runTurn({ ...d, signal: ac.signal }, { ...base, conversationId: mem.convs[0].id, actions: [{ id: "t1", approve: true }] }, emit);
    stream.mockResolvedValueOnce(reply([text("네")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, text: "보냈어?" }, emit);
    const sent = JSON.stringify(stream.mock.calls[1][0].messages);
    expect(sent).toContain(JSON.stringify(mem.calls.at(-1)!.summary));
    expect(sent).not.toContain("취소됨");
  });
  it("실행 중(기록 없음)인 승인에 새 입력이 오면 — '실행됐을 수 있음'으로 닫는다", async () => {
    stream.mockResolvedValueOnce(reply([use("t1", "teams_send", { chat_id: "19:x", text: "a" })]));
    await runTurn(d, { ...base, text: "보내" }, emit);
    await mem.store.claimToolCalls(mem.msgs[mem.convs[0].id][1].id, [{ toolUseId: "t1", tool: "teams_send", location: "server" }]);
    stream.mockResolvedValueOnce(reply([text("네")]));
    await runTurn(d, { ...base, conversationId: mem.convs[0].id, text: "다른 질문" }, emit);
    expect(JSON.stringify(stream.mock.calls[1][0].messages)).toContain("실행됐을 수 있음");
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
