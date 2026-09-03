import ExcelJS from "exceljs";
import { orderCategoryCodes, sheetNameFor, sortRequirements, type RequirementRow } from "./requirements";

export interface XlsxProject {
  name: string;
  agency: string | null;
  period: string | null;
  budget: string | null;
  bidMethod: string | null;
  extra: Record<string, string>;
}

const FONT: Partial<ExcelJS.Font> = { name: "맑은 고딕", size: 10 };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
const THIN: Partial<ExcelJS.Border> = { style: "thin" };
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { ...FONT, bold: true };
    c.fill = HEADER_FILL;
    c.border = BORDER;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

function styleBody(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (c) => {
    c.font = FONT;
    c.border = BORDER;
    c.alignment = { vertical: "top", wrapText: true };
  });
}

/** 개요 시트의 "라벨 | 값(C~H 병합)" 한 줄 */
function keyValueRow(ws: ExcelJS.Worksheet, r: number, key: string, value: string) {
  ws.getCell(`B${r}`).value = key;
  ws.getCell(`C${r}`).value = value;
  ws.mergeCells(`C${r}:H${r}`);
  for (const col of ["B", "C"]) {
    const c = ws.getCell(`${col}${r}`);
    c.font = col === "B" ? { ...FONT, bold: true } : FONT;
    c.border = BORDER;
    c.alignment = { vertical: "top", wrapText: true };
  }
  ws.getCell(`B${r}`).fill = HEADER_FILL;
}

/** 샘플 xlsx와 같은 시트 구성: 0.개요 / 1.요구사항_목록(6열) / 구분별 상세(7열) */
export async function buildWorkbook(project: XlsxProject, rows: RequirementRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NHN Injeinc Workshop — RFP 분석";
  const sorted = sortRequirements(rows);
  const codes = orderCategoryCodes(sorted.map((r) => r.categoryCode));
  const sheetIndex = new Map(codes.map((c, i) => [c, i + 2]));

  // 0.개요
  const ov = wb.addWorksheet("0.개요");
  ov.getColumn("A").width = 3;
  ov.getColumn("B").width = 18;
  for (const col of ["C", "D", "E", "F", "G", "H"]) ov.getColumn(col).width = 16;
  ov.getCell("B2").value = `「${project.name}」 제안요청서 요구사항 분석`;
  ov.getCell("B2").font = { ...FONT, size: 14, bold: true };
  ov.getCell("B4").value = "1. 사업 개요 (일반사항)";
  ov.getCell("B4").font = { ...FONT, bold: true };
  const items: [string, string | null][] = [
    ["사업명", project.name],
    ["사업기간", project.period],
    ["설계금액", project.budget],
    ["발주기관", project.agency],
    ["입찰 및 계약방법", project.bidMethod],
  ];
  let r = 5;
  for (const [k, v] of items) keyValueRow(ov, r++, k, v ?? "");
  const extras = Object.entries(project.extra);
  if (extras.length) {
    r += 1;
    ov.getCell(`B${r}`).value = "2. 기타";
    ov.getCell(`B${r}`).font = { ...FONT, bold: true };
    r += 1;
    for (const [k, v] of extras) keyValueRow(ov, r++, k, v);
  }

  // 1.요구사항_목록
  const list = wb.addWorksheet("1.요구사항_목록");
  [5, 22, 16, 38, 55, 30].forEach((w, i) => (list.getColumn(i + 1).width = w));
  list.getCell("A1").value = `요구사항 목록 총괄 (전체 ${sorted.length}건)`;
  list.getCell("A1").font = { ...FONT, size: 12, bold: true };
  list.getRow(3).values = ["연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션"];
  styleHeader(list.getRow(3));
  sorted.forEach((q, i) => {
    const row = list.getRow(4 + i);
    row.values = [i + 1, q.categoryName, q.reqId, q.title, sheetNameFor(q.categoryCode, sheetIndex.get(q.categoryCode)!), q.solution];
    styleBody(row);
  });

  // 구분별 상세
  for (const code of codes) {
    const ws = wb.addWorksheet(sheetNameFor(code, sheetIndex.get(code)!));
    [5, 12, 24, 26, 85, 20, 32].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const inCode = sorted.filter((q) => q.categoryCode === code);
    ws.getCell("A1").value = `[${code}] ${inCode[0].categoryName} — 상세 요구사항`;
    ws.getCell("A1").font = { ...FONT, size: 12, bold: true };
    ws.getRow(3).values = ["연번", "요구사항\nID", "요구사항명", "정의", "세부 내용", "산출정보", "관련요구사항"];
    styleHeader(ws.getRow(3));
    inCode.forEach((q, i) => {
      const row = ws.getRow(4 + i);
      row.values = [i + 1, q.reqId, q.title, q.definition, q.details, q.deliverables, q.related];
      styleBody(row);
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** "(발주기관) 사업명_요구사항 검토_YYYYMMDD.xlsx" — 파일명 금지 문자는 _ */
export function xlsxFileName(project: XlsxProject, date = new Date()): string {
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  const prefix = project.agency ? `(${safe(project.agency)}) ` : "";
  return `${prefix}${safe(project.name)}_요구사항 검토_${ymd}.xlsx`;
}
