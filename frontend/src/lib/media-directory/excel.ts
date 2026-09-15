import ExcelJS from "exceljs";
import { checkXlsxArchive } from "@/lib/marketing/excel";
import { mediaNorm } from "./normalize";
import type { ImportRow } from "@/types/media-directory";

export interface ParsedMediaSheet { rows: Array<ImportRow & { row: number }>; total: number; blank: number; invalid: { row: number; reason: string }[] }
export const MAX_IMPORT_ROWS = 2000;

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) throw new Error(`${cell.address}: 수식 셀은 값으로 붙여넣은 후 업로드해 주세요.`);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    throw new Error(`${cell.address}: 지원하지 않는 셀 형식입니다.`);
  }
  return String(v);
}

/** First sheet, header row 1 with 매체·부서 columns. Blank departments mark the outlet as any-department. */
export async function parseMediaListXlsx(buffer: Buffer): Promise<ParsedMediaSheet> {
  checkXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("시트가 없습니다.");
  let outletCol = 0, deptCol = 0;
  sheet.getRow(1).eachCell((cell, col) => {
    const label = cellText(cell).replace(/\s/g, "");
    if (label === "매체" || label === "매체명") outletCol = col;
    if (label === "부서" || label === "부서명") deptCol = col;
  });
  if (!outletCol || !deptCol) throw new Error("첫 행에 '매체'와 '부서' 헤더가 필요합니다.");
  const rows: ParsedMediaSheet["rows"] = []; const invalid: ParsedMediaSheet["invalid"] = [];
  let total = 0, blank = 0;
  sheet.eachRow({ includeEmpty: true }, (row, index) => {
    if (index === 1) return;
    const outlet = cellText(row.getCell(outletCol)).trim();
    const department = cellText(row.getCell(deptCol)).trim();
    if (!outlet && !department) { blank++; return; }
    total++;
    if (total > MAX_IMPORT_ROWS) throw new Error(`최대 ${MAX_IMPORT_ROWS}행까지 업로드할 수 있습니다.`);
    if (!outlet) { invalid.push({ row: index, reason: "매체 없음" }); return; }
    if (outlet.length > 100 || department.length > 100) { invalid.push({ row: index, reason: "100자를 넘습니다" }); return; }
    if (mediaNorm(outlet).length < 2) { invalid.push({ row: index, reason: "매체명이 너무 짧습니다" }); return; }
    if (department && mediaNorm(department).length < 2) { invalid.push({ row: index, reason: "부서명이 너무 짧습니다" }); return; }
    rows.push({ row: index, outlet, department: department || null });
  });
  return { rows, total, blank, invalid };
}
