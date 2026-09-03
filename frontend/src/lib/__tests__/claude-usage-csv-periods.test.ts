import { describe, expect, it } from "vitest";
import { buildPeriodOptions, periodLabel } from "@/lib/claude-usage/csv-periods";

describe("buildPeriodOptions", () => {
  it("종료일 기준으로 묶어 최신순 정렬하고 조직 수·가장 이른 시작일을 준다", () => {
    const opts = buildPeriodOptions([
      { org_id: "a", period_start: "2026-08-04", period_end: "2026-09-02" },
      { org_id: "b", period_start: "2026-08-03", period_end: "2026-09-02" },
      { org_id: "a", period_start: "2026-07-05", period_end: "2026-08-03" },
      { org_id: "a", period_start: "2026-08-04", period_end: "2026-09-02" }, // 같은 조직 재업로드
    ]);
    expect(opts).toEqual([
      { end: "2026-09-02", start: "2026-08-03", orgs: 2 },
      { end: "2026-08-03", start: "2026-07-05", orgs: 1 },
    ]);
  });
  it("빈 목록은 빈 배열", () => {
    expect(buildPeriodOptions([])).toEqual([]);
  });
  it("periodLabel", () => {
    expect(periodLabel({ start: "2026-08-04", end: "2026-09-02" })).toBe("2026-08-04 ~ 2026-09-02");
  });
});
