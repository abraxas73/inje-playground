/**
 * 요구사항 "세부 내용"을 매핑 단위(세부 항목)로 쪼갠다. 순수 함수 — 서버(엔진·검증)와 화면이 같은 규칙을 쓴다.
 *
 * 규칙(사용자 지시 2026-09-07): 세부 내역이 1단 리스트면 항목마다, 2depth 리스트면 **1단 항목으로 묶어** 매핑한다.
 * - 1단 글머리(○ ● □ ◇ ▶ ①… / "1)" "1." "가.")가 2개 이상이면 그 줄들이 단위이고, 하위 글머리(- • · ※ …)와
 *   글머리 없는 줄은 바로 위 단위에 붙는다.
 * - 1단 글머리가 없고 하위 글머리만 2개 이상이면 그 줄들을 1단 목록으로 본다(-만 쓰는 양식).
 * - 글머리가 아예 없으면 세부 내용 전체가 한 단위(= 예전처럼 요구사항 단위 매핑).
 * 구분은 글머리로 판단하되 원본 들여쓰기를 매핑·화면·엑셀에 보존한다. ※ 주석은 앞 항목에 붙인다.
 */

/**
 * 1단 글머리. 실제 제안요청서에서 쓰이는 문자를 모아 둔 것으로, 같은 리포의 다른 파서
 * (`overview.ts` BULLET, `extract-xlsx.ts` 글머리 제거)와 **같은 집합을 봐야 한다** —
 * 한쪽에만 있으면 그 문서의 세부 항목 매핑이 조용히 요구사항 단위로 퇴화한다.
 * (2026-09-08 리뷰: `◦`(U+25E6)가 빠져 있어 한 프로젝트 124건 중 123건이 단위 분해되지 않았다.)
 */
const L1_MARKER = /^(?:[○◦●◎◯ㅇ□■▣◇◆▶▷►⦿❍]|[①-⑳]|\(?\d{1,2}[).]|[가-하][.)])\s+/;
/** 하위(2단) 글머리. `▫`·`・`는 ■·○ 아래에 쓰이는 작은 기호라 2단으로 본다 */
const L2_MARKER = /^(?:[-–—•·ㆍ‧‣▪▫￭※*・]|[a-zA-Z][).])\s+/;
/** 라벨(화면·보고서 표시용) 최대 길이 */
export const DETAIL_LABEL_MAX = 120;
/** 한 요구사항에서 만들 수 있는 최대 단위 수(폭주 방지) */
export const DETAIL_UNITS_MAX = 30;

export interface DetailUnit {
  /** 1부터의 순번 문자열. DB(detail_key)·화면 그룹 키 */
  key: string;
  /** 한 줄 라벨(글머리 제거, 길면 자름) */
  label: string;
  /** 매칭·근거용 전체 텍스트(1단 항목 + 하위 항목) */
  text: string;
  /** 붙은 하위 줄 수 */
  childCount: number;
}

export interface DetailStructure {
  units: DetailUnit[];
  /** 세분화 전 상위 매핑은 참고용으로 보존한다. */
  retiredKeys?: string[];
  /** 글머리가 없어 한 덩어리로 본 경우 */
  flat: boolean;
  /** 하위 글머리가 있어 1단으로 묶은 경우 */
  nested: boolean;
}

function label(text: string): string {
  const one = text.trimStart().replace(L1_MARKER, "").replace(L2_MARKER, "").replace(/\s+/g, " ").trim();
  return one.length <= DETAIL_LABEL_MAX ? one : `${one.slice(0, DETAIL_LABEL_MAX).trim()}…`;
}

