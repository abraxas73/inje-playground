import { requiresFeature, VERDICT_LABEL, VERDICT_ORDER, type CatalogFeature, type CatalogSolution, type MappingRow, type Verdict } from "./types";

export interface CatalogIndex {
  solutionName: Map<string, string>;
  feature: Map<string, CatalogFeature>;
}

export function indexCatalog(catalog: CatalogSolution[]): CatalogIndex {
  const solutionName = new Map<string, string>();
  const feature = new Map<string, CatalogFeature>();
  for (const s of catalog) {
    solutionName.set(s.code, s.name);
    for (const f of s.features) feature.set(f.id, f);
  }
  return { solutionName, feature };
}

/** requirementId → 행(sortOrder 순). 제네릭이라 RfpMapping[]을 넣으면 RfpMapping[]을 돌려준다. */
export function groupByRequirement<T extends MappingRow>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.requirementId) ?? [];
    list.push(r);
    m.set(r.requirementId, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  return m;
}

/** 한 행의 표시 문자열: "SECloudit·IAM(충족)" / "설계·구축영역" / "해당없음" */
export function describeMapping(row: MappingRow, index: CatalogIndex): string {
  if (!requiresFeature(row.verdict)) return VERDICT_LABEL[row.verdict];
  const solution = (row.solutionCode && index.solutionName.get(row.solutionCode)) ?? row.solutionCode ?? "?";
  const f = row.featureId ? index.feature.get(row.featureId) : undefined;
  const featureName = f ? `${f.name}${f.isActive ? "" : "[비활성]"}` : "(삭제된 기능)";
  return `${solution}·${featureName}(${VERDICT_LABEL[row.verdict]})`;
}

/** 요구사항 하나의 행들을 " / "로 이은 요약(화면 "당사 솔루션" 열·xlsx 공용) */
export function mappingSummary(rows: readonly MappingRow[], index: CatalogIndex): string {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => describeMapping(r, index)).join(" / ");
}

/**
 * 세부 항목이 여러 개인 요구사항의 요약: "후보 26건 — SECloudit, Devopsit".
 * 항목마다 후보가 붙으면 행이 수십 개가 되어 한 줄씩 나열(mappingSummary)하면 읽을 수 없다.
 * 자세한 내용은 화면의 항목별 카드·xlsx 상세 시트에 있으므로 여기서는 판정 건수와 솔루션만 센다.
 */
export function mappingRollup(rows: readonly MappingRow[], index: CatalogIndex): string {
  if (!rows.length) return "";
  const counts = new Map<Verdict, number>();
  for (const r of rows) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
  const verdicts = VERDICT_ORDER.filter((v) => counts.has(v)).map((v) => `${VERDICT_LABEL[v]} ${counts.get(v)}건`).join(" · ");
  const solutions = [...new Set(
    rows.filter((r) => requiresFeature(r.verdict) && r.solutionCode).map((r) => index.solutionName.get(r.solutionCode!) ?? r.solutionCode!),
  )];
  return solutions.length ? `${verdicts} — ${solutions.join(", ")}` : verdicts;
}

/** fulfilled > partial > build > na. 행이 없으면 null. */
export function bestVerdict(rows: readonly MappingRow[]): Verdict | null {
  let best: Verdict | null = null;
  for (const r of rows) if (best === null || VERDICT_ORDER.indexOf(r.verdict) < VERDICT_ORDER.indexOf(best)) best = r.verdict;
  return best;
}

export type VerdictCounts = Record<Verdict | "unmapped", number>;

/** 요구사항 단위 건수. 한 요구사항은 가장 좋은 판정 하나로만 센다. */
export function countByVerdict(requirementIds: readonly string[], rows: readonly MappingRow[]): VerdictCounts {
  const counts: VerdictCounts = { fulfilled: 0, partial: 0, candidate: 0, build: 0, na: 0, unmapped: 0 };
  const groups = groupByRequirement(rows);
  for (const id of requirementIds) {
    const best = bestVerdict(groups.get(id) ?? []);
    counts[best ?? "unmapped"] += 1;
  }
  return counts;
}

export interface SolutionCount {
  code: string;
  name: string;
  fulfilled: number;
  partial: number;
  candidate: number;
}

/** 솔루션별 충족/부분충족/후보 요구사항 수(요구사항 중복 제거: 그 솔루션 행들 중 가장 좋은 판정). 카탈로그 순서. */
export function countBySolution(rows: readonly MappingRow[], catalog: CatalogSolution[]): SolutionCount[] {
  return catalog.map((s) => {
    const perReq = new Map<string, Verdict>();
    for (const r of rows) {
      if (r.solutionCode !== s.code || !requiresFeature(r.verdict)) continue;
      const cur = perReq.get(r.requirementId);
      if (!cur || VERDICT_ORDER.indexOf(r.verdict) < VERDICT_ORDER.indexOf(cur)) perReq.set(r.requirementId, r.verdict);
    }
    let fulfilled = 0;
    let partial = 0;
    let candidate = 0;
    for (const v of perReq.values()) {
      if (v === "fulfilled") fulfilled += 1;
      else if (v === "partial") partial += 1;
      else candidate += 1;
    }
    return { code: s.code, name: s.name, fulfilled, partial, candidate };
  });
}
