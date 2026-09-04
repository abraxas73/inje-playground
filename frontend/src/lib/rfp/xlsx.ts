import ExcelJS from "exceljs";
import { orderCategoryCodes, sheetNameFor, sortRequirements, type RequirementRow } from "./requirements";
import { requiresFeature, UNMAPPED_LABEL, VERDICT_LABEL, VERDICT_ORDER, type CatalogSolution, type MappingRow } from "./mapping/types";
import { countBySolution, countByVerdict, groupByRequirement, indexCatalog, mappingSummary, type CatalogIndex } from "./mapping/summary";

export interface XlsxProject {
  name: string;
  agency: string | null;
  period: string | null;
  budget: string | null;
  bidMethod: string | null;
  extra: Record<string, string>;
}

/** 2단계 매핑 입력. 없으면 1단계와 같은 워크북. */
export interface XlsxMapping {
  rows: MappingRow[];
  catalog: CatalogSolution[];
  mappingAt: string | null;
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

function sectionTitle(ws: ExcelJS.Worksheet, r: number, title: string) {
  ws.getCell(`B${r}`).value = title;
  ws.getCell(`B${r}`).font = { ...FONT, bold: true };
}

/** 매핑 한 행의 솔루션·기능 이름(build/na는 빈 문자열) */
function names(row: MappingRow, index: CatalogIndex): { solution: string; feature: string } {
  if (!requiresFeature(row.verdict)) return { solution: "", feature: "" };
  const f = row.featureId ? index.feature.get(row.featureId) : undefined;
  return {
    solution: (row.solutionCode && index.solutionName.get(row.solutionCode)) ?? row.solutionCode ?? "",
    feature: f ? `${f.name}${f.isActive ? "" : "[비활성]"}` : "(삭제된 기능)",
  };
}

function formatKst(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "—";
}

/**
 * 시트 구성: 0.개요 / 1.요구사항_목록(6열, 매핑 있으면 +5열) / 구분별 상세(7열) / (매핑 있으면) {n}.솔루션_매핑
 * 매핑 시트를 마지막에 두는 이유: 1단계 상세 시트 번호(2.SER…)를 바꾸지 않기 위해(스펙 §7).
 */
export async function buildWorkbook(project: XlsxProject, rows: RequirementRow[], mapping?: XlsxMapping): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NHN Injeinc Workshop — RFP 분석";
  const sorted = sortRequirements(rows);
  const codes = orderCategoryCodes(sorted.map((r) => r.categoryCode));
  const sheetIndex = new Map(codes.map((c, i) => [c, i + 2]));
  const index = mapping ? indexCatalog(mapping.catalog) : null;
  const groups = mapping ? groupByRequirement(mapping.rows) : new Map<string, MappingRow[]>();

  // 0.개요
  const ov = wb.addWorksheet("0.개요");
  ov.getColumn("A").width = 3;
  ov.getColumn("B").width = 18;
  for (const col of ["C", "D", "E", "F", "G", "H"]) ov.getColumn(col).width = 16;
  ov.getCell("B2").value = `「${project.name}」 제안요청서 요구사항 분석`;
  ov.getCell("B2").font = { ...FONT, size: 14, bold: true };
  sectionTitle(ov, 4, "1. 사업 개요 (일반사항)");
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
    sectionTitle(ov, r, "2. 기타");
    r += 1;
    for (const [k, v] of extras) keyValueRow(ov, r++, k, v);
  }
  if (mapping && index) {
    r += 1;
    sectionTitle(ov, r, "3. 솔루션 매핑 요약");
    r += 1;
    keyValueRow(ov, r++, "실행 시각", formatKst(mapping.mappingAt));
    const counts = countByVerdict(sorted.map((q) => q.id), mapping.rows);
    for (const v of VERDICT_ORDER) keyValueRow(ov, r++, VERDICT_LABEL[v], `${counts[v]}건`);
    keyValueRow(ov, r++, UNMAPPED_LABEL, `${counts.unmapped}건`);
    for (const s of countBySolution(mapping.rows, mapping.catalog)) keyValueRow(ov, r++, s.name, `충족 ${s.fulfilled}건 · 부분충족 ${s.partial}건`);
  }

  // 1.요구사항_목록
  const list = wb.addWorksheet("1.요구사항_목록");
  const listWidths = mapping ? [5, 22, 16, 38, 55, 30, 14, 24, 10, 50, 40] : [5, 22, 16, 38, 55, 30];
  listWidths.forEach((w, i) => (list.getColumn(i + 1).width = w));
  list.getCell("A1").value = `요구사항 목록 총괄 (전체 ${sorted.length}건)`;
  list.getCell("A1").font = { ...FONT, size: 12, bold: true };
  const listHeader = ["연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션"];
  if (mapping) listHeader.push("솔루션", "기능", "판정", "매핑 설명", "근거 URL");
  list.getRow(3).values = listHeader;
  styleHeader(list.getRow(3));
  sorted.forEach((q, i) => {
    const row = list.getRow(4 + i);
    const sheet = sheetNameFor(q.categoryCode, sheetIndex.get(q.categoryCode)!);
    if (mapping && index) {
      const g = groups.get(q.id) ?? [];
      const nm = g.map((m) => names(m, index));
      row.values = [
        i + 1, q.categoryName, q.reqId, q.title, sheet, mappingSummary(g, index),
        nm.map((n) => n.solution).join("\n"),
        nm.map((n) => n.feature).join("\n"),
        g.length ? g.map((m) => VERDICT_LABEL[m.verdict]).join("\n") : UNMAPPED_LABEL,
        g.map((m) => m.rationale).join("\n"),
        g.map((m) => m.evidenceUrl ?? "").join("\n"),
      ];
    } else {
      row.values = [i + 1, q.categoryName, q.reqId, q.title, sheet, q.solution];
    }
    styleBody(row);
  });

  // 구분별 상세(1단계 그대로)
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

  // {n}.솔루션_매핑 — 매핑 1행 = 1줄, 미매핑 요구사항도 1줄
  if (mapping && index) {
    const ms = wb.addWorksheet(`${codes.length + 2}.솔루션_매핑`);
    [5, 18, 14, 36, 14, 26, 10, 50, 40, 8].forEach((w, i) => (ms.getColumn(i + 1).width = w));
    ms.getCell("A1").value = `솔루션 매핑 (요구사항 ${sorted.length}건, 매핑 ${mapping.rows.length}행)`;
    ms.getCell("A1").font = { ...FONT, size: 12, bold: true };
    ms.getRow(3).values = ["연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "솔루션", "기능", "판정", "매핑 설명", "근거 URL", "수정"];
    styleHeader(ms.getRow(3));
    let n = 0;
    for (const q of sorted) {
      const g = groups.get(q.id) ?? [];
      if (!g.length) {
        const row = ms.getRow(4 + n);
        row.values = [++n, q.categoryName, q.reqId, q.title, "", "", UNMAPPED_LABEL, "", "", ""];
        styleBody(row);
        continue;
      }
      for (const m of g) {
        const nm = names(m, index);
        const row = ms.getRow(4 + n);
        row.values = [++n, q.categoryName, q.reqId, q.title, nm.solution, nm.feature, VERDICT_LABEL[m.verdict], m.rationale, m.evidenceUrl ?? "", m.edited ? "수정" : ""];
        styleBody(row);
      }
    }
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