function parseBaseDetailUnits(details: string): DetailStructure {
  const lines = details.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return { units: [], flat: true, nested: false };

  const l1 = lines.filter((l) => L1_MARKER.test(l.trimStart())).length;
  const l2 = lines.filter((l) => !L1_MARKER.test(l.trimStart()) && L2_MARKER.test(l.trimStart())).length;
  const useL1 = l1 >= 2;
  const useL2Only = l1 === 0 && lines.filter((l) => L2_MARKER.test(l.trimStart()) && !l.trimStart().startsWith("※")).length >= 2;
  if (!useL1 && !useL2Only) {
    const text = lines.join("\n");
    return { units: [{ key: "1", label: label(lines[0]), text, childCount: Math.max(0, lines.length - 1) }], flat: true, nested: l1 + l2 > 0 && l1 <= 1 };
  }

  const isHead = (l: string) => (useL1 ? L1_MARKER.test(l.trimStart()) : L2_MARKER.test(l.trimStart()) && !l.trimStart().startsWith("※"));
  const units: DetailUnit[] = [];
  const pending: string[] = [];
  for (const line of lines) {
    if (isHead(line) && units.length < DETAIL_UNITS_MAX) {
      units.push({ key: String(units.length + 1), label: label(line), text: line, childCount: 0 });
      continue;
    }
    if (!units.length) {
      // 목록 앞의 머리말은 첫 단위에 붙인다
      pending.push(line);
      continue;
    }
    const cur = units[units.length - 1];
    cur.text = `${cur.text}\n${line}`;
    cur.childCount += 1;
  }
  if (pending.length && units.length) {
    units[0].text = `${pending.join("\n")}\n${units[0].text}`;
    units[0].childCount += pending.length;
  }
  return { units, flat: false, nested: useL1 && l2 > 0 };
}

/** key → 단위(화면·검증에서 라벨을 되찾을 때) */
export function detailUnitMap(details: string, splits?: DetailSplits): Map<string, DetailUnit> {
  return new Map(parseDetailUnits(details, splits).units.map((u) => [u.key, u]));
}


/** 원문 스냅샷과 일치할 때만 적용한다. 내용 수정 후 다른 항목을 잘못 분할하지 않는다. */
export type DetailSplits = Record<string, string>;
export const EXPANDED_DETAIL_UNITS_MAX = 200;

export function readDetailSplits(source: unknown, details?: string): DetailSplits {
  if (!source || typeof source !== "object" || !("detailSplits" in source)) return {};
  const value = source.detailSplits;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const current = details === undefined ? null : new Map(parseBaseDetailUnits(details).units.map((u) => [u.key, u.text]));
  return Object.fromEntries(Object.entries(value).filter(([key, text]) => /^\d+$/.test(key) && typeof text === "string" && (!current || current.get(key) === text)));
}

/** 상위 항목의 바로 아래 대시만 분리. ※·줄바꿈·더 깊은 대시는 앞 하위 항목에 붙인다. */
export function splitDetailChildren(unit: DetailUnit): DetailUnit[] {
  const lines = unit.text.split("\n");
  const dash = (line: string) => /^\s*[-–—]\s+/.test(line);
  const indents = lines.slice(1).filter(dash).map((line) => line.length - line.trimStart().length);
  if (indents.length < 2) return [];
  const depth = Math.min(...indents);
  const preamble: string[] = [];
  const children: string[][] = [];
  for (const line of lines) {
    if (dash(line) && line.length - line.trimStart().length === depth) children.push([line]);
    else if (children.length) children[children.length - 1].push(line);
    else preamble.push(line);
  }
  if (children.length < 2) return [];
  return children.map((child, i) => ({
    key: `${unit.key}.${i + 1}`,
    label: label(child[0]),
    text: [...preamble, ...child].join("\n"),
    childCount: child.length - 1,
  }));
}

export function parseDetailUnits(details: string, splits: DetailSplits = {}): DetailStructure {
  const base = parseBaseDetailUnits(details);
  const retiredKeys: string[] = [];
  const units = base.units.flatMap((unit) => {
    if (splits[unit.key] !== unit.text) return [unit];
    const children = splitDetailChildren(unit);
    if (!children.length) return [unit];
    retiredKeys.push(unit.key);
    return children;
  });
  return retiredKeys.length ? { units, flat: false, nested: true, retiredKeys: base.flat ? [...retiredKeys, ""] : retiredKeys } : base;
}
