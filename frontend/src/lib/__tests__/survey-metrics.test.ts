import { describe, it, expect } from "vitest";
import {
  isUserResponse,
  npsFromScores,
  prePostDelta,
  topBoxRatio,
  weightedMean,
  computeRoi,
  trafficLight,
} from "@/lib/survey-metrics";

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

describe("npsFromScores", () => {
  it("추천(≥9)%−비추천(≤6)% with 1-decimal rounding", () => {
    const r = npsFromScores([10, 10, 9, 8, 7, 6, 0]);
    expect(r.n).toBe(7);
    expect(r.promoters_pct).toBe(42.9);
    expect(r.passives_pct).toBe(28.6);
    expect(r.detractors_pct).toBe(28.6);
    expect(r.score).toBe(14.3);
  });
  it("빈 배열은 null score", () => {
    const r = npsFromScores([]);
    expect(r.n).toBe(0);
    expect(r.score).toBeNull();
  });
});

describe("prePostDelta", () => {
  it("pairwise 평균·Δ·개선율", () => {
    const r = prePostDelta([{ before: 3, after: 5 }, { before: 2, after: 4 }]);
    expect(r.n_pairwise).toBe(2);
    expect(r.before_mean).toBe(2.5);
    expect(r.after_mean).toBe(4.5);
    expect(r.delta_mean).toBe(2);
    expect(r.improvement_pct).toBe(80);
  });
  it("빈 입력은 null", () => {
    const r = prePostDelta([]);
    expect(r.n_pairwise).toBe(0);
    expect(r.delta_mean).toBeNull();
    expect(r.improvement_pct).toBeNull();
  });
});

describe("topBoxRatio", () => {
  const counts = [{ value: "5", n: 3 }, { value: "4", n: 2 }, { value: "1", n: 5 }];
  it("top-box 비율(전체 분모)", () => {
    const r = topBoxRatio(counts, ["4", "5"]);
    expect(r.n_valid).toBe(10);
    expect(r.pct).toBe(50);
  });
  it("excludeValues 분모 제외", () => {
    const r = topBoxRatio(counts, ["4", "5"], ["1"]);
    expect(r.n_valid).toBe(5);
    expect(r.pct).toBe(100);
  });
  it("유효 0이면 null", () => {
    expect(topBoxRatio([], ["a"]).pct).toBeNull();
  });
});

describe("weightedMean", () => {
  it("option_midpoints 가중 평균", () => {
    const r = weightedMean([{ value: "a", n: 2 }, { value: "b", n: 2 }], { a: 0, b: 10 });
    expect(r.n).toBe(4);
    expect(r.mean).toBe(5);
  });
});

describe("computeRoi", () => {
  it("절감시간 ROI·회수기간", () => {
    const r = computeRoi({
      avg_weekly_hours_saved: 5, user_count: 10, hourly_cost: 30000,
      annual_license_cost: 6_000_000, weeks_per_year: 48,
    });
    expect(r.annual_hours_saved).toBe(2400);
    expect(r.annual_value).toBe(72_000_000);
    expect(r.net_annual).toBe(66_000_000);
    expect(r.payback_months).toBe(1);
  });
  it("연간 가치 0이면 payback null", () => {
    const r = computeRoi({ avg_weekly_hours_saved: 0, user_count: 0, hourly_cost: 30000, annual_license_cost: 1000 });
    expect(r.payback_months).toBeNull();
  });
});

describe("trafficLight", () => {
  it("target 대비 신호등", () => {
    expect(trafficLight(5, 5)).toBe("green");
    expect(trafficLight(4, 5)).toBe("amber");
    expect(trafficLight(2, 5)).toBe("red");
    expect(trafficLight(3, undefined)).toBe("unset");
    expect(trafficLight(null, 5)).toBe("unset");
  });
});
