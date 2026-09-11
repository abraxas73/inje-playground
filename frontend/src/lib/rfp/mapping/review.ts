/**
 * 확정 작업(리뷰 큐)의 단위와 상태. 순수 함수 — 화면(ReviewQueue)·확정 API·xlsx 대응표/Gap 시트가 같은 정의를 쓴다.
 *
 * 매핑 단위 = 요구사항 × 세부 항목(`groupRowsByDetail`의 그룹 하나). 규칙 엔진은 단위마다 "후보"를 여러 개 깔아 두고,
 * 사람이 그중 하나를 충족/부분충족으로 확정하거나 설계·구축영역/해당없음으로 닫는다.
 * 단위의 상태는 **확정된 행(후보가 아닌 행)** 으로만 정한다 — 후보만 있으면 아직 "검토 대기"다.
 */
import { VERDICT_LABEL, VERDICT_ORDER, type MappingRow, type Verdict } from "./types";
import { groupRowsByDetail, type DetailGroup } from "./detail-groups";
import { parseDetailUnits } from "./detail-items";
import { groupByRequirement } from "./summary";

/** 확정 판정(후보 제외) */
export type ConfirmedVerdict = Exclude<Verdict, "candidate">;
/** 단위 상태: 확정 판정 4가지 + 검토 대기(후보만) + 미매핑(행 없음) */
export type UnitStatus = ConfirmedVerdict | "pending" | "unmapped";

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  fulfilled: VERDICT_LABEL.fulfilled,
  partial: VERDICT_LABEL.partial,
  build: VERDICT_LABEL.build,
  na: VERDICT_LABEL.na,
  pending: "검토 대기",
  unmapped: "미매핑",
};

/** 대응표·Gap 시트의 표시 순서(좋은 것부터, 미결은 뒤) */
export const UNIT_STATUS_ORDER: readonly UnitStatus[] = ["fulfilled", "partial", "build", "na", "pending", "unmapped"];

export function isConfirmed(row: MappingRow): boolean {
  return row.verdict !== "candidate";
}

/** 규칙 엔진 점수(RfpMapping에만 있다). 순수 MappingRow면 0. */
export function scoreOf(row: MappingRow): number {
  const s = (row as { score?: number | null }).score;
  return typeof s === "number" ? s : 0;
}

/** 단위의 상태. 확정 행이 있으면 그중 가장 좋은 판정, 후보만 있으면 pending, 없으면 unmapped. */
export function unitStatus(rows: readonly MappingRow[]): UnitStatus {
  let best: ConfirmedVerdict | null = null;
  let hasCandidate = false;
  for (const r of rows) {
    if (!isConfirmed(r)) {
      hasCandidate = true;
      continue;
    }
    const v = r.verdict as ConfirmedVerdict;
    if (best === null || VERDICT_ORDER.indexOf(v) < VERDICT_ORDER.indexOf(best)) best = v;
  }
  if (best) return best;
  return hasCandidate ? "pending" : "unmapped";
}

/** 확정 작업의 요구사항 최소 정보(화면 타입 RfpRequirement·xlsx RequirementRow 모두 만족) */
export interface ReviewRequirement {
  id: string;
  categoryCode: string;
  categoryName: string;
  reqId: string;
  title: string;
  definition: string;
  details: string;
  sortOrder: number;
}

export interface ReviewUnit<T extends MappingRow = MappingRow, R extends ReviewRequirement = ReviewRequirement> {
  /** `${requirementId}:${detailKey ?? ""}` — 화면 선택·API 응답 매칭용 */
  key: string;
  requirement: R;
  group: DetailGroup<T>;
  status: UnitStatus;
  /** 후보 행(점수 높은 순) */
  candidates: T[];
  /** 확정 행 */
  confirmed: T[];
}

export function unitKey(requirementId: string, detailKey: string | null | undefined): string {
  return `${requirementId}:${detailKey ?? ""}`;
}

/**
 * 프로젝트 전체의 검토 단위(요구사항 순서 → 세부 항목 순서). 매핑 행이 하나도 없는 요구사항도 "미매핑" 단위로 들어간다 —
 * 진행률의 분모는 "결정해야 할 것 전체"여야 하기 때문.
 */
export function buildReviewUnits<T extends MappingRow, R extends ReviewRequirement>(requirements: readonly R[], mappings: readonly T[]): ReviewUnit<T, R>[] {
  const byReq = groupByRequirement(mappings);
  const sorted = [...requirements].sort((a, b) => a.sortOrder - b.sortOrder || a.reqId.localeCompare(b.reqId));
  const out: ReviewUnit<T, R>[] = [];
  for (const q of sorted) {
    const groups = groupRowsByDetail(byReq.get(q.id) ?? [], parseDetailUnits(q.details));
    for (const g of groups) {
      const candidates = g.rows.filter((r) => !isConfirmed(r)).sort((a, b) => scoreOf(b) - scoreOf(a) || a.sortOrder - b.sortOrder);
      const confirmed = g.rows.filter(isConfirmed).sort((a, b) => a.sortOrder - b.sortOrder);
      out.push({ key: unitKey(q.id, g.key), requirement: q, group: g, status: unitStatus(g.rows), candidates, confirmed });
    }
  }
  return out;
}

export interface ReviewProgress {
  total: number;
  /** 확정 판정이 있는 단위 */
  decided: number;
  /** 후보만 있어 결정을 기다리는 단위 */
  pending: number;
  /** 행이 하나도 없는 단위 */
  unmapped: number;
  byStatus: Record<UnitStatus, number>;
}

export function reviewProgress(units: readonly ReviewUnit[]): ReviewProgress {
  const byStatus: Record<UnitStatus, number> = { fulfilled: 0, partial: 0, build: 0, na: 0, pending: 0, unmapped: 0 };
  for (const u of units) byStatus[u.status] += 1;
  const decided = byStatus.fulfilled + byStatus.partial + byStatus.build + byStatus.na;
  return { total: units.length, decided, pending: byStatus.pending, unmapped: byStatus.unmapped, byStatus };
}

/** 규칙 엔진의 정형 접두("자동 매칭 — ")를 떼어 사람이 읽는 사유로 만든다 */
export function cleanRationale(rationale: string): string {
  return rationale.replace(/^자동\s*매칭\s*[—–-]\s*/, "").trim();
}

/**
 * 대응표의 "대응 방안" 한 칸: 확정 행마다 근거 문장(있으면)과 설명을 이어 붙인다.
 * 근거 문장이 판정을 뒷받침하는 원문이라 앞에 두고, 규칙 엔진 설명은 접두를 떼고 뒤에 둔다.
 */
export function responseText(confirmed: readonly MappingRow[]): string {
  return confirmed
    .map((r) => {
      const parts = [r.evidenceText?.trim(), cleanRationale(r.rationale)].filter((s): s is string => !!s);
      return [...new Set(parts)].join(" — ");
    })
    .filter(Boolean)
    .join("\n");
}
