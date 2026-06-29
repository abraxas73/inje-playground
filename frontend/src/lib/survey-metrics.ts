import type { NpsStats } from "@/types/survey";

// Phase 1 범위: is_user 단일 정의만 제공한다.
// KPI 레지스트리/순수 산식(npsFromScores 등)은 분석 대시보드 Phase에서 이 파일에 append한다.
// 아래 isUserResponse는 단일 출처이며(중복 정의 금지) value-key 기준으로만 판정한다.

// S0Q3 '사용한 적 없음' = "never", S0Q4 '거의 사용 안 함' = "rarely" (시드 옵션 value 규약)
export function isUserResponse(args: {
  s0q3_value: string | null;
  s0q4_value: string | null;
}): boolean {
  if (args.s0q3_value === "never") return false;
  if (args.s0q4_value === "rarely") return false;
  return true;
}

// =====================================================================
// Phase 3 Task 2: 순수 KPI 산식 (RPC 반환 DTO로부터 표시값 후처리)
// isUserResponse는 위에서 이미 정의됨 — 이 섹션은 append only.
// =====================================================================

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** NPS: raw count 기반 score (pre-rounded % 차이 아님 — ±0.1 drift 방지) */
export function npsFromScores(scores: number[]): NpsStats {
  const n = scores.length;
  if (n === 0) {
    return { n: 0, score: null, promoters_pct: 0, passives_pct: 0, detractors_pct: 0 };
  }
  const prom = scores.filter((s) => s >= 9).length;
  const pass = scores.filter((s) => s >= 7 && s <= 8).length;
  const detr = scores.filter((s) => s <= 6).length;
  const promoters_pct = round1((prom * 100) / n);
  const passives_pct = round1((pass * 100) / n);
  const detractors_pct = round1((detr * 100) / n);
  // score from raw counts, not pre-rounded percentages
  const score = round1(((prom - detr) * 100) / n);
  return { n, score, promoters_pct, passives_pct, detractors_pct };
}

export interface PrePostDelta {
  n_pairwise: number;
  before_mean: number | null;
  after_mean: number | null;
  delta_mean: number | null;
  improvement_pct: number | null;
}
export function prePostDelta(pairs: { before: number; after: number }[]): PrePostDelta {
  const n = pairs.length;
  if (n === 0) {
    return { n_pairwise: 0, before_mean: null, after_mean: null, delta_mean: null, improvement_pct: null };
  }
  const before_mean = pairs.reduce((s, p) => s + p.before, 0) / n;
  const after_mean = pairs.reduce((s, p) => s + p.after, 0) / n;
  const delta_mean = after_mean - before_mean;
  const improvement_pct = before_mean > 0 ? round1((delta_mean / before_mean) * 100) : null;
  return {
    n_pairwise: n,
    before_mean: round1(before_mean),
    after_mean: round1(after_mean),
    delta_mean: round1(delta_mean),
    improvement_pct,
  };
}

export function topBoxRatio(
  counts: { value: string; n: number }[],
  topBox: string[],
  excludeValues: string[] = [],
): { pct: number | null; n_valid: number } {
  const valid = counts.filter((c) => !excludeValues.includes(c.value));
  const n_valid = valid.reduce((s, c) => s + c.n, 0);
  if (n_valid === 0) return { pct: null, n_valid: 0 };
  const top = valid.filter((c) => topBox.includes(c.value)).reduce((s, c) => s + c.n, 0);
  return { pct: round1((top * 100) / n_valid), n_valid };
}

export function weightedMean(
  counts: { value: string; n: number }[],
  midpoints: Record<string, number>,
): { mean: number | null; n: number } {
  let num = 0;
  let n = 0;
  for (const c of counts) {
    const mid = midpoints[c.value];
    if (typeof mid === "number") {
      num += mid * c.n;
      n += c.n;
    }
  }
  if (n === 0) return { mean: null, n: 0 };
  return { mean: round1(num / n), n };
}

export interface RoiInput {
  avg_weekly_hours_saved: number;
  user_count: number;
  hourly_cost: number;
  annual_license_cost: number;
  weeks_per_year?: number;
}
export interface RoiResult {
  annual_hours_saved: number;
  annual_value: number;
  net_annual: number;
  payback_months: number | null;
}
export function computeRoi(input: RoiInput): RoiResult {
  const weeks = input.weeks_per_year ?? 48;
  const annual_hours_saved = input.avg_weekly_hours_saved * input.user_count * weeks;
  const annual_value = annual_hours_saved * input.hourly_cost;
  const net_annual = annual_value - input.annual_license_cost;
  const monthly_value = annual_value / 12;
  const payback_months = monthly_value > 0 ? round1(input.annual_license_cost / monthly_value) : null;
  return { annual_hours_saved, annual_value, net_annual, payback_months };
}

export type TrafficLight = "green" | "amber" | "red" | "unset";
export function trafficLight(value: number | null, target?: number): TrafficLight {
  if (value === null || target === undefined || target <= 0) return "unset";
  const ratio = value / target;
  if (ratio >= 1) return "green";
  if (ratio >= 0.8) return "amber";
  return "red";
}
