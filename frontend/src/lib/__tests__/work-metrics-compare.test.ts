import { describe, expect, it } from "vitest";
import { adoptionWindows, prevRange } from "@/lib/work-metrics/compare";
import { ADOPTION_DATE } from "@/lib/work-metrics/adoption";

describe("prevRange", () => {
  it("같은 길이의 직전 기간 — 30일", () => {
    expect(prevRange({ from: "2026-08-30", to: "2026-09-28" })).toEqual({ from: "2026-07-31", to: "2026-08-29" });
  });
  it("하루짜리 기간은 그 전날 하루", () => {
    expect(prevRange({ from: "2026-09-01", to: "2026-09-01" })).toEqual({ from: "2026-08-31", to: "2026-08-31" });
  });
  it("월 경계·윤년을 넘는다", () => {
    expect(prevRange({ from: "2028-03-01", to: "2028-03-02" })).toEqual({ from: "2028-02-28", to: "2028-02-29" });
  });
});

describe("adoptionWindows", () => {
  it("도입일 전 4주·후 4주", () => {
    expect(adoptionWindows("2026-08-27")).toEqual({ date: "2026-08-27", before: { from: "2026-07-30", to: "2026-08-26" }, after: { from: "2026-08-27", to: "2026-09-23" } });
    expect(adoptionWindows().date).toBe(ADOPTION_DATE);
  });
});
