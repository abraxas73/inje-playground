import type { NpsStats, QuestionAggregate, SurveyResultSummary } from "@/types/survey";

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

// =====================================================================
// Phase 3 Task 3: KPI 레지스트리 5종 + buildKpiCards
// KPI 결선: config.analysis_metric 태그 기준 (문항 ID 하드코딩 금지)
// 미태깅 → unset: true, display: "미설정"
// population_label: S0 → "전체", 그 외 → "사용자"
// =====================================================================

export type KpiId =
  | "pre_post_overall"
  | "weekly_hours_saved"
  | "value_ratio"
  | "nps"
  | "license_support";

export interface KpiContext {
  hourly_cost?: number;
  user_count?: number;
  annual_license_cost?: number;
}

const KPI_DEFAULTS = { hourly_cost: 30000, annual_license_cost: 0, weeks_per_year: 48 };

export interface KpiCardData {
  id: KpiId;
  label: string;
  value: number | null;
  display: string;
  secondary?: string;
  population_label: string;
  traffic: TrafficLight;
  note?: string;
  unset: boolean;
}

export interface KpiDefinition {
  id: KpiId;
  label: string;
  unit: "delta" | "hours" | "percent" | "score" | "ratio";
  population: "all" | "users" | "heavy_users";
  compute: (summary: SurveyResultSummary, ctx: KpiContext) => KpiCardData;
}

// RPC 부가 메타를 읽기 위한 내부 보강 타입 (동결 컴포넌트 타입 불변)
type KpiSourceAggregate = QuestionAggregate & {
  analysis_metric?: string | null;
  target?: number | null;
  top_box?: string[];
  option_midpoints?: Record<string, number>;
};

const POP_LABEL: Record<KpiDefinition["population"], string> = {
  all: "전체",
  users: "사용자",
  heavy_users: "헤비유저",
};

// analysis_metric 태그로 문항 탐색 (문항 ID 하드코딩 금지)
function findByMetricKey(summary: SurveyResultSummary, key: string): KpiSourceAggregate | undefined {
  return (summary.questions as KpiSourceAggregate[]).find((q) => q.analysis_metric === key);
}

function findByMetric(summary: SurveyResultSummary, id: KpiId): KpiSourceAggregate | undefined {
  return findByMetricKey(summary, id);
}

function unsetCard(def: KpiDefinition): KpiCardData {
  return {
    id: def.id,
    label: def.label,
    value: null,
    display: "미설정",
    population_label: POP_LABEL[def.population],
    traffic: "unset",
    unset: true,
  };
}

