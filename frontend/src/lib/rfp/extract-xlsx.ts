/**
 * 엑셀 요건표 추출. 견적요청서·기술검토표처럼 **한 행 = 한 요구사항**인 표를 읽는다(hwp 표준 양식의 7행 표와 다른 모양).
 * 시트마다 앞쪽 행에서 헤더를 찾고(항목/요구사항 열 필수), 그 아래 행을 요구사항으로 만든다.
 * "구분" 열이 세로 병합돼 있어도 document-model의 cellAt이 병합 범위를 돌려주므로 값이 자동으로 아래로 채워진다.
 */
import { cellAt, collapseWhitespace, normalizeLabel, type Block, type DocumentModel, type Table } from "./document-model";
import { categoryCodeFromName, parseReqId, type Requirement } from "./requirements";
import type { ExtractionResult } from "./extract-standard";

/** 헤더를 찾는 최대 행 수(설명·머리글이 위에 붙는 양식이 흔하다) */
export const XLSX_HEADER_SCAN_ROWS = 12;
/** 표로 인정하는 최소 데이터 행 */
export const XLSX_MIN_DATA_ROWS = 2;
/** 항목 텍스트에서 만드는 요구사항 명칭 최대 길이 */
export const XLSX_TITLE_MAX = 60;

type Field = "item" | "category" | "no" | "reqId" | "title" | "definition" | "details" | "deliverables" | "related" | "answer" | "note";

