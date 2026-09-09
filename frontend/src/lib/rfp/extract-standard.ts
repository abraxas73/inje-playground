import { cellAt, collapseWhitespace, findLabelCell, flattenCellText, normalizeLabel, rightOf, topLevelTables, type DocumentModel, type Table } from "./document-model";
import { parseReqId, type Requirement } from "./requirements";
import { findCategorySummary, matchesRule, patternKey, ruleToPattern, type CategorySummaryRow } from "./category-summary";

export interface ExtractionResult {
  requirements: Requirement[];
  warnings: string[];
  /** standard: hwp·docx 표준 7행 표 규칙 / xlsx: 엑셀 요건표(한 행 = 한 요구사항) / llm: Claude 폴백 */
  method: "standard" | "llm" | "xlsx";
}

/** 라벨 셀 후보(정규화 후 비교) */
const LABELS = {
  reqId: ["요구사항고유번호", "요구사항ID", "고유번호", "요구사항번호", "요구사항식별번호"],
  title: ["요구사항명칭", "요구사항명", "명칭"],
  definition: ["정의"],
  details: ["세부내용", "상세내용", "세부설명"],
  deliverables: ["산출정보", "산출물"],
  related: ["관련요구사항"],
} as const;

/** 요구사항 표 첫 셀(분류 행이 있는 표준 양식) */
const FIRST_CELL = new Set(["요구사항분류", "요구사항구분"]);
/**
 * 분류 행이 없는 변형 표의 첫 셀 — "요구사항 번호"부터 시작하고 구분은 ID 접두어·총괄표로 안다.
 * (실측: 한전 AI 인프라 제안요청서는 번호·명칭·상세(정의/세부 내용) 3행짜리 표를 쓴다)
 */
const REQ_ID_FIRST = new Set(LABELS.reqId.map(normalizeLabel));
/** 총괄표 첫 셀 — 부여규칙 열이 없는 변형은 "구 분"으로만 시작한다 */
const SUMMARY_FIRST_CELL = new Set([...FIRST_CELL, "구분"]);
/** 구분명 안의 코드: "시스템 장비 요구사항(ECR, Equipment Composition Requirement)" → ECR */
const CODE_IN_NAME = /[（(]\s*([A-Z]{2,5})\s*[,，)）]/;

function valueOf(t: Table, labels: readonly string[]): string {
  const label = findLabelCell(t, [...labels]);
  if (!label) return "";
  const v = rightOf(t, label);
  return v ? flattenCellText(v) : "";
}

/**
 * 요구사항 표: 첫 셀이 "요구사항 분류/구분"(표준) 또는 "요구사항 번호"(분류 행이 없는 변형)이고
 * 고유번호·명칭 라벨이 모두 있는 표.
 */
export function isRequirementTable(t: Table): boolean {
  const first = cellAt(t, 0, 0);
  if (!first) return false;
  const label = normalizeLabel(first.text);
  if (!FIRST_CELL.has(label) && !REQ_ID_FIRST.has(label)) return false;
  return !!findLabelCell(t, [...LABELS.reqId]) && !!findLabelCell(t, [...LABELS.title]);
}

export function isStandardFormat(doc: DocumentModel): boolean {
  return topLevelTables(doc).some(isRequirementTable);
}

/**
 * 부여규칙 열이 없는 총괄표("구 분 | 세부 내용 | 수량") 읽기.
 * 구분명 괄호 안의 영문 약어를 구분 코드로 본다 — "성능 요구사항(PER, Performance Requirement)" → PER.
 * 코드가 없는 행은 버리므로 "구분 | 품목 | 수량" 같은 물량표는 0행이 되어 총괄표로 오인되지 않는다.
 */
function readSummaryByCodeInName(t: Table, countCol: number): CategorySummaryRow[] {
  const rows: CategorySummaryRow[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < t.rows; r++) {
    const nameCell = cellAt(t, r, 0);
    if (!nameCell || nameCell.row !== r) continue;
    const name = collapseWhitespace(nameCell.text);
    if (!name || /^(합계|총계|계)/.test(normalizeLabel(name))) continue;
    const code = CODE_IN_NAME.exec(name)?.[1];
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const countText = countCol >= 0 ? (cellAt(t, r, countCol)?.text ?? "").replace(/[^\d]/g, "") : "";
    rows.push({ name, nameEn: null, rule: code, count: countText ? Number(countText) : null });
  }
  return rows;
}

