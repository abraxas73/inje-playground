import { dedupeIncoming, type IncomingFeature } from "./merge-features";

/**
 * Confluence 본문 규칙 파서(4단계 스펙 §4.2). 입력은 storageToText 결과 텍스트:
 * 표 행 "| a | b |", 제목 "## 이름"(수준만큼 #), 글머리 "- 항목". 기능 후보를 문서 순서로 모아 dedupeIncoming으로 합친다.
 */

/** 표·글머리 이름이 이보다 길면 문장으로 본다 */
export const RULES_NAME_MAX = 60;
/** 제목을 기능으로 받는 최대 길이 */
export const HEADING_NAME_MAX = 40;
/** 제목 아래 설명 최대 길이 */
export const HEADING_DESC_MAX = 300;

const CODE_ONLY_RE = /^[A-Za-z]{0,4}[-_.]?\d{1,4}([-_.]\d{1,4})*$/;
/** 숫자를 포함한 대문자 코드(SEC_AUTH_01). IAM·SSO처럼 숫자 없는 약어는 기능 이름으로 남긴다 */
const UPPER_CODE_RE = /^[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*$/;
const NAME_HEADER_EXACT = new Set(["기능명", "기능명칭", "기능", "메뉴명", "메뉴", "국문명", "이름", "명칭", "feature", "featurename", "name"]);
const NAME_HEADER_LOOSE_RE = /기능|메뉴|feature|name/i;
const DESC_HEADER_RE = /설명|내용|상세|description|detail/i;
const INDEX_HEADER_RE = /^(no\.?|번호|순번|연번|#)$/i;
const TABLE_LINE_RE = /^\|.*\|$/;
const HEADING_RE = /^(#{2,4}) (.+)$/;
const ANY_HEADING_RE = /^#{1,6} /;
const HEADING_NUMBER_RE = /^\d+(\.\d+)*[.)]?\s+/;
const SKIP_HEADING_RE = /^(개요|목차|목적|배경|범위|참고|참고\s*자료|이력|변경\s*이력|문서\s*정보|담당자|일정|회의|참석자|안건|결론|기타|비고|요약|서론|history|overview|agenda|reference|summary|toc)/i;
const BULLET_RE = /^- (.+)$/;
const BULLET_SPLIT_RE = /^(.{2,40}?)\s*(?::|：|—|–| - )\s+(.+)$/;
const DATE_RE = /\d{4}[.\-/]\d{1,2}/;
const URL_RE = /https?:\/\//i;
const BULLET_SKIP_NAME_RE = /담당|일정|참석|회의|작성|검토자?|승인/;

export function isCodeOnly(s: string): boolean {
  const t = s.trim();
  return CODE_ONLY_RE.test(t) || UPPER_CODE_RE.test(t);
}

export interface RulesExtractResult {
  features: IncomingFeature[];
  warnings: string[];
  stats: { tables: number; headings: number; bullets: number };
}

/** storageToText는 연속 공백을 하나로 줄이므로 빈 셀은 "| |"로 온다 — 파이프 자체로 자른다(셀 안 "|"는 스펙 §4.2대로 미지원). */
function splitCells(line: string): string[] {
  return line.slice(1, -1).split("|").map((c) => c.trim());
}

function pickNameColumn(header: string[]): number {
  const compact = header.map((h) => h.replace(/\s+/g, "").toLowerCase());
  const exact = compact.findIndex((h) => NAME_HEADER_EXACT.has(h));
  if (exact >= 0) return exact;
  const loose = header.findIndex((h) => NAME_HEADER_LOOSE_RE.test(h) && !DESC_HEADER_RE.test(h));
  if (loose >= 0) return loose;
  return header.length > 1 && INDEX_HEADER_RE.test(header[0]) ? 1 : 0;
}

/** 첫 행을 헤더로 보고 이름 열을 고른다. 이름 셀이 비었거나 코드만이거나 60자 초과이거나 헤더 반복이면 건너뛴다. */
function parseTable(rows: string[][]): IncomingFeature[] {
  if (rows.length < 2) return [];
  const header = rows[0];
  const nameCol = pickNameColumn(header);
  const headerName = header[nameCol] ?? "";
  const out: IncomingFeature[] = [];
  for (const cells of rows.slice(1)) {
    const name = (cells[nameCol] ?? "").trim();
    if (!name || name === headerName || name.length > RULES_NAME_MAX || isCodeOnly(name)) continue;
    const description = cells.filter((c, i) => i !== nameCol && c && !isCodeOnly(c)).join(" · ");
    out.push({ name, description });
  }
  return out;
}

export function extractFeaturesByRules(text: string): RulesExtractResult {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const found: IncomingFeature[] = [];
  const stats = { tables: 0, headings: 0, bullets: 0 };
  let heading: { name: string; desc: string[] } | null = null;
  const flushHeading = () => {
    if (!heading) return;
    found.push({ name: heading.name, description: heading.desc.join(" ").slice(0, HEADING_DESC_MAX) });
    stats.headings += 1;
    heading = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (TABLE_LINE_RE.test(line)) {
      flushHeading();
      const rows: string[][] = [];
      while (i < lines.length && TABLE_LINE_RE.test(lines[i])) {
        rows.push(splitCells(lines[i]));
        i += 1;
      }
      stats.tables += 1;
      found.push(...parseTable(rows));
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      flushHeading();
      const name = h[2].replace(HEADING_NUMBER_RE, "").trim();
      if (name && name.length <= HEADING_NAME_MAX && !SKIP_HEADING_RE.test(name)) heading = { name, desc: [] };
      i += 1;
      continue;
    }
    if (ANY_HEADING_RE.test(line)) {
      // h1·h5·h6: 기능으로 받지 않고 설명 수집만 끊는다
      flushHeading();
      i += 1;
      continue;
    }
    const b = BULLET_RE.exec(line);
    if (b) {
      const body = b[1].trim();
      if (heading) heading.desc.push(body);
      const m = BULLET_SPLIT_RE.exec(body);
      if (m) {
        const name = m[1].trim();
        const description = m[2].trim();
        if (!DATE_RE.test(body) && !URL_RE.test(body) && !BULLET_SKIP_NAME_RE.test(name) && !isCodeOnly(name)) {
          found.push({ name, description });
          stats.bullets += 1;
        }
      }
      i += 1;
      continue;
    }
    if (heading) heading.desc.push(line);
    i += 1;
  }
  flushHeading();

  const features = dedupeIncoming(found);
  const warnings = features.length ? [] : ["문서에서 기능을 찾지 못했습니다."];
  return { features, warnings, stats };
}

/** 소스 행 note에 남기는 요약 */
export function rulesNote(r: RulesExtractResult): string {
  return `규칙 추출: 표 ${r.stats.tables}·제목 ${r.stats.headings}·글머리 ${r.stats.bullets} → 기능 ${r.features.length}개`;
}
