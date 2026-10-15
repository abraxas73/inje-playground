// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { kstDay, recordUsage, turnsToday } from "@/lib/chat/usage";
import { parseModels, pickModel, retentionDays } from "@/lib/assistant/settings";

describe("사용량", () => {
  it("KST 날짜 — UTC 15:00은 다음 날", () => {
    expect(kstDay(new Date("2026-10-15T14:59:00Z"))).toBe("2026-10-15");
    expect(kstDay(new Date("2026-10-15T15:00:00Z"))).toBe("2026-10-16");
  });
  it("오늘 턴 수 — 행 없음 0, 오류 null", async () => {
    const q = (data: unknown, error: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }) }) });
    expect(await turnsToday(q(null, null) as never, "u1")).toBe(0);
    expect(await turnsToday(q({ turns: 7 }, null) as never, "u1")).toBe(7);
    expect(await turnsToday(q(null, { message: "x" }) as never, "u1")).toBeNull();
  });
  it("기록은 RPC 한 번", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await recordUsage({ rpc } as never, { userId: "u1", model: "claude-opus-5-5", inputTokens: 10, outputTokens: 3, masked: 1 }, new Date("2026-10-15T01:00:00Z"));
    expect(rpc).toHaveBeenCalledWith("chat_usage_add", { p_user: "u1", p_day: "2026-10-15", p_model: "claude-opus-5-5", p_in: 10, p_out: 3, p_masked: 1 });
  });
});
describe("설정 해석", () => {
  it("허용 모델 — 모르는 값은 버리고 비면 기본 둘", () => {
    expect(parseModels("")).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(parseModels("claude-sonnet-5-5, gpt-x")).toEqual(["claude-sonnet-5-5"]);
  });
  it("모델 고르기 — 허용 밖이면 Sonnet", () => {
    const all = ["claude-sonnet-5-5", "claude-opus-5-5"];
    expect(pickModel("claude-opus-5-5", all)).toBe("claude-opus-5-5");
    expect(pickModel("claude-opus-5-5", ["claude-sonnet-5-5"])).toBe("claude-sonnet-5-5");
    expect(pickModel(undefined, all)).toBe("claude-sonnet-5-5");
  });
  it("보존일 — 1~3650 정수, 아니면 90", () => {
    expect(retentionDays("30")).toBe(30);
    expect(retentionDays("0")).toBe(90);
    expect(retentionDays("abc")).toBe(90);
  });
});
