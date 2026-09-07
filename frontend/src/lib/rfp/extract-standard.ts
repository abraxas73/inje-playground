import { cellAt, collapseWhitespace, findLabelCell, flattenCellText, normalizeLabel, rightOf, topLevelTables, type DocumentModel, type Table } from "./document-model";
import { parseReqId, type Requirement } from "./requirements";
import { matchesRule, patternKey, ruleToPattern, type CategorySummaryRow } from "./category-summary";

export interface ExtractionResult {
  requirements: Requirement[];
  warnings: string[];
  method: "standard" | "llm";
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

const FIRST_CELL = new Set(["요구사항분류", "요구사항구분"]);

function valueOf(t: Table, labels: readonly string[]): string {
  const label = findLabelCell(t, [...labels]);
  if (!label) return "";
  const v = rightOf(t, label);
  return v ? flattenCellText(v) : "";
}

/** 첫 셀이 "요구사항 분류/구분"이고 고유번호·명칭 라벨이 있는 표 */
export function isRequirementTable(t: Table): boolean {
  const first = cellAt(t, 0, 0);
  if (!first || !FIRST_CELL.has(normalizeLabel(first.text))) return false;
  return !!findLabelCell(t, [...LABELS.reqId]) && !!findLabelCell(t, [...LABELS.title]);
}

export function isStandardFormat(doc: DocumentModel): boolean {
  return topLevelTables(doc).some(isRequirementTable);
}

/**
 * 요구사항 총괄표(첫 셀 "요구사항 구분", "ID 부여규칙"·"요구사항수" 열) 행 읽기. 없으면 null.
 * 구분명은 첫 열, 영문명은 둘째 열이 별도 셀이고 영문일 때. 첫 열이 비고 둘째 열에만 이름이 있는 세부 행(예: 인프라 상세)은 둘째 열을 이름으로.
 * 합계 행과 부여규칙이 코드 꼴이 아닌 행은 버린다. 건수 열이 비면 count=null.
 */
export function readSummaryTable(doc: DocumentModel): CategorySummaryRow[] | null {
  for (const t of topLevelTables(doc)) {
    const first = cellAt(t, 0, 0);
    if (!first || !FIRST_CELL.has(normalizeLabel(first.text))) continue;
    let countCol = -1;
    let ruleCol = -1;
    for (let c = 0; c < t.cols; c++) {
      const h = normalizeLabel(cellAt(t, 0, c)?.text ?? "");
      if (h.includes("요구사항수") || h === "건수" || h === "수량") countCol = c;
      if (h.includes("부여규칙") || h.includes("ID")) ruleCol = c;
    }
    if (ruleCol < 0) continue;
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

/** 표준 양식(7행 표) 규칙 추출. 스펙 §6.2. */
export function extractStandard(doc: DocumentModel): ExtractionResult {
  const requirements: Requirement[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  doc.blocks.forEach((b, blockIndex) => {
    if (b.type !== "table" || !isRequirementTable(b)) return;
    const first = cellAt(b, 0, 0)!;
    const categoryCell = rightOf(b, first);
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
      categoryName: categoryName || parsed.code,
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
