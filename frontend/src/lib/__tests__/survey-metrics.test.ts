import { describe, it, expect } from "vitest";
import { isUserResponse } from "@/lib/survey-metrics";

describe("isUserResponse (value-key 기준)", () => {
  it("S0Q3 '사용한 적 없음'(never) → 비사용자", () => {
    expect(isUserResponse({ s0q3_value: "never", s0q4_value: "w3_4" })).toBe(false);
  });
  it("S0Q4 '거의 사용 안 함'(rarely) → 비사용자", () => {
    expect(isUserResponse({ s0q3_value: "1_3m", s0q4_value: "rarely" })).toBe(false);
  });
  it("둘 다 사용 신호('1_3m','w3_4') → 사용자", () => {
    expect(isUserResponse({ s0q3_value: "1_3m", s0q4_value: "w3_4" })).toBe(true);
  });
  it("미응답(null) → 사용자 가정(스킵 안 함)", () => {
    expect(isUserResponse({ s0q3_value: null, s0q4_value: null })).toBe(true);
  });
});
