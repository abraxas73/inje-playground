import ExcelJS from "exceljs";
import { isCodeOnly, RULES_NAME_MAX } from "./extract-rules";
import type { IncomingFeature } from "./merge-features";

/**
 * SharePoint xlsx 기능명세서 파서(4단계 스펙 §4.3). 시트마다 앞 10행에서 "기능명/기능/메뉴/Feature/Name" 헤더를 찾고
 * 설명 열(설명/내용/상세/Description/Detail)·키워드 열(키워드/Keyword)을 고른다. 헤더가 없는 시트는 건너뛴다.
 */
export const XLSX_HEADER_SCAN_ROWS = 10;
const NAME_HEADER_RE = /^(기능명?|기능명칭|메뉴명?|feature(name)?|name)$/i;
const DESC_HEADER_RE = /설명|내용|상세|description|detail/i;
const KEYWORD_HEADER_RE = /키워드|keyword/i;

export interface XlsxParseResult {
  features: IncomingFeature[];
  warnings: string[];
  /** 기능 열을 찾아 읽은 시트 수 */
  sheets: number;
}

function cellText(cell: ExcelJS.Cell): string {
  return String(cell.text ?? "").replace(/\s+/g, " ").trim();
}

export async function parseXlsxFeatures(buffer: Buffer): Promise<XlsxParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs load는 자체 Buffer 타입(ArrayBuffer 확장)을 받는다. 정확한 길이의 새 ArrayBuffer로 복사해 넘긴다(rfp-xlsx.test.ts와 같은 이유).
  await wb.xlsx.load(new Uint8Array(buffer).buffer as ArrayBuffer);
  const features: IncomingFeature[] = [];
  const warnings: string[] = [];
  let sheets = 0;

  for (const ws of wb.worksheets) {
    let headerRow = -1;
    let nameCol = -1;
    const scanTo = Math.min(ws.rowCount, XLSX_HEADER_SCAN_ROWS);
    for (let r = 1; r <= scanTo && headerRow < 0; r++) {
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        if (nameCol < 0 && NAME_HEADER_RE.test(cellText(cell).replace(/\s+/g, ""))) {
          nameCol = col;
          headerRow = r;
        }
      });
    }
    if (headerRow < 0) {
      warnings.push(`시트 ${ws.name}: 기능 열을 찾지 못했습니다.`);
      continue;
    }
    sheets += 1;
    const header = ws.getRow(headerRow);
    let descCol = -1;
    let kwCol = -1;
    header.eachCell({ includeEmpty: false }, (cell, col) => {
      if (col === nameCol) return;
      const t = cellText(cell);
      if (descCol < 0 && DESC_HEADER_RE.test(t)) descCol = col;
      if (kwCol < 0 && KEYWORD_HEADER_RE.test(t)) kwCol = col;
    });
    const headerName = cellText(header.getCell(nameCol));

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = cellText(row.getCell(nameCol));
      if (!name || name === headerName || name.length > RULES_NAME_MAX || isCodeOnly(name)) continue;
      let description = "";
      if (descCol > 0) description = cellText(row.getCell(descCol));
      else {
        // 키워드 열은 IncomingFeature.keywords로 따로 들어가므로 설명에 중복시키지 않는다(스펙 §4.3 "이름 열을 뺀 나머지"의 의도적 축소)
        const parts: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell, col) => {
          if (col === nameCol || col === kwCol) return;
          const t = cellText(cell);
          if (t && !isCodeOnly(t)) parts.push(t);
        });
        description = parts.join(" · ");
      }
      const keywords = kwCol > 0 ? cellText(row.getCell(kwCol)).split(/[,、\n]/).map((s) => s.trim()).filter(Boolean) : [];
      features.push(keywords.length ? { name, description, keywords } : { name, description });
    }
  }
  if (!features.length) warnings.push("파일에서 기능을 찾지 못했습니다.");
  return { features, warnings, sheets };
}

/** 소스 행 note에 남기는 요약 */
export function xlsxNote(r: XlsxParseResult): string {
  return `xlsx: 시트 ${r.sheets}개 → 기능 ${r.features.length}개`;
}
