import { describe, expect, it } from "vitest";
import { TIER_TO_API, normalizeTier } from "@/lib/claude-usage/seat-tier";
import { hasSeat } from "@/lib/claude-usage/aggregate";

describe("seat-tier", () => {
  it("claude.ai API 값·화면 표기·한글을 Standard/Premium/Unassigned로 정규화한다", () => {
    expect(normalizeTier("team_standard")).toBe("Standard");
    expect(normalizeTier(" Standard ")).toBe("Standard");
    expect(normalizeTier("스탠다드")).toBe("Standard");
    expect(normalizeTier("team_tier_1")).toBe("Premium");
    expect(normalizeTier("PREMIUM")).toBe("Premium");
    expect(normalizeTier("프리미엄")).toBe("Premium");
    expect(normalizeTier("unassigned")).toBe("Unassigned");
    expect(normalizeTier("할당되지 않음")).toBe("Unassigned");
    expect(normalizeTier("")).toBe("Unassigned");
    expect(normalizeTier(null)).toBe("Unassigned");
    expect(normalizeTier(undefined)).toBe("Unassigned");
  });
  it("모르는 값은 첫 글자만 대문자로 남긴다(정보 손실 없이)", () => {
    expect(normalizeTier("enterprise")).toBe("Enterprise");
  });
  it("Unassigned는 hasSeat=false, 나머지는 true", () => {
    expect(hasSeat(normalizeTier("unassigned"))).toBe(false);
    expect(hasSeat(normalizeTier("team_standard"))).toBe(true);
  });
  it("API 매핑 표", () => {
    expect(TIER_TO_API).toEqual({ Standard: "team_standard", Premium: "team_tier_1", Unassigned: "unassigned" });
  });
});
