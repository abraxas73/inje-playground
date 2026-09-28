import type { TimeMetric, TimeStatRow } from "@/types/work-metrics";

/** 화면용 소요 시간 행 선택·근사. RPC 행(grp = all | week:… | user:… | scope:…)을 그대로 받는다 */
export const DIST_LABELS = ["≤4h", "≤1일", "≤3일", "≤1주", ">1주"] as const;

export function pickStat(rows: TimeStatRow[], grp: string, kind: "issue" | "mr", metric: TimeMetric): TimeStatRow | undefined {
  return rows.find((r) => r.grp === grp && r.kind === kind && r.metric === metric);
}

/** 여러 그룹(코호트 구성원)의 p50을 건수 가중 평균으로 근사. 정확한 코호트 p50은 후속 */
export function weightedP50(rows: TimeStatRow[]): number | null {
  const n = rows.reduce((a, r) => a + r.n, 0);
  if (!n) return null;
  return rows.reduce((a, r) => a + r.p50 * r.n, 0) / n;
}