/**
 * 요구사항 총괄표(첫 셀 "요구사항 구분", "ID 부여규칙"·"요구사항수" 열) 행 읽기. 없으면 null.
 * 구분명은 첫 열, 영문명은 둘째 열이 별도 셀이고 영문일 때. 첫 열이 비고 둘째 열에만 이름이 있는 세부 행(예: 인프라 상세)은 둘째 열을 이름으로.
 * 합계 행과 부여규칙이 코드 꼴이 아닌 행은 버린다. 건수 열이 비면 count=null.
 */
export function readSummaryTable(doc: DocumentModel): CategorySummaryRow[] | null {
  for (const t of topLevelTables(doc)) {
    const first = cellAt(t, 0, 0);
    if (!first || !SUMMARY_FIRST_CELL.has(normalizeLabel(first.text))) continue;
    let countCol = -1;
    let ruleCol = -1;
    for (let c = 0; c < t.cols; c++) {
      const h = normalizeLabel(cellAt(t, 0, c)?.text ?? "");
      if (h.includes("요구사항수") || h === "건수" || h === "수량") countCol = c;
      if (h.includes("부여규칙") || h.includes("ID")) ruleCol = c;
    }
    // 부여규칙 열이 없는 변형: 구분명 괄호 안의 코드를 규칙으로 쓴다(코드가 없는 행은 버려 물량표 등을 걸러낸다)
    if (ruleCol < 0) {
      const rows = readSummaryByCodeInName(t, countCol);
      if (rows.length) return rows;
      continue;
    }
    const rows: CategorySummaryRow[] = [];
    for (let r = 1; r < t.rows; r++) {
      const c0 = cellAt(t, r, 0);
      const c1 = ruleCol > 1 ? cellAt(t, r, 1) : undefined;
      const t0 = collapseWhitespace(c0?.text ?? "");
      const t1 = c1 && c1 !== c0 ? collapseWhitespace(c1.text) : "";
      if (/^(합계|총계|계)/.test(normalizeLabel(t0)) || /^(합계|총계|계)/.test(normalizeLabel(t1))) continue;
      const rule = (cellAt(t, r, ruleCol)?.text ?? "").normalize("NFKC").replace(/\s+/g, "").toUpperCase();
      if (!ruleToPattern(rule)) continue;
      const name = t0 || t1;
      if (!name) continue;
      const nameEn = t0 && t1 && t1 !== t0 && /[A-Za-z]/.test(t1) && !/[가-힣]/.test(t1) ? t1 : null;
      const countText = countCol >= 0 ? (cellAt(t, r, countCol)?.text ?? "").replace(/[^\d]/g, "") : "";
      rows.push({ name, nameEn, rule, count: countText ? Number(countText) : null });
    }
    if (rows.length) return rows;
  }
  return null;
}

/** 총괄표에서 규칙 패턴("SER", "ECR-OOO")별 건수. 건수 없는 행은 뺀다. 없으면 null. */
export function readSummaryCounts(doc: DocumentModel): Map<string, number> | null {
  const rows = readSummaryTable(doc);
  if (!rows) return null;
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.count === null) continue;
    const p = ruleToPattern(r.rule);
    if (!p) continue;
    const key = patternKey(p);
    map.set(key, (map.get(key) ?? 0) + r.count);
  }
  return map.size ? map : null;
}

/** 총괄표 건수와 추출 건수 비교. 와일드카드 규칙(ECR-OOO)은 ECR-IFR·ECR-HWA… 를 모두 합쳐 센다. */
function compareWithSummary(doc: DocumentModel, requirements: Requirement[]): string[] {
  const rows = readSummaryTable(doc);
  if (!rows) return [];
  const patterns = rows.map((r) => ({ p: ruleToPattern(r.rule)!, count: r.count })).filter((x) => x.p);
  if (!patterns.length) return [];
  const warnings: string[] = [];
  for (const { p, count } of patterns) {
    if (count === null) continue;
    const m = requirements.filter((r) => matchesRule(p, r.categoryCode)).length;
    if (m !== count) warnings.push(`총괄표 ${patternKey(p)} ${count}건, 추출 ${m}건`);
  }
  const extracted = new Map<string, number>();
  for (const r of requirements) extracted.set(r.categoryCode, (extracted.get(r.categoryCode) ?? 0) + 1);
  for (const [code, n] of extracted) if (!patterns.some(({ p }) => matchesRule(p, code))) warnings.push(`총괄표에 없는 구분 ${code} ${n}건 추출`);
  return warnings;
}

