import { describe, expect, it } from "vitest";
import { createSseParser } from "@/lib/chat/sse-client";
import { applyEvent, emptyView, groupByDate, startContinuation, startRetry, startUserTurn, stopView, toViewMessages } from "@/lib/chat/view";
import type { ChatEvent } from "@/lib/chat/events";

describe("SSE 파서", () => {
  it("조각난 청크를 이어 붙여 이벤트 단위로 낸다", () => {
    const got: ChatEvent[] = [];
    const feed = createSseParser((e) => got.push(e));
    feed('data: {"type":"text","de'); feed('lta":"가"}\n\ndata: {"type":"done","messageId":"m1"}\n');
    expect(got).toEqual([{ type: "text", delta: "가" }]);
    feed("\n");
    expect(got.at(-1)).toEqual({ type: "done", messageId: "m1" });
  });
});

describe("화면 상태", () => {
  it("보내기 → 텍스트 스트림 → 도구 칩 → 완료", () => {
    let v = startUserTurn(emptyView(null), "메일 요약", [{ id: "a1", name: "x.pdf" }]);
    expect(v.busy).toBe(true);
    for (const e of [{ type: "conversation", id: "c1" }, { type: "masked", count: 1 }, { type: "tool", id: "t1", tool: "list_mail_inbox", location: "desktop-relay", status: "running" }, { type: "tool", id: "t1", tool: "list_mail_inbox", location: "desktop-relay", status: "ok", summary: "받은메일 목록 3건" }, { type: "masked", count: 2 }, { type: "text", delta: "세 통" }, { type: "text", delta: "입니다" }, { type: "done", messageId: "m9" }] as ChatEvent[]) v = applyEvent(v, e);
    expect(v.conversationId).toBe("c1");
    const [user, bot] = v.messages;
    expect(user).toMatchObject({ role: "user", text: "메일 요약", masked: 1, attachments: [{ id: "a1", name: "x.pdf" }] });
    expect(bot).toMatchObject({ role: "assistant", text: "세 통입니다", status: "ok", masked: 2, tools: [{ id: "t1", status: "ok", summary: "받은메일 목록 3건" }] });
    expect(v.busy).toBe(false);
  });
  it("needs_action → 대기 카드, 이어 가기는 새 응답 말풍선", () => {
    let v = startUserTurn(emptyView("c1"), "보내", []);
    v = applyEvent(v, { type: "needs_action", messageId: "m2", calls: [{ id: "t1", tool: "teams_send", input: { text: "a" }, location: "server", tier: "write" }] });
    expect(v.pending).toHaveLength(1);
    expect(v.busy).toBe(false);
    v = startContinuation(v);
    expect(v.pending).toBeNull();
    expect(v.messages.at(-1)).toMatchObject({ role: "assistant", status: "streaming", text: "" });
  });
  it("오류 → failed + 다시 시도 가능, 다시 시도는 실패 말풍선을 새로", () => {
    let v = startUserTurn(emptyView("c1"), "질문", []);
    v = applyEvent(v, { type: "error", message: "실패", retryable: true });
    expect(v.messages.at(-1)!.status).toBe("failed");
    expect(v.error).toEqual({ message: "실패", retryable: true });
    v = startRetry(v);
    expect(v.messages.filter((m) => m.status === "failed")).toHaveLength(0);
    expect(v.messages.at(-1)!.status).toBe("streaming");
  });
  it("중지는 stopped", () => {
    let v = startUserTurn(emptyView("c1"), "길게", []);
    v = applyEvent(v, { type: "text", delta: "반" });
    expect(stopView(v).messages.at(-1)).toMatchObject({ status: "stopped", text: "반" });
  });
  it("저장된 기록 → 말풍선: 도구 결과 메시지는 숨기고 도구 왕복은 한 말풍선으로", () => {
    const rows = [
      { id: "m1", role: "user", content: [{ type: "text", text: "메일" }, { type: "attachment", id: "a1", name: "x.pdf" }], status: "ok", masked_count: 1, created_at: "" },
      { id: "m2", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list_mail_inbox", input: {} }], status: "ok", masked_count: 0, created_at: "" },
      { id: "m3", role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "받은메일 목록 3건" }], status: "ok", masked_count: 2, created_at: "" },
      { id: "m4", role: "assistant", content: [{ type: "text", text: "세 통입니다" }], status: "ok", masked_count: 0, created_at: "" },
    ];
    const v = toViewMessages(rows as never, [{ message_id: "m2", tool_use_id: "t1", tool: "list_mail_inbox", location: "desktop-relay", status: "ok", summary: "받은메일 목록 3건" }]);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ text: "메일", masked: 1, attachments: [{ id: "a1", name: "x.pdf" }] });
    expect(v[1]).toMatchObject({ id: "m4", text: "세 통입니다", masked: 2, tools: [{ id: "t1", summary: "받은메일 목록 3건" }] });
  });
});

describe("날짜 묶기", () => {
  it("오늘·어제·지난 7일·이전(KST)", () => {
    const now = new Date("2026-10-15T03:00:00Z"); // KST 12:00
    const g = groupByDate([
      { id: "a", last_message_at: "2026-10-15T00:30:00Z" },
      { id: "b", last_message_at: "2026-10-14T14:00:00Z" }, // KST 10-14 23:00 → 어제
      { id: "c", last_message_at: "2026-10-10T00:00:00Z" },
      { id: "d", last_message_at: "2026-09-01T00:00:00Z" },
    ], now);
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([["오늘", ["a"]], ["어제", ["b"]], ["지난 7일", ["c"]], ["이전", ["d"]]]);
  });
});
