/**
 * 매핑 행을 세부 항목(매핑 단위)으로 묶는다. 순수 함수 — 화면 편집기(MappingEditor)와 xlsx 상세 시트가
 * **같은 함수**를 써야 "웹 화면과 같은 매핑"이 파일에서도 성립한다.
 *
 * 그룹 순서: 요구사항 전체(옛 행·목록이 아닌 요구사항) → 세부 항목 1..N(매핑이 없는 항목도 빈 그룹으로) → 유령 그룹.
 */
import { parseDetailUnits, type DetailStructure } from "./detail-items";
import type { MappingRow } from "./types";

/** 세부 내용이 목록이 아니거나 옛 행(detail_key null)일 때 쓰는 그룹 라벨 */
export const ALL_DETAIL_LABEL = "요구사항 전체";

export interface DetailGroup<T extends MappingRow = MappingRow> {
  /** 세부 항목 키("1","2"…). null = 요구사항 전체 단위 */
  key: string | null;
  /** 한 줄 라벨(세부 항목 첫 줄, 요구사항 전체는 ALL_DETAIL_LABEL) */
  label: string;
  /** 매칭에 쓴 전체 텍스트(1단 항목 + 하위 줄). 요구사항 전체·유령 그룹은 빈 문자열 */
  text: string;
  rows: T[];
  /** 세부 내용을 고친 뒤 지금 구조에 없는 키 — 행을 지우지 않고 따로 보여준다 */
  stale: boolean;
}

/** 세부 항목 그룹. structure는 parseDetailUnits(requirement.details) 결과. */
export function groupRowsByDetail<T extends MappingRow>(rows: readonly T[], structure: DetailStructure): DetailGroup<T>[] {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  // 목록이 아니거나 항목이 하나면 예전처럼 요구사항 한 덩어리(행에 detail_key가 있어도 한 그룹에 모은다)
  if (structure.flat || structure.units.length <= 1) {
    return [{ key: null, label: ALL_DETAIL_LABEL, text: "", rows: sorted, stale: false }];
  }
  const byKey = new Map<string, T[]>();
  for (const r of sorted) {
    const k = r.detailKey ?? "";
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const out: DetailGroup<T>[] = [];
  const wholeRows = byKey.get("") ?? [];
  if (wholeRows.length) out.push({ key: null, label: ALL_DETAIL_LABEL, text: "", rows: wholeRows, stale: false });
  byKey.delete("");
  for (const u of structure.units) {
    out.push({ key: u.key, label: u.label, text: u.text, rows: byKey.get(u.key) ?? [], stale: false });
    byKey.delete(u.key);
  }
  for (const [k, rs] of byKey) out.push({ key: k, label: rs[0]?.detailText || `세부 항목 ${k}`, text: "", rows: rs, stale: true });
  return out;
}

/** 편의 함수 — 요구사항의 세부 내용 문자열로 바로 묶는다 */
export function groupRowsByDetailText<T extends MappingRow>(rows: readonly T[], details: string): DetailGroup<T>[] {
  return groupRowsByDetail(rows, parseDetailUnits(details));
}

/** 그룹이 "세부 항목 단위"인지(요구사항 전체 한 덩어리가 아닌지) — 화면·시트가 항목 열을 보일지 결정 */
export function isDetailScoped(groups: readonly DetailGroup[]): boolean {
  return groups.length > 1 || groups[0]?.key !== null;
}
