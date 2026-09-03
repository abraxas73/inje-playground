import { cellAt, findLabelCell, flattenCellText, normalizeLabel, rightOf, topLevelTables, type DocumentModel, type Table } from "./document-model";
import { parseReqId, type Requirement } from "./requirements";

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

function clean(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

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

/** 총괄표(첫 셀 "요구사항 구분", "요구사항수" 열)에서 구분 코드별 건수. 없으면 null. */
export function readSummaryCounts(doc: DocumentModel): Map<string, number> | null {
  for (const t of topLevelTables(doc)) {
    const first = cellAt(t, 0, 0);
    if (!first || normalizeLabel(first.text) !== "요구사항구분") continue;
    let countCol = -1;
    let ruleCol = -1;
    for (let c = 0; c < t.cols; c++) {
      const h = normalizeLabel(cellAt(t, 0, c)?.text ?? "");
      if (h.includes("요구사항수") || h === "건수" || h === "수량") countCol = c;
      if (h.includes("부여규칙") || h.includes("ID")) ruleCol = c;
    }
    if (countCol < 0 || ruleCol < 0) continue;
    const map = new Map<string, number>();
    for (let r = 1; r < t.rows; r++) {
      const label = normalizeLabel(cellAt(t, r, 0)?.text ?? "");
      if (/^(합계|총계|계)/.test(label)) continue;
      const countText = (cellAt(t, r, countCol)?.text ?? "").trim();
      if (!countText) continue;
      const count = Number(countText.replace(/[^\d]/g, ""));
      const rule = (cellAt(t, r, ruleCol)?.text ?? "").replace(/\s+/g, "").toUpperCase();
      const m = /^([A-Z]{2,5}(?:-[A-Z]{2,5})*)-0+$/.exec(rule);
      if (!m || !Number.isFinite(count)) continue;
      map.set(m[1], (map.get(m[1]) ?? 0) + count);
    }
    return map.size ? map : null;
  }
  return null;
}

function compareWithSummary(doc: DocumentModel, requirements: Requirement[]): string[] {
  const summary = readSummaryCounts(doc);
  if (!summary) return [];
  const extracted = new Map<string, number>();
  for (const r of requirements) extracted.set(r.categoryCode, (extracted.get(r.categoryCode) ?? 0) + 1);
  const warnings: string[] = [];
  for (const [code, n] of summary) {
    const m = extracted.get(code) ?? 0;
    if (m !== n) warnings.push(`총괄표 ${code} ${n}건, 추출 ${m}건`);
  }
  for (const code of extracted.keys()) if (!summary.has(code)) warnings.push(`총괄표에 없는 구분 ${code} ${extracted.get(code)}건 추출`);
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
    const categoryName = clean(categoryCell ? flattenCellText(categoryCell) : "");

    const rawId = valueOf(b, LABELS.reqId);
    const parsed = parseReqId(rawId);
    if (!parsed) {
      warnings.push(`표 #${blockIndex}: 요구사항 ID 형식이 아니어서 건너뜀 ("${clean(rawId).slice(0, 30)}")`);
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
      title: clean(valueOf(b, LABELS.title)),
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
