import ExcelJS from "exceljs";
import { orderCategoryCodes, sheetNameFor, sortRequirements, type RequirementRow } from "./requirements";
import { requiresFeature, UNMAPPED_LABEL, VERDICT_LABEL, VERDICT_ORDER, type CatalogSolution, type MappingRow } from "./mapping/types";
import { countBySolution, countByVerdict, groupByRequirement, indexCatalog, mappingSummary, type CatalogIndex } from "./mapping/summary";
import { groupRowsByDetail, isDetailScoped, type DetailGroup } from "./mapping/detail-groups";
import { parseDetailUnits } from "./mapping/detail-items";

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

/** 세로 병합(요구사항·세부 항목 칸을 그 아래 매핑 행만큼 잡는다). 한 줄이면 병합하지 않는다. */
function mergeDown(ws: ExcelJS.Worksheet, col: number, top: number, bottom: number) {
  if (bottom > top) ws.mergeCells(top, col, bottom, col);
}

/** 세부 항목 칸에 넣을 본문. 항목이면 항목 전체 텍스트(하위 줄 포함), 요구사항 전체 단위면 세부 내용 전체 */
function detailCellText(group: DetailGroup, details: string): string {
  return group.text || (group.key ? group.label : details);
}

/** 상세 시트(구분별) 열 — 매핑이 있으면 요구사항 → 세부 항목 → 매핑 순서로 오른쪽으로 넓어진다(화면과 같은 계층) */
const DETAIL_HEADER = ["연번", "요구사항\nID", "요구사항명", "정의", "세부 내용", "산출정보", "관련요구사항"];
const DETAIL_WIDTHS = [5, 12, 24, 26, 85, 20, 32];
const DETAIL_HEADER_MAPPED = [
  "연번", "요구사항\nID", "요구사항명", "정의", "산출정보", "관련요구사항",
  "항목", "세부 내용", "판정", "솔루션", "기능", "매핑 설명", "근거 문장", "근거 URL", "수정",
];
const DETAIL_WIDTHS_MAPPED = [5, 14, 24, 32, 18, 18, 5, 58, 12, 14, 26, 38, 42, 32, 6];

/**
 * 시트 구성: 0.개요 / 1.요구사항_목록(6열, 매핑 있으면 +1열) / 구분별 상세(7열, 매핑 있으면 15열) / (매핑 있으면) {n}.솔루션_매핑
 * 매핑 시트를 마지막에 두는 이유: 1단계 상세 시트 번호(2.SER…)를 바꾸지 않기 위해(스펙 §7).
 *
 * 매핑은 요구사항 목록이 아니라 **상세 시트의 세부 항목마다** 붙는다(화면 매핑 편집기와 같은 단위) —
 * 목록 시트는 요약("당사 솔루션"·"세부 항목 매핑")만, 솔루션_매핑 시트는 병합 없는 한 줄 = 한 매핑 덤프.
 */