export const KPI_REGISTRY: Record<KpiId, KpiDefinition> = {
  pre_post_overall: {
    id: "pre_post_overall",
    label: "도입 전후 개선 Δ",
    unit: "delta",
    population: "users",
    compute: (summary, _ctx) => {
      const a = findByMetric(summary, "pre_post_overall");
      if (!a || a.masked || a.type !== "pre_post_scale") return unsetCard(KPI_REGISTRY.pre_post_overall);
      const d = a.stats.delta_mean;
      const imp = a.stats.improvement_pct;
      return {
        id: "pre_post_overall",
        label: "도입 전후 개선 Δ",
        value: d,
        display: d === null ? "—" : `${d >= 0 ? "+" : ""}${d}${imp !== null ? ` (${imp}%↑)` : ""}`,
        secondary: `pairwise n=${a.stats.n_pairwise}`,
        population_label: POP_LABEL.users,
        traffic: trafficLight(d, (a as KpiSourceAggregate).target ?? undefined),
        note: "자기보고 회고형 — 상향편향 가능",
        unset: false,
      };
    },
  },

  weekly_hours_saved: {
    id: "weekly_hours_saved",
    label: "가중 연간 절감시간 / ROI",
    unit: "hours",
    population: "users",
    compute: (summary, ctx) => {
      const a = findByMetric(summary, "weekly_hours_saved");
      if (!a || a.masked || a.type !== "number") return unsetCard(KPI_REGISTRY.weekly_hours_saved);
      const weekly = a.stats.mean_trimmed ?? a.stats.mean ?? 0;
      // user_count 미지정 시 해당 문항 응답 n(스킵로직상 실사용자 모수)
      const users = ctx.user_count ?? a.stats.n;
      const roi = computeRoi({
        avg_weekly_hours_saved: weekly,
        user_count: users,
        hourly_cost: ctx.hourly_cost ?? KPI_DEFAULTS.hourly_cost,
        annual_license_cost: ctx.annual_license_cost ?? KPI_DEFAULTS.annual_license_cost,
        weeks_per_year: KPI_DEFAULTS.weeks_per_year,
      });
      return {
        id: "weekly_hours_saved",
        label: "가중 연간 절감시간 / ROI",
        value: roi.annual_hours_saved,
        display: `${roi.annual_hours_saved.toLocaleString("ko-KR")}h/년`,
        secondary: `순효익 ₩${roi.net_annual.toLocaleString("ko-KR")}${roi.payback_months !== null ? ` · 회수 ${roi.payback_months}개월` : ""} · 모수 n=${users}`,
        population_label: POP_LABEL.users,
        traffic: "unset",
        note: "S2Q2·S1Q1과 합산 금지(교차검증 전용)",
        unset: false,
      };
    },
  },

  value_ratio: {
    id: "value_ratio",
    label: "비용 이상 가치 비율",
    unit: "percent",
    population: "users",
    compute: (summary, _ctx) => {
      const a = findByMetric(summary, "value_ratio");
      if (!a || a.masked || a.type !== "single_choice") return unsetCard(KPI_REGISTRY.value_ratio);
      const tb = topBoxRatio(
        a.options.map((o) => ({ value: o.value, n: o.n })),
        (a as KpiSourceAggregate).top_box ?? [],
      );
      return {
        id: "value_ratio",
        label: "비용 이상 가치 비율",
        value: tb.pct,
        display: tb.pct === null ? "—" : `${tb.pct}%`,
        secondary: `유효 n=${tb.n_valid}`,
        population_label: POP_LABEL.users,
        traffic: trafficLight(tb.pct, (a as KpiSourceAggregate).target ?? undefined),
        note: "'비용 모름' 응답은 별도 검토 필요",
        unset: false,
      };
    },
  },

  nps: {
    id: "nps",
    label: "사용자 NPS",
    unit: "score",
    population: "users",
    compute: (summary, _ctx) => {
      const a = findByMetric(summary, "nps");
      if (!a || a.masked || a.type !== "nps") return unsetCard(KPI_REGISTRY.nps);
      return {
        id: "nps",
        label: "사용자 NPS",
        value: a.stats.score,
        display: a.stats.score === null ? "—" : `${a.stats.score}`,
        secondary: `추천 ${a.stats.promoters_pct}% / 비추천 ${a.stats.detractors_pct}%`,
        population_label: POP_LABEL.users,
        traffic: trafficLight(a.stats.score, (a as KpiSourceAggregate).target ?? undefined),
        unset: false,
      };
    },
  },

  license_support: {
    id: "license_support",
    label: "유지 지지도",
    unit: "percent",
    population: "users",
    compute: (summary, _ctx) => {
      const a = findByMetric(summary, "license_support");
      if (!a || a.masked || a.type !== "scale") return unsetCard(KPI_REGISTRY.license_support);
      const pct = a.stats.top_box_pct ?? null;
      // KPI⑤ 보조: S4Q3 중단영향('상당+매우'%) 결선
      const impact = findByMetricKey(summary, "s4q3_discontinue_impact");
      let impactStr = "";
      if (impact && !impact.masked && impact.type === "single_choice") {
        const tb = topBoxRatio(
          impact.options.map((o) => ({ value: o.value, n: o.n })),
          (impact as KpiSourceAggregate).top_box ?? [],
        );
        if (tb.pct !== null) impactStr = ` · 중단영향(상당+매우) ${tb.pct}%`;
      }
      return {
        id: "license_support",
        label: "유지 지지도",
        value: pct,
        display: pct === null ? `평균 ${a.stats.mean}` : `${pct}%`,
        secondary: `top-2-box · 평균 ${a.stats.mean}${impactStr}`,
        population_label: POP_LABEL.users,
        traffic: trafficLight(pct, (a as KpiSourceAggregate).target ?? undefined),
        note: "관리자·예산권자 별도 표기로 호의편향 점검",
        unset: false,
      };
    },
  },
};

export function buildKpiCards(summary: SurveyResultSummary, ctx: KpiContext = {}): KpiCardData[] {
  return (Object.keys(KPI_REGISTRY) as KpiId[]).map((id) => KPI_REGISTRY[id].compute(summary, ctx));
}
