import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { CATEGORIES, FIELDS, MASTER_HEADER_GROUPS, MASTER_SORT_FIELDS, emptyContact, visibleData, type Contact, type ContactData, type Field } from "./types";
import type { masterFilters } from "./search";
import { fieldErrors } from "./validation";
export interface ExcelRow { row: number; sheet: string; dbId: string; category: string; data: ContactData; raw: Record<string, string>; errors: string[]; blockingErrors?: string[]; cellIssues?: Record<string,string> }
export interface ExcelPreview { filename: string; hash: string; sheet: string; headerRow: number; columns: string[]; rows: ExcelRow[]; total: number; errors: string[]; companyConflicts?: { company: string; categories: string[]; rows: number[] }[] }
const label = (v: string) => v.replace(/\s/g, "");
const HEADERS = ["분류", "DB ID", ...Object.values(FIELDS)];
function value(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) throw new Error(`${cell.address}: 수식 셀은 값으로 붙여넣은 후 제출해 주세요.`);
    if ("richText" in v) return v.richText.map(x => x.text).join("");
    if ("text" in v) return String(v.text);
    throw new Error(`${cell.address}: 지원하지 않는 셀 형식입니다.`);
  }
  return String(v);
}
// Inspect central-directory sizes before decompression (ZIP64/encrypted archives are not accepted).
export function checkXlsxArchive(buffer: Buffer) {
  if (buffer.length > 10 * 1024 * 1024) throw new Error("Excel 파일은 10MB 이하여야 합니다.");
  let end = -1;
  for (let p = buffer.length - 22; p >= Math.max(0, buffer.length - 65557); p--) if (buffer.readUInt32LE(p) === 0x06054b50) { end = p; break; }
  if (end < 0) throw new Error("유효한 XLSX 파일이 아닙니다.");
  const count = buffer.readUInt16LE(end + 10); let pos = buffer.readUInt32LE(end + 16); let total = 0;
  if (count > 2000 || pos === 0xffffffff) throw new Error("지원 범위를 넘는 Excel 파일입니다.");
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("Excel 압축 구조 오류");
    total += buffer.readUInt32LE(pos + 24);
    if (total > 80 * 1024 * 1024 || (buffer.readUInt16LE(pos + 8) & 1)) throw new Error("Excel 압축 해제 크기가 너무 크거나 암호화되어 있습니다.");
    pos += 46 + buffer.readUInt16LE(pos + 28) + buffer.readUInt16LE(pos + 30) + buffer.readUInt16LE(pos + 32);
  }
}
export async function parseExcel(buffer: Buffer, filename: string, master = false): Promise<ExcelPreview> {
  checkXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet(master ? "01_Master_DB" : "Contact 제출");
  if (!sheet) throw new Error(master ? "01_Master_DB 시트를 찾을 수 없습니다." : "Contact 제출 시트가 필요합니다. 양식을 다운로드해 주세요.");
  const headerRow = master ? 3 : 1;
  const columns: Record<string, number> = {};
  sheet.getRow(headerRow).eachCell((cell, col) => {
    const k = label(value(cell));
    if (columns[k]) throw new Error(`중복 컬럼: ${k}`);
    columns[k] = col;
  });
  for (const h of master ? HEADERS : ["DB ID", ...Object.values(FIELDS)]) if (!columns[label(h)]) throw new Error(`필수 컬럼이 없습니다: ${h}`);
  const rows: ExcelRow[] = []; const errors: string[] = [];
  const seenIds = new Set<string>(); const seenEmails = new Set<string>();
  sheet.eachRow((row, index) => {
    if (index <= headerRow) return;
    const raw: Record<string, string> = {}; const cellErrors: string[] = []; const cellIssues: Record<string,string> = {};
    for (const [h, c] of Object.entries(columns)) {
      try { raw[h] = value(row.getCell(c)); } catch(e) { if (master) throw e; raw[h] = JSON.stringify(row.getCell(c).value); const message = e instanceof Error ? e.message : "셀 형식 오류"; cellErrors.push(message); const key = Object.entries(FIELDS).find(([,title]) => label(title) === h)?.[0] ?? (h === label("DB ID") ? "dbId" : h); cellIssues[key] = message; }
    }
    if (!Object.values(raw).some(v => v.trim()) && !cellErrors.length) return;
    const data = emptyContact();
    for (const [k, h] of Object.entries(FIELDS)) data[k as Field] = raw[label(h)] ?? "";
    const dbId = (raw[label("DB ID")] ?? "").trim(); const category = raw["분류"]?.trim() ?? "확인 필요";
    const itemErrors = master ? [] : [...cellErrors, ...fieldErrors(data).filter(e => !dbId || !e.endsWith("누락"))];
    if (master) {
      if (!dbId || seenIds.has(dbId)) errors.push(`${index}행: DB ID 누락 또는 중복`);
      if (!CATEGORIES.includes(category as typeof CATEGORIES[number])) errors.push(`${index}행: 허용되지 않은 분류`);
      const email = data.email.trim().toLowerCase();
      if (email && seenEmails.has(email)) errors.push(`${index}행: 이메일 중복`);
      seenIds.add(dbId); if (email) seenEmails.add(email);
    }
    for (const [key, v] of Object.entries(data)) if (v.length > 2000) itemErrors.push(`${FIELDS[key as Field]}는 2,000자 이하여야 합니다.`);
    rows.push({ row: index, sheet: sheet.name, dbId, category, data, raw, errors: itemErrors, blockingErrors: cellErrors, cellIssues });
  });
  if (!rows.length || rows.length > (master ? 10000 : 50)) throw new Error(master ? "이관은 1~10,000건까지 가능합니다." : "한 번에 1~50건을 제출해 주세요.");
  const groups = new Map<string, ExcelRow[]>();
  for (const row of rows) { const key = row.data.company.trim().toLowerCase(); if (key) groups.set(key, [...(groups.get(key) ?? []), row]); }
  const companyConflicts = [...groups.entries()].filter(([, items]) => new Set(items.map(r => r.category)).size > 1).map(([company,items]) => ({ company, categories: [...new Set(items.map(r => r.category))], rows: items.map(r => r.row) }));
  return { companyConflicts, filename, hash: createHash("sha256").update(buffer).digest("hex"), sheet: sheet.name, headerRow, columns: Object.keys(columns), rows, total: rows.length, errors };
}
export async function submissionTemplate() {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Contact 제출");
  sheet.columns = ["DB ID", ...Object.values(FIELDS)].map(h => ({ header: h, width: h === "이메일" ? 32 : 22 }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2454DB" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const guide = workbook.addWorksheet("작성 안내");
  guide.columns = [{ width: 105 }];
  ["Contact 제출 시트에 1~50건을 입력하세요. 머리글을 변경하지 마세요.", "회사명·성명·이메일 누락 또는 형식 오류는 확인 필요로 접수하며 승인 전 보완해야 합니다. 변경: 기존 DB ID 입력 권장, 빈칸은 기존 정보 유지.", "값 삭제는 단건 제출 폼의 삭제 체크를 사용하세요. 날짜: YYYY-MM-DD.", "수식 대신 값으로 입력하고, 연락처·ID는 텍스트로 보존하세요.", "제출 정보는 검수 담당자 승인 후 Master에 반영됩니다."].forEach(t => guide.addRow([t]));
  return workbook.xlsx.writeBuffer();
}

export async function masterExport(contacts: Contact[], filters: ReturnType<typeof masterFilters>, generatedAt: Date) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "INNOGRID"; workbook.created = generatedAt;
  const sheet = workbook.addWorksheet("01_Master_DB");
  const widths = [20, 16, 24, 12, 20, 16, 34, 22, 26, 22, 26, 12, 16, 18, 18, 18, 16, 45];
  sheet.columns = widths.map(width => ({ width, style: { numFmt: "@", font: { name: "맑은 고딕", size: 11 }, alignment: { vertical: "top", wrapText: true } } }));
  sheet.mergeCells("A1:R1"); sheet.getCell("A1").value = "INNOGRID Master DB List";
  sheet.getRow(1).height = 32;
  let col = 1;
  for (const group of MASTER_HEADER_GROUPS) {
    if (group.span > 1) sheet.mergeCells(2, col, 2, col + group.span - 1);
    sheet.getCell(2, col).value = group.label; col += group.span;
  }
  sheet.getRow(2).height = 26;
  sheet.getRow(3).values = HEADERS.map(h => h === "최종확인일" ? "최종\n확인일" : h);
  sheet.getRow(3).height = 34;
  for (let row = 1; row <= 3; row++) for (let column = 1; column <= 18; column++) {
    const cell = sheet.getCell(row, column);
    cell.font = { name: "맑은 고딕", size: row === 1 ? 14 : 11, bold: true, color: { argb: row < 3 ? "FFFFFFFF" : "FF1E293B" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: row < 3 ? "FF2454DB" : "FFE8EDF5" } };
    cell.alignment = { vertical: "middle", horizontal: row === 1 ? "left" : "center", wrapText: true };
  }
  for (const contact of contacts) {
    const data = visibleData(contact);
    // Explicit string values preserve leading zeros and never become Excel formulas.
    const values = [contact.organization?.category ?? "확인 필요", contact.db_id, ...Object.keys(FIELDS).map(k => data[k as Field])].map(v => String(v ?? ""));
    const row = sheet.addRow(values);
    const lines = values.map((v, i) => v.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) / (widths[i] - 2))), 0));
    row.height = Math.min(409, Math.max(24, Math.max(...lines) * 16 + 6));
  }
  sheet.views = [{ state: "frozen", ySplit: 3, xSplit: 2, topLeftCell: "C4" }];
  sheet.autoFilter = { from: "A3", to: `R${Math.max(3, sheet.rowCount)}` };
  const info = workbook.addWorksheet("조회 조건");
  info.columns = [{ width: 24 }, { width: 80 }];
  info.addRows([
    ["항목", "내용"], ["다운로드 시각 (한국)", generatedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })],
    ["조회 결과 건수", contacts.length], ["검색어", filters.p_q || "전체"], ["회사·기관 분류", filters.p_category || "전체"],
    ["내부 관리부서", filters.p_department || "전체"], ["정비 필요만 보기", filters.p_issues ? "예" : "아니오"],
    ["정렬 기준", MASTER_SORT_FIELDS[filters.p_sort]], ["정렬 방향", filters.p_direction === "desc" ? "내림차순" : "오름차순"],
    ["데이터 기준", "다운로드 요청 시점의 승인된 Master DB 전체 필터 결과. 회사명·분류는 현재 표준값입니다."],
  ]);
  info.eachRow(row => { row.height = 28; row.alignment = { vertical: "middle", wrapText: true }; row.font = { name: "맑은 고딕", size: 11 }; });
  info.getRow(1).font = { name: "맑은 고딕", size: 11, bold: true };
  info.getRow(10).height = 42;
  return workbook.xlsx.writeBuffer();
}
