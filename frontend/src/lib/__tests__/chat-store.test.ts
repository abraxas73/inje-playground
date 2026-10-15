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