/**
 * 페이지 경계로 갈린 "이어지는 표"를 앞서 만든 같은 ID 요구사항의 세부 내용에 이어 붙인다.
 * PDF는 한 표가 페이지를 넘으면 페이지마다 다른 표가 되고, 한/글은 넘어간 쪽에 번호 행을 다시 찍는다 —
 * 명칭 행이 없으면 온전한 요구사항 표가 아니라 이어지는 조각이다(붙이지 않으면 그 내용이 사라진다).
 */
function appendContinuation(t: Table, requirements: Requirement[], warnings: string[]): void {
  const first = cellAt(t, 0, 0);
  if (!first || !REQ_ID_FIRST.has(normalizeLabel(first.text))) return;
  if (findLabelCell(t, [...LABELS.title])) return;
  const reqId = valueOf(t, LABELS.reqId).replace(/\s+/g, "").toUpperCase();
  const target = requirements.find((r) => r.reqId === reqId);
  if (!target) return;
  const labels = new Set(
    [...LABELS.reqId, ...LABELS.title, ...LABELS.definition, ...LABELS.details, ...LABELS.deliverables, ...LABELS.related].map(normalizeLabel),
  );
  const text = t.cells
    .filter((c) => c.row > 0 && !labels.has(normalizeLabel(c.text)))
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join("\n");
  if (!text) return;
  target.details = `${target.details}\n${text}`.trim();
  warnings.push(`요구사항 ${reqId}: 페이지로 갈린 이어지는 표를 세부 내용에 붙였습니다`);
}

/** 총괄표에서 구분 코드의 국문 구분명(없으면 "") */
function summaryName(rows: CategorySummaryRow[] | null, code: string): string {
  return rows ? collapseWhitespace(findCategorySummary(rows, code)?.name ?? "") : "";
}

/** 표준 양식(7행 표) 규칙 추출. 스펙 §6.2. */
export function extractStandard(doc: DocumentModel): ExtractionResult {
  const requirements: Requirement[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  // 분류 행이 없는 변형 표는 구분명을 총괄표에서 찾는다(없으면 코드를 그대로 쓴다)
  const summaryRows = readSummaryTable(doc);

  doc.blocks.forEach((b, blockIndex) => {
    if (b.type !== "table") return;
    if (!isRequirementTable(b)) {
      appendContinuation(b, requirements, warnings);
      return;
    }
    const first = cellAt(b, 0, 0)!;
    const hasCategoryRow = FIRST_CELL.has(normalizeLabel(first.text));
    const categoryCell = hasCategoryRow ? rightOf(b, first) : undefined;
    const categoryName = collapseWhitespace(categoryCell ? flattenCellText(categoryCell) : "");

    const rawId = valueOf(b, LABELS.reqId);
    const parsed = parseReqId(rawId);
    if (!parsed) {
      warnings.push(`표 #${blockIndex}: 요구사항 ID 형식이 아니어서 건너뜀 ("${collapseWhitespace(rawId).slice(0, 30)}")`);
      return;
    }
    const reqId = rawId.replace(/\s+/g, "").toUpperCase();
    if (seen.has(reqId)) {
      warnings.push(`중복 요구사항 ID ${reqId}: 먼저 나온 표만 사용(표 #${blockIndex} 건너뜀)`);
      return;
    }
    seen.add(reqId);

    requirements.push({
      categoryCode: parsed.code,
      categoryName: categoryName || summaryName(summaryRows, parsed.code) || parsed.code,
      reqId,
      title: collapseWhitespace(valueOf(b, LABELS.title)),
      definition: valueOf(b, LABELS.definition).trim(),
      details: valueOf(b, LABELS.details).trim(),
      deliverables: valueOf(b, LABELS.deliverables).trim(),
      related: valueOf(b, LABELS.related).trim(),
      sortOrder: requirements.length,
      source: { blockIndex },
    });
  });

  warnings.push(...compareWithSummary(doc, requirements));
  return { requirements, warnings, method: "standard" };
}