/** 헤더 문구(공백 제거) → 필드. 위에서부터 먼저 맞는 것을 쓴다(요구사항명칭 > 항목, 세부내용 > 내용). */
const HEADERS: [RegExp, Field][] = [
  [/^요구사항(고유)?(번호|id)$|^고유번호$|^식별번호$|^요구사항번호$/i, "reqId"],
  [/요구사항명칭|요구사항명$|^항목명$|^명칭$|^title$/i, "title"],
  [/^정의$|^definition$/i, "definition"],
  [/세부내용|상세내용|세부설명|요구사항상세/, "details"],
  [/산출정보|산출물/, "deliverables"],
  [/관련요구사항/, "related"],
  [/^답변|응답|검토결과|가능여부|지원여부/, "answer"],
  [/^비고$|^참고$|^remark$/i, "note"],
  [/^no\.?$|^번호$|^순번$|^연번$|^#$/i, "no"],
  [/^구분$|^분류$|^영역$|^카테고리$|^category$/i, "category"],
  [/검토항목|요구사항|요건|^항목$|^내용$|^기능$/, "item"],
];

export interface HeaderMatch {
  row: number;
  cols: Partial<Record<Field, number>>;
}

/**
 * 표에서 헤더 행과 열 위치를 찾는다. 항목(또는 명칭) 열이 없으면 null.
 * 후보가 여러 개면 인식한 열이 가장 많은 행을 쓴다 — "■ 기술검토 항목"처럼 표 위에 붙는 구역 제목이
 * 항목 열로 오인되는 것을 막는다(그 제목은 여러 열에 걸쳐 병합돼 있어 아래 colSpan 검사에서도 걸러진다).
 */
export function findHeader(t: Table): HeaderMatch | null {
  const scanTo = Math.min(t.rows, XLSX_HEADER_SCAN_ROWS);
  let best: (HeaderMatch & { score: number }) | null = null;
  for (let r = 0; r < scanTo; r++) {
    const cols: Partial<Record<Field, number>> = {};
    for (let c = 0; c < t.cols; c++) {
      const cell = cellAt(t, r, c);
      // 대표 위치(병합 시작 칸)이고, 여러 열에 걸치지 않은 셀만 헤더 후보
      if (!cell || cell.row !== r || cell.col !== c || cell.colSpan > 1) continue;
      const label = normalizeLabel(cell.text);
      if (!label || label.length > 24) continue;
      const hit = HEADERS.find(([re]) => re.test(label));
      if (hit && cols[hit[1]] === undefined) cols[hit[1]] = c;
    }
    if (cols.item === undefined && cols.title === undefined) continue;
    // 헤더 아래에 데이터가 실제로 있어야 한다
    const textCol = cols.item ?? cols.title!;
    let dataRows = 0;
    for (let dr = r + 1; dr < t.rows && dataRows < XLSX_MIN_DATA_ROWS; dr++) {
      if (cellAt(t, dr, textCol)?.text.trim()) dataRows++;
    }
    if (dataRows < XLSX_MIN_DATA_ROWS) continue;
    const score = Object.keys(cols).length;
    if (!best || score > best.score) best = { row: r, cols, score };
  }
  return best ? { row: best.row, cols: best.cols } : null;
}

const KOREAN_INITIALS = "GNNDRMBSSOJCKTPH";
/** 한글 첫 자음 로마자(간단 표기) — 코드 만들기 전용 */
function initialsOf(name: string): string {
  const out: string[] = [];
  for (const ch of name) {
    const code = ch.codePointAt(0)!;
    if (code < 0xac00 || code > 0xd7a3) continue;
    const idx = Math.floor((code - 0xac00) / 588);
    // 초성 19개를 16자 표(쌍자음은 같은 글자)로 접는다
    const table = ["G", "G", "N", "D", "D", "R", "M", "B", "B", "S", "S", "O", "J", "J", "C", "K", "T", "P", "H"];
    out.push(table[idx] ?? KOREAN_INITIALS[0]);
    if (out.length >= 3) break;
  }
  return out.join("");
}

/** 엑셀 구분명에 흔한 낱말 → 코드(표준 분류 키워드보다 먼저 본다) */
const XLSX_CATEGORY_CODES: [RegExp, string][] = [
  [/공통/, "COM"],
  [/일반/, "GEN"],
  [/기술/, "TEC"],
  [/관리/, "MGT"],
  [/운영/, "OPS"],
  [/물량|수량|규격/, "QTY"],
  [/가격|견적|비용/, "PRC"],
];

/**
 * 구분명 → 요구사항 ID 코드. 라틴 문자가 있으면 그것을 쓰고(IaaS → IAAS, GPU → GPU),
 * 없으면 엑셀 관용어·표준 분류 키워드 → 한글 초성 순으로 만든다. taken에 있으면 뒤에 A·B…를 붙인다.
 */
export function xlsxCategoryCode(name: string, taken: Set<string> = new Set()): string {
  const latin = (name.match(/[A-Za-z]+/g) ?? []).join("").toUpperCase().slice(0, 5);
  let base = latin.length >= 2 ? latin : "";
  if (!base) base = XLSX_CATEGORY_CODES.find(([re]) => re.test(name))?.[1] ?? "";
  if (!base) {
    const std = categoryCodeFromName(name);
    if (std !== "REQ") base = std;
  }
  if (!base) {
    const ini = initialsOf(name);
    base = ini.length >= 2 ? ini : "REQ";
  }
  if (!taken.has(base)) return base;
  for (const suffix of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const c = `${base}${suffix}`.slice(0, 5);
    if (!taken.has(c)) return c;
  }
  return base;
}

/** 항목 원문 → 한 줄 명칭. 글머리표·번호를 떼고 길면 자른다. */
export function titleFromItem(item: string): string {
  const one = collapseWhitespace(item)
    .replace(/^[\s○●◦□■▪▫※*・·\-–—]+/, "")
    .replace(/^\(?\d+[).]\s*/, "")
    .trim();
  if (one.length <= XLSX_TITLE_MAX) return one;
  const cut = one.slice(0, XLSX_TITLE_MAX);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > XLSX_TITLE_MAX * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}

/** 답변·비고 열을 산출정보 칸에 모아 둔다(매핑 입력에는 쓰이지 않는 칸이라 우리 답변이 매칭을 흐리지 않는다) */
function deliverablesText(answer: string, note: string, given: string): string {
  if (given.trim()) return given.trim();
  return [answer.trim() ? `답변: ${answer.trim()}` : "", note.trim() ? `비고: ${note.trim()}` : ""].filter(Boolean).join("\n");
}

/** 표 앞의 `# 시트명` 문단(parse-xlsx가 넣는다) */
function sheetNameBefore(blocks: readonly Block[], index: number): string {
  for (let i = index - 1; i >= 0 && i >= index - 2; i--) {
    const b = blocks[i];
    if (b.type === "paragraph" && b.text.startsWith("# ")) return b.text.slice(2).trim();
  }
  return "";
}

/** 요건표가 하나라도 있는 엑셀인지 */
export function isXlsxRequirementFormat(doc: DocumentModel): boolean {
  return doc.blocks.some((b) => b.type === "table" && findHeader(b) !== null);
}

/** 엑셀 요건표 추출. 시트를 순서대로 훑어 한 행씩 요구사항으로 만든다. */
export function extractXlsx(doc: DocumentModel): ExtractionResult {
  const requirements: Requirement[] = [];
  const warnings: string[] = [];
  const takenCodes = new Set<string>();
  const skipped: string[] = [];
  const codeOfName = new Map<string, string>();
  const usedIds = new Set<string>();
  const perCode = new Map<string, number>();
  let tables = 0;

  doc.blocks.forEach((block, blockIndex) => {
    if (block.type !== "table") return;
    const header = findHeader(block);
    const sheet = sheetNameBefore(doc.blocks, blockIndex);
    if (!header) {
      skipped.push(sheet || `${blockIndex + 1}번째 표`);
      return;
    }
    tables += 1;
    const { cols } = header;
    const textCol = cols.item ?? cols.title!;
    const at = (row: number, col: number | undefined): string => (col === undefined ? "" : cellAt(block, row, col)?.text ?? "");

    let rowsInTable = 0;
    for (let r = header.row + 1; r < block.rows; r++) {
      const item = at(r, textCol).trim();
      if (!item) continue;
      // 표 아래 합계·안내 행 걸러내기
      if (/^(합계|총계|계|소계)/.test(normalizeLabel(item))) continue;

      const categoryName = collapseWhitespace(at(r, cols.category)) || sheet || "요구사항";
      let code = codeOfName.get(categoryName);
      if (!code) {
        code = xlsxCategoryCode(categoryName, takenCodes);
        takenCodes.add(code);
        codeOfName.set(categoryName, code);
      }

      const parsed = parseReqId(at(r, cols.reqId));
      const noRaw = at(r, cols.no).replace(/[^\d]/g, "");
      const seq = parsed ? parsed.num : noRaw ? Number(noRaw) : (perCode.get(code) ?? 0) + 1;
      const idCode = parsed ? parsed.code : code;
      let reqId = `${idCode}-${String(seq).padStart(3, "0")}`;
      if (usedIds.has(reqId)) {
        let n = (perCode.get(idCode) ?? seq) + 1;
        while (usedIds.has(`${idCode}-${String(n).padStart(3, "0")}`)) n += 1;
        warnings.push(`${sheet || "시트"} ${r + 1}행: ID ${reqId}가 중복이라 ${idCode}-${String(n).padStart(3, "0")}으로 바꿨습니다.`);
        reqId = `${idCode}-${String(n).padStart(3, "0")}`;
      }
      usedIds.add(reqId);
      perCode.set(idCode, Math.max(perCode.get(idCode) ?? 0, parseReqId(reqId)?.num ?? seq));

      const titleCell = collapseWhitespace(at(r, cols.title));
      const detailsCell = at(r, cols.details).trim();
      const title = titleCell || titleFromItem(item);
      const details = cols.details !== undefined && detailsCell ? detailsCell : cols.item !== undefined ? item : "";

      requirements.push({
        categoryCode: idCode,
        categoryName,
        reqId,
        title,
        definition: collapseWhitespace(at(r, cols.definition)),
        details,
        deliverables: deliverablesText(at(r, cols.answer), at(r, cols.note), at(r, cols.deliverables)),
        related: collapseWhitespace(at(r, cols.related)),
        sortOrder: requirements.length,
        source: { blockIndex },
      });
      rowsInTable += 1;
    }
    if (!rowsInTable) warnings.push(`${sheet || "시트"}: 헤더는 찾았지만 요구사항 행이 없습니다.`);
  });

  if (skipped.length) warnings.push(`요건표가 아니라 건너뛴 시트: ${skipped.join(", ")}`);
  if (!tables) warnings.push("엑셀에서 요건표(항목·요구사항 열이 있는 표)를 찾지 못했습니다.");
  if (!requirements.length && tables) warnings.push("요건표에서 읽을 요구사항이 없습니다.");
  return { requirements, warnings, method: "xlsx" };
}
