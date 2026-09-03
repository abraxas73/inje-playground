/** 요구사항 한 건(추출 결과). DB 행은 RequirementRow. */
export type RequirementSource = { blockIndex: number } | { llm: true };

export interface Requirement {
  /** ID의 숫자 앞부분: SER, INR-DTL … */
  categoryCode: string;
  /** 요구사항 분류 원문: "서비스 요구사항" */
  categoryName: string;
  reqId: string;
  title: string;
  definition: string;
  details: string;
  deliverables: string;
  related: string;
  /** 문서 등장 순서 */
  sortOrder: number;
  source: RequirementSource;
}

export interface RequirementRow extends Requirement {
  id: string;
  /** 당사 솔루션(자유 텍스트, 2단계에서 구조화) */
  solution: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

/** 공공 SW 사업 표준 요구사항 분류 순서(샘플 xlsx의 시트 순서) */
export const STANDARD_CATEGORY_ORDER: readonly string[] = [
  "SER", "ASR", "FUR", "DAR", "SYS", "GOV", "QMR", "DPR", "INF", "INR", "INR-DTL", "PER", "TER", "SEC", "PMR", "PSR", "COR",
];

export const REQ_ID_RE = /^([A-Z]{2,5}(?:-[A-Z]{2,5})*)-(\d{2,4})$/;

export function parseReqId(raw: string): { code: string; num: number } | null {
  const id = raw.replace(/\s+/g, "").toUpperCase();
  const m = REQ_ID_RE.exec(id);
  return m ? { code: m[1], num: Number(m[2]) } : null;
}

/** 표준 순서에 있는 코드를 먼저, 나머지는 처음 등장한 순서로 */
export function orderCategoryCodes(codes: Iterable<string>): string[] {
  const seen = [...new Set(codes)];
  const std = STANDARD_CATEGORY_ORDER.filter((c) => seen.includes(c));
  const rest = seen.filter((c) => !STANDARD_CATEGORY_ORDER.includes(c));
  return [...std, ...rest];
}

/** xlsx 상세 시트 이름: "2.SER", "12.INRDTL" */
export function sheetNameFor(code: string, index: number): string {
  return `${index}.${code.replace(/-/g, "")}`;
}

/** 같은 코드의 최대 번호 + 1(3자리) */
export function nextReqId(code: string, existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const p = parseReqId(id);
    if (p && p.code === code) max = Math.max(max, p.num);
  }
  return `${code}-${String(max + 1).padStart(3, "0")}`;
}

/** 구분명 → 표준 코드(LLM 폴백에서 ID가 없을 때). 앞선 패턴이 우선(데이터 플랫폼 > 데이터, 인프라 상세 > 인프라). */
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/서비스/, "SER"],
  [/AI|인공지능|솔루션/i, "ASR"],
  [/데이터\s*플랫폼/, "DPR"],
  [/데이터/, "DAR"],
  [/인프라\s*상세/, "INR-DTL"],
  [/인프라|장비|하드웨어/, "INR"],
  [/거버넌스|PMO/, "GOV"],
  [/품질/, "QMR"],
  [/인터페이스|UI|UX/, "INF"],
  [/성능/, "PER"],
  [/테스트|시험/, "TER"],
  [/보안/, "SEC"],
  [/프로젝트\s*관리|사업\s*관리/, "PMR"],
  [/프로젝트\s*지원|사업\s*지원/, "PSR"],
  [/제약/, "COR"],
  [/시스템/, "SYS"],
  [/기능/, "FUR"],
];

export function categoryCodeFromName(name: string): string {
  for (const [re, code] of CATEGORY_KEYWORDS) if (re.test(name)) return code;
  return "REQ";
}

/** 화면·xlsx 정렬: 구분 표준 순서 → 문서 등장 순서. Requirement·RequirementRow·RfpRequirement 모두 받는다. */
export function sortRequirements<T extends { categoryCode: string; sortOrder: number }>(rows: T[]): T[] {
  const order = orderCategoryCodes(rows.map((r) => r.categoryCode));
  const rank = new Map(order.map((c, i) => [c, i]));
  return [...rows].sort((a, b) => (rank.get(a.categoryCode)! - rank.get(b.categoryCode)!) || a.sortOrder - b.sortOrder);
}
