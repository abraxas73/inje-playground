import { describe, it, expect } from "vitest";
import {
  isUserResponse,
  npsFromScores,
  prePostDelta,
  topBoxRatio,
  weightedMean,
  computeRoi,
  trafficLight,
  KPI_REGISTRY,
  buildKpiCards,
} from "@/lib/survey-metrics";
import type { SurveyResultSummary } from "@/types/survey";

function summaryFixture(): SurveyResultSummary {
  return {
    survey_id: "s1",
    total_responses: 30,
    complete_rate: 100,
    avg_duration_sec: 400,
    segments_applied: [],
    questions: [
      // pre_post_overall (S1Q1)
      {
        question_id: "q1", section: "S1", order_index: 0, type: "pre_post_scale",
        title: "생산성", n: 30, masked: false,
        stats: {
          n_pairwise: 30, before_mean: 2.5, after_mean: 4.3, delta_mean: 1.8,
          improvement_pct: 72, before_distribution: [], after_distribution: [],
        },
        // @ts-expect-error runtime KPI meta from RPC
        analysis_metric: "pre_post_overall", target: 1,
      },
      // weekly_hours_saved (S2Q1)
      {
        question_id: "q2", section: "S2", order_index: 1, type: "number",
        title: "절감시간", n: 30, masked: false,
        stats: {
          n: 30, mean: 5, median: 4, sum: 150, min: 0, max: 40,
          mean_trimmed: 4.5, zero_pct: 10, unit: "시간/주",
        },
        // @ts-expect-error runtime KPI meta
        analysis_metric: "weekly_hours_saved", target: null,
      },
      // nps (S4Q1)
      {
        question_id: "q3", section: "S4", order_index: 2, type: "nps",
        title: "추천의향", n: 30, masked: false,
        stats: { n: 30, score: 40, promoters_pct: 60, passives_pct: 20, detractors_pct: 20 },
        // @ts-expect-error runtime KPI meta
        analysis_metric: "nps", target: 30,
      },
    ] as unknown as SurveyResultSummary["questions"],
  };
}

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
  it("전원 추천 → NPS 100", () => {
    expect(npsFromScores([9, 10, 9]).score).toBe(100);
  });
  it("전원 비추천 → NPS -100", () => {
    expect(npsFromScores([3, 5, 6]).score).toBe(-100);
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
  it("before_mean=0이면 improvement_pct null", () => {
    const r = prePostDelta([{ before: 0, after: 3 }]);
    expect(r.improvement_pct).toBeNull();
    expect(r.delta_mean).toBe(3);
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
  it("빈 counts → mean null", () => {
    expect(weightedMean([], { a: 5 }).mean).toBeNull();
  });
  it("counts에 없는 midpoints key → mean null", () => {
    expect(weightedMean([{ value: "x", n: 3 }], { a: 5 }).mean).toBeNull();
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

describe("KPI_REGISTRY", () => {
  it("5종 등록", () => {
    expect(Object.keys(KPI_REGISTRY).sort()).toEqual(
      ["license_support", "nps", "pre_post_overall", "value_ratio", "weekly_hours_saved"].sort(),
    );
  });
});

describe("buildKpiCards", () => {
  it("태깅된 KPI는 값 산출, 미태깅은 unset, ROI는 ctx.user_count 미지정 시 문항 n 사용", () => {
    const cards = buildKpiCards(summaryFixture(), {
      hourly_cost: 30000, annual_license_cost: 6_000_000,
    });
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(cards).toHaveLength(5);
    expect(byId.pre_post_overall.value).toBe(1.8);
    expect(byId.pre_post_overall.display).toContain("+1.8");
    expect(byId.pre_post_overall.traffic).toBe("green");
    // user_count 미지정 → S2Q1 n=30 사용: 4.5(trimmed)*30*48 = 6480
    expect(byId.weekly_hours_saved.value).toBe(6480);
    expect(byId.nps.value).toBe(40);
    expect(byId.value_ratio.unset).toBe(true);     // 미태깅
    expect(byId.license_support.unset).toBe(true); // 미태깅
  });
});
