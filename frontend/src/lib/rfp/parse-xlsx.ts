/**
 * xlsx(엑셀) → 공통 DocumentModel. 시트마다 제목 문단(`# 시트명`) + 표 하나를 만든다.
 * 병합 셀은 rowSpan·colSpan으로 옮겨 담아 document-model의 cellAt이 병합 범위를 그대로 읽게 한다
 * (엑셀 요건표는 "구분" 열을 세로 병합해 쓰므로 이 처리가 없으면 구분이 첫 행에만 붙는다).
 * exceljs 읽기는 비동기라 parseDocumentAsync에서만 호출한다.
 */
import ExcelJS from "exceljs";
import type { Block, Cell, DocumentModel, Table } from "./document-model";
import { xlsxCellText } from "./xlsx-cell";

/** 시트 하나에서 읽는 최대 행·열(폭주 방지). 요건표는 이 범위를 넘지 않는다. */
export const XLSX_MAX_ROWS = 3000;
export const XLSX_MAX_COLS = 60;

interface MergeRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** "B6:B22" → 0-기준 범위. 한 칸(":" 없음)이나 형식이 다르면 null */
export function parseMergeRef(ref: string): MergeRange | null {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref.trim().toUpperCase());
  if (!m) return null;
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const top = Number(m[2]) - 1, bottom = Number(m[4]) - 1;
  const left = col(m[1]), right = col(m[3]);
  if (![top, bottom, left, right].every(Number.isFinite) || bottom < top || right < left) return null;
  return { top, left, bottom, right };
}

function sheetToTable(ws: ExcelJS.Worksheet): Table | null {
  const rows = Math.min(ws.rowCount, XLSX_MAX_ROWS);
  const cols = Math.min(ws.columnCount, XLSX_MAX_COLS);
  if (rows < 1 || cols < 1) return null;

  const merges = ((ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? [])
    .map(parseMergeRef)
    .filter((m): m is MergeRange => m !== null);
  /** 병합 범위의 왼쪽·위 칸이 아닌 위치 → 셀을 만들지 않는다(cellAt이 대표 셀을 찾아준다) */
  const covered = new Set<string>();
  const anchorOf = new Map<string, MergeRange>();
  for (const m of merges) {
    anchorOf.set(`${m.top},${m.left}`, m);
    for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) if (r !== m.top || c !== m.left) covered.add(`${r},${c}`);
  }

  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    const row = ws.getRow(r + 1);
    for (let c = 0; c < cols; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const text = xlsxCellText(row.getCell(c + 1));
      const m = anchorOf.get(`${r},${c}`);
      if (!text && !m) continue;
      cells.push({ row: r, col: c, rowSpan: m ? m.bottom - m.top + 1 : 1, colSpan: m ? m.right - m.left + 1 : 1, text, tables: [] });
    }
  }
  if (!cells.length) return null;
  return { type: "table", rows, cols, cells };
}

export async function parseXlsx(buf: Buffer): Promise<DocumentModel> {
  const wb = new ExcelJS.Workbook();
  // exceljs load는 자체 Buffer 타입을 받는다. 정확한 길이의 ArrayBuffer로 복사해 넘긴다(catalog/xlsx-features와 같은 이유).
  await wb.xlsx.load(new Uint8Array(buf).buffer as ArrayBuffer);
  const blocks: Block[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state === "veryHidden" || ws.state === "hidden") continue;
    const table = sheetToTable(ws);
    blocks.push({ type: "paragraph", text: `# ${ws.name}` });
    if (table) blocks.push(table);
  }
  return { format: "xlsx", blocks };
}
