import { describe, expect, it } from "vitest";
import { attachmentIdsIn, expiresAt, historyForModel, pendingCalls, titleFrom, type MsgRow } from "@/lib/chat/store";

const row = (id: string, role: MsgRow["role"], content: MsgRow["content"], status: MsgRow["status"] = "ok"): MsgRow => ({ id, role, content, status, masked_count: 0, created_at: "" });
const use = (id: string) => ({ type: "tool_use" as const, id, name: "read_mail", input: { muid: "1" } });

describe("historyForModel", () => {
  it("실패한 응답은 빼고, 첨부는 펼친다", () => {
    const h = historyForModel([
      row("1", "user", [{ type: "text", text: "요약해 줘" }, { type: "attachment", id: "a1", name: "보고.docx" }]),
      row("2", "assistant", [{ type: "text", text: "" }], "failed"),
    ], new Map([["a1", [{ type: "text", text: "[첨부: 보고.docx]\n본문" }]]]));
    expect(h).toEqual([{ role: "user", content: [{ type: "text", text: "요약해 줘" }, { type: "text", text: "[첨부: 보고.docx]\n본문" }] }]);
  });
  it("보존 기간이 지나 첨부가 없으면 안내 텍스트", () => {
    const h = historyForModel([row("1", "user", [{ type: "attachment", id: "gone", name: "옛.pdf" }])], new Map());
    expect(JSON.stringify(h)).toContain("옛.pdf");
  });
  it("답 없는 도구 호출 뒤에 다른 메시지가 오면 취소 결과를 끼운다", () => {
    const h = historyForModel([
      row("1", "user", [{ type: "text", text: "메일" }]),
      row("2", "assistant", [use("t1")]),
      row("3", "user", [{ type: "text", text: "그만, 다른 거" }]),
    ], new Map());
    expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user", "user"]);
    expect(JSON.stringify(h[2])).toContain('"tool_use_id":"t1"');
  });
  it("마지막이 답 없는 도구 호출이면 그대로 둔다(대기)", () => {
    const rows = [row("1", "user", [{ type: "text", text: "메일" }]), row("2", "assistant", [use("t1")])];
    expect(historyForModel(rows, new Map())).toHaveLength(2);
    expect(pendingCalls(rows)).toEqual({ messageId: "2", uses: [use("t1")] });
    expect(pendingCalls([...rows, row("3", "user", [{ type: "tool_result", tool_use_id: "t1", content: "ok" }])])).toBeNull();
  });
});
describe("historyForModel 보강", () => {
  it("잘려 앞이 고아면 user 텍스트 행부터 시작", () => {
    const h = historyForModel([
      row("1", "assistant", [use("t0")]),
      row("2", "user", [{ type: "tool_result", tool_use_id: "t0", content: "ok" }]),
      row("3", "user", [{ type: "text", text: "다음" }]),
    ], new Map());
    expect(h).toEqual([{ role: "user", content: [{ type: "text", text: "다음" }] }]);
  });
  it("일부 id에만 답했으면 빠진 id를 취소로 닫는다", () => {
    const h = historyForModel([
      row("1", "user", [{ type: "text", text: "메일" }]),
      row("2", "assistant", [use("t1"), use("t2")]),
      row("3", "user", [{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
    ], new Map());
    expect(h).toHaveLength(3);
    expect(JSON.stringify(h[2])).toContain('"tool_use_id":"t2"');
    expect(JSON.stringify(h[2])).toContain('"tool_use_id":"t1"');
  });
});
describe("historyForModel 짝 없는 tool_result", () => {
  it("직전 assistant의 tool_use에 없는 tool_result는 버린다(늦게 붙은 결과)", () => {
    const rows = [
      row("1", "user", [{ type: "text", text: "메일" }]),
      row("2", "assistant", [use("t1")]),
      row("3", "user", [{ type: "tool_result", tool_use_id: "t1", content: "취소됨", is_error: true }]),
      row("4", "user", [{ type: "text", text: "다른 질문" }]),
      row("5", "assistant", [{ type: "text", text: "B 답" }]),
      row("6", "user", [{ type: "tool_result", tool_use_id: "t1", content: "늦은 결과" }]),
      row("7", "user", [{ type: "tool_result", tool_use_id: "t9", content: "x" }, { type: "text", text: "또 질문" }]),
    ];
    const h = historyForModel(rows, new Map());
    expect(JSON.stringify(h)).not.toContain("늦은 결과");
    expect(JSON.stringify(h)).not.toContain("t9");
    expect(JSON.stringify(h.at(-1))).toContain("또 질문");
    // 모든 tool_result는 바로 앞 assistant 메시지의 tool_use에 대응
    h.forEach((m, i) => {
      if (!Array.isArray(m.content)) return;
      const ids = m.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []));
      if (!ids.length) return;
      const prev = h[i - 1];
      expect(prev.role).toBe("assistant");
      const uses = (prev.content as Array<{ type: string; id?: string }>).filter((b) => b.type === "tool_use").map((b) => b.id);
      ids.forEach((id) => expect(uses).toContain(id));
    });
  });
});
describe("보조 함수", () => {
  it("만료일 — 저장 안 함은 24시간", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(expiresAt(now, false, 90)).toBe("2027-01-13T00:00:00.000Z");
    expect(expiresAt(now, true, 90)).toBe("2026-10-16T00:00:00.000Z");
  });
  it("제목은 공백 정리 후 30자", () => {
    expect(titleFrom("  안녕\n하세요  ")).toBe("안녕 하세요");
    expect(titleFrom("가".repeat(40))).toHaveLength(30);
    expect(titleFrom("")).toBe("새 대화");
  });
  it("첨부 id 모으기", () => {
    expect(attachmentIdsIn([row("1", "user", [{ type: "attachment", id: "a", name: "x" }, { type: "text", text: "t" }])])).toEqual(["a"]);
  });
});