export async function buildWorkbook(project: XlsxProject, rows: RequirementRow[], mapping?: XlsxMapping): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NHN Injeinc Workshop — RFP 분석";
  const sorted = sortRequirements(rows);
  const codes = orderCategoryCodes(sorted.map((r) => r.categoryCode));
  const sheetIndex = new Map(codes.map((c, i) => [c, i + 2]));
  const index = mapping ? indexCatalog(mapping.catalog) : null;
  const groups = mapping ? groupByRequirement(mapping.rows) : new Map<string, MappingRow[]>();
  /** 요구사항 → 세부 항목 그룹(화면과 같은 함수). 목록·상세·매핑 시트가 모두 이 결과를 쓴다. */
  const detailGroups = new Map<string, DetailGroup[]>();
  /** 요구사항 → 세부 항목 수(목록 시트의 "세부 항목 매핑" 열) */
  const unitCounts = new Map<string, number>();
  if (mapping) {
    for (const q of sorted) {
      const structure = parseDetailUnits(q.details);
      detailGroups.set(q.id, groupRowsByDetail(groups.get(q.id) ?? [], structure));
      unitCounts.set(q.id, structure.units.length);
    }
  }
  /** "3/5"(매핑된 세부 항목 / 전체). 세부 항목 단위가 아니면 빈 문자열 — 화면 표 배지와 같은 값 */
  const detailProgress = (q: RequirementRow): string => {
    const gs = detailGroups.get(q.id) ?? [];
    if (!isDetailScoped(gs)) return "";
    const done = gs.filter((g) => g.key && g.rows.length).length;
    return `${done}/${unitCounts.get(q.id) ?? 0}`;
  };

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
    // 세부 항목이 목록인 요구사항이 있으면 항목 단위 진행도 한 줄(상세 시트가 이 단위로 펼쳐진다)
    const scopedReqs = sorted.filter((q) => isDetailScoped(detailGroups.get(q.id) ?? []));
    if (scopedReqs.length) {
      const totalUnits = scopedReqs.reduce((s, q) => s + (unitCounts.get(q.id) ?? 0), 0);
      const mappedUnits = scopedReqs.reduce((s, q) => s + (detailGroups.get(q.id) ?? []).filter((g) => g.key && g.rows.length).length, 0);
      keyValueRow(ov, r++, "세부 항목 매핑", `${mappedUnits}/${totalUnits}개 항목 (목록형 요구사항 ${scopedReqs.length}건)`);
    }
    const counts = countByVerdict(sorted.map((q) => q.id), mapping.rows);
    for (const v of VERDICT_ORDER) keyValueRow(ov, r++, VERDICT_LABEL[v], `${counts[v]}건`);
    keyValueRow(ov, r++, UNMAPPED_LABEL, `${counts.unmapped}건`);
    for (const s of countBySolution(mapping.rows, mapping.catalog)) keyValueRow(ov, r++, s.name, `충족 ${s.fulfilled}건 · 부분충족 ${s.partial}건 · 후보 ${s.candidate}건`);
  }

  // 1.요구사항_목록
  // 1.요구사항_목록 — 매핑은 요약만(자세한 건 상세 시트의 세부 항목 행에 있다)
  const list = wb.addWorksheet("1.요구사항_목록");
  const listWidths = mapping ? [5, 22, 16, 38, 55, 30, 12] : [5, 22, 16, 38, 55, 30];
  listWidths.forEach((w, i) => (list.getColumn(i + 1).width = w));
  list.getCell("A1").value = `요구사항 목록 총괄 (전체 ${sorted.length}건)`;
  list.getCell("A1").font = { ...FONT, size: 12, bold: true };
  const listHeader = ["연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "상세 시트 위치", "당사 솔루션"];
  if (mapping) listHeader.push("세부 항목\n매핑");
  list.getRow(3).values = listHeader;
  styleHeader(list.getRow(3));
  sorted.forEach((q, i) => {
    const row = list.getRow(4 + i);
    const sheet = sheetNameFor(q.categoryCode, sheetIndex.get(q.categoryCode)!);
    if (mapping && index) {
      const g = groups.get(q.id) ?? [];
      row.values = [i + 1, q.categoryName, q.reqId, q.title, sheet, g.length ? mappingSummary(g, index) : UNMAPPED_LABEL, detailProgress(q)];
    } else {
      row.values = [i + 1, q.categoryName, q.reqId, q.title, sheet, q.solution];
    }
    styleBody(row);
  });

  // 구분별 상세 — 매핑이 없으면 1단계 그대로(요구사항 한 건 = 한 줄),
  // 매핑이 있으면 세부 항목마다 줄을 펼치고 그 항목의 매핑 행을 오른쪽에 붙인다(화면 매핑 편집기와 같은 단위).
  for (const code of codes) {
    const ws = wb.addWorksheet(sheetNameFor(code, sheetIndex.get(code)!));
    (mapping ? DETAIL_WIDTHS_MAPPED : DETAIL_WIDTHS).forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const inCode = sorted.filter((q) => q.categoryCode === code);
    ws.getCell("A1").value = `[${code}] ${inCode[0].categoryName} — 상세 요구사항`;
    ws.getCell("A1").font = { ...FONT, size: 12, bold: true };
    ws.getRow(3).values = mapping ? [...DETAIL_HEADER_MAPPED] : [...DETAIL_HEADER];
    styleHeader(ws.getRow(3));
    let r = 4;
    inCode.forEach((q, i) => {
      if (!mapping || !index) {
        const row = ws.getRow(r++);
        row.values = [i + 1, q.reqId, q.title, q.definition, q.details, q.deliverables, q.related];
        styleBody(row);
        return;
      }
      const gs = detailGroups.get(q.id) ?? [];
      const scoped = isDetailScoped(gs);
      const reqTop = r;
      for (const g of gs) {
        const groupTop = r;
        // 매핑이 없는 세부 항목도 한 줄 남긴다(판정 "미매핑") — 화면에서 "이 세부 항목은 매핑이 없습니다"로 보이는 자리
        const cells: (MappingRow | null)[] = g.rows.length ? g.rows : [null];
        for (const m of cells) {
          const nm = m ? names(m, index) : { solution: "", feature: "" };
          const row = ws.getRow(r);
          row.values = [
            r === reqTop ? i + 1 : null,
            r === reqTop ? q.reqId : null,
            r === reqTop ? q.title : null,
            r === reqTop ? q.definition : null,
            r === reqTop ? q.deliverables : null,
            r === reqTop ? q.related : null,
            r === groupTop ? (g.key ?? (scoped ? "전체" : "")) : null,
            r === groupTop ? detailCellText(g, q.details) : null,
            m ? VERDICT_LABEL[m.verdict] : UNMAPPED_LABEL,
            nm.solution, nm.feature,
            m?.rationale ?? "", m?.evidenceText ?? "", m?.evidenceUrl ?? "", m?.edited ? "수정" : "",
          ];
          styleBody(row);
          r += 1;
        }
        // 세부 항목 칸(항목·세부 내용)은 그 항목의 매핑 행만큼 세로로 합친다
        mergeDown(ws, 7, groupTop, r - 1);
        mergeDown(ws, 8, groupTop, r - 1);
      }
      // 요구사항 칸(연번·ID·명칭·정의·산출정보·관련요구사항)은 그 요구사항의 모든 줄만큼 합친다
      for (const col of [1, 2, 3, 4, 5, 6]) mergeDown(ws, col, reqTop, r - 1);
    });
  }

  // {n}.솔루션_매핑 — 매핑 1행 = 1줄, 미매핑 요구사항도 1줄
  if (mapping && index) {
    const ms = wb.addWorksheet(`${codes.length + 2}.솔루션_매핑`);
    [5, 18, 14, 36, 40, 14, 26, 10, 50, 46, 40, 8].forEach((w, i) => (ms.getColumn(i + 1).width = w));
    const detailRows = mapping.rows.filter((m) => m.detailKey).length;
    ms.getCell("A1").value = `솔루션 매핑 (요구사항 ${sorted.length}건, 매핑 ${mapping.rows.length}행${detailRows ? `, 세부 항목 단위 ${detailRows}행` : ""})`;
    ms.getCell("A1").font = { ...FONT, size: 12, bold: true };
    ms.getRow(3).values = ["연번", "요구사항 구분", "요구사항 ID", "요구사항 명칭", "세부 항목", "솔루션", "기능", "판정", "매핑 설명", "근거 문장", "근거 URL", "수정"];
    styleHeader(ms.getRow(3));
    let n = 0;
    for (const q of sorted) {
      for (const g of detailGroups.get(q.id) ?? []) {
        const detail = g.key ? `${g.key}. ${g.label}` : "";
        // 매핑이 없는 세부 항목·요구사항은 판정 "미매핑" 한 줄(빈 항목이 표에서 사라지지 않게)
        const cells: (MappingRow | null)[] = g.rows.length ? g.rows : [null];
        for (const m of cells) {
          const nm = m ? names(m, index) : { solution: "", feature: "" };
          const row = ms.getRow(4 + n);
          row.values = [
            ++n, q.categoryName, q.reqId, q.title, detail, nm.solution, nm.feature,
            m ? VERDICT_LABEL[m.verdict] : UNMAPPED_LABEL,
            m?.rationale ?? "", m?.evidenceText ?? "", m?.evidenceUrl ?? "", m?.edited ? "수정" : "",
          ];
          styleBody(row);
        }
      }
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** KST(Asia/Seoul) 기준 YYYYMMDD. Vercel은 UTC라 서버 로컬 날짜를 쓰면 밤 시간대에 하루 어긋난다(3단계 스펙 §5.2). */
export function kstYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}${pick("month")}${pick("day")}`;
}

/** "(발주기관) 사업명_요구사항 검토_YYYYMMDD.xlsx" — 파일명 금지 문자는 _, 날짜는 KST */
export function xlsxFileName(project: XlsxProject, date = new Date()): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  const prefix = project.agency ? `(${safe(project.agency)}) ` : "";
  return `${prefix}${safe(project.name)}_요구사항 검토_${kstYmd(date)}.xlsx`;
}
