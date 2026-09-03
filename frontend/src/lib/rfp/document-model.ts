/**
 * RFP 문서의 공통 모델. hwp·hwpx·docx 파서가 모두 이 형태를 내고, 개요·요구사항 추출은 이 모델만 본다.
 * 표는 셀 배열(위치·병합 정보 포함)로 두고, 셀 안의 중첩 표는 cell.tables에 따로 둔다.
 */
export type DocumentFormat = "hwp" | "hwpx" | "docx";

export interface Paragraph {
  type: "paragraph";
  /** 줄바꿈은 \n 유지 */
  text: string;
}

export interface Cell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** 셀 안 문단들을 \n으로 이은 텍스트 */
  text: string;
  /** 셀 안에 중첩된 표 */
  tables: Table[];
}

export interface Table {
  type: "table";
  rows: number;
  cols: number;
  cells: Cell[];
}

export type Block = Paragraph | Table;

export interface DocumentModel {
  format: DocumentFormat;
  blocks: Block[];
}

/** 지원하지 않는 형식(암호화·배포용 HWP, 확장자 불일치 등). 라우트는 415로 매핑한다. */
export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

/** 라벨 비교용 정규화: NFKC + 모든 공백·줄바꿈 제거 */
export function normalizeLabel(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

/** 값 정리용: 줄바꿈 주변 공백을 한 칸으로, 연속 공백을 한 칸으로 접고 앞뒤를 자른다(overview·extract-standard 공용). */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** (row, col)을 덮는 셀(병합 범위 포함) */
export function cellAt(table: Table, row: number, col: number): Cell | undefined {
  return table.cells.find(
    (c) => row >= c.row && row < c.row + c.rowSpan && col >= c.col && col < c.col + c.colSpan,
  );
}

/** 같은 행에서 셀 바로 오른쪽에 있는 셀 */
export function rightOf(table: Table, cell: Cell): Cell | undefined {
  return cellAt(table, cell.row, cell.col + cell.colSpan);
}

/** 정규화한 텍스트가 라벨 중 하나와 같은 첫 셀 */
export function findLabelCell(table: Table, labels: string[]): Cell | undefined {
  const set = new Set(labels.map(normalizeLabel));
  return table.cells.find((c) => set.has(normalizeLabel(c.text)));
}

/** 셀 텍스트 뒤에 중첩 표를 `[a | b | c]` 줄로 붙인다(샘플 xlsx의 INR-DTL-004 표기와 같다). */
export function flattenCellText(cell: Cell): string {
  const parts: string[] = [cell.text.trim()];
  for (const t of cell.tables) {
    for (let r = 0; r < t.rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < t.cols; c++) {
        const cc = cellAt(t, r, c);
        if (cc && cc.row === r && cc.col === c) row.push(flattenCellText(cc).replace(/\s*\n\s*/g, " "));
      }
      if (row.length) parts.push(`[${row.join(" | ")}]`);
    }
  }
  return parts.filter(Boolean).join("\n");
}

/** rows×cols 텍스트 그리드. 병합 셀은 좌상단에만 텍스트, 나머지는 "". */
export function cellGrid(table: Table): string[][] {
  const g: string[][] = Array.from({ length: table.rows }, () => Array<string>(table.cols).fill(""));
  for (const c of table.cells) {
    if (c.row < table.rows && c.col < table.cols) g[c.row][c.col] = c.text;
  }
  return g;
}

/** LLM 입력용 표 텍스트(마크다운 비슷한 한 줄 = 한 행) */
export function tableText(table: Table): string {
  return cellGrid(table)
    .map((r) => `| ${r.map((x) => x.replace(/\s*\n\s*/g, " ").trim()).join(" | ")} |`)
    .join("\n");
}

export function documentText(doc: DocumentModel): string {
  return doc.blocks
    .map((b) => (b.type === "paragraph" ? b.text : tableText(b)))
    .filter((s) => s.trim().length > 0)
    .join("\n");
}

export function topLevelTables(doc: DocumentModel): Table[] {
  return doc.blocks.filter((b): b is Table => b.type === "table");
}

export function paragraphTexts(doc: DocumentModel): string[] {
  return doc.blocks.filter((b): b is Paragraph => b.type === "paragraph").map((b) => b.text);
}
