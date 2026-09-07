import { unzipSync } from "fflate";
import { UnsupportedDocumentError, type DocumentFormat, type DocumentModel } from "./document-model";
import { parseHwp } from "./parse-hwp";
import { parseHwpx } from "./parse-hwpx";
import { parseDocx } from "./parse-docx";
import { parseXlsx } from "./parse-xlsx";

export const ALLOWED_EXTENSIONS = ["hwp", "hwpx", "docx", "xlsx"] as const;
/** 사람이 읽는 허용 형식 목록(업로드 안내·오류 문구 공용) */
export const ALLOWED_EXTENSIONS_TEXT = "hwp·hwpx·docx·xlsx";
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

/** 매직넘버 + 확장자 + zip 내용으로 형식 판별. 맞지 않으면 UnsupportedDocumentError. */
export function detectFormat(buf: Buffer, fileName: string): DocumentFormat {
  const ext = extensionOf(fileName);
  const isOle = buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1;
  const isZip = buf.length >= 4 && buf.readUInt32BE(0) === 0x504b0304;
  if (isOle) {
    if (ext !== "hwp") throw new UnsupportedDocumentError("파일 내용은 HWP(OLE)인데 확장자가 다릅니다. .hwp 파일만 지원합니다.");
    return "hwp";
  }
  if (isZip) {
    let names: string[];
    try {
      names = Object.keys(unzipSync(new Uint8Array(buf)));
    } catch {
      throw new UnsupportedDocumentError("zip 파일을 열 수 없습니다.");
    }
    if (names.includes("Contents/content.hpf") || names.some((n) => /^Contents\/section\d+\.xml$/.test(n))) return "hwpx";
    if (names.includes("word/document.xml")) return "docx";
    if (names.includes("xl/workbook.xml") || names.some((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
      if (ext === "xls") throw new UnsupportedDocumentError("옛 엑셀(.xls)은 지원하지 않습니다. .xlsx로 저장해 올려주세요.");
      return "xlsx";
    }
    throw new UnsupportedDocumentError("zip 안에 HWPX·DOCX·XLSX 본문이 없습니다.");
  }
  throw new UnsupportedDocumentError(`지원하지 않는 파일 형식입니다. ${ALLOWED_EXTENSIONS_TEXT}만 올릴 수 있습니다.`);
}

/** 동기 파서(hwp·hwpx·docx). xlsx는 exceljs 읽기가 비동기라 parseDocumentAsync를 쓴다. */
export function parseDocument(buf: Buffer, fileName: string): DocumentModel {
  const format = detectFormat(buf, fileName);
  if (format === "hwp") return parseHwp(buf);
  if (format === "hwpx") return parseHwpx(buf);
  if (format === "docx") return parseDocx(buf);
  throw new UnsupportedDocumentError("xlsx는 parseDocumentAsync로 읽습니다.");
}

/** 모든 형식. 라우트·잡은 이 함수를 쓴다. */
export async function parseDocumentAsync(buf: Buffer, fileName: string): Promise<DocumentModel> {
  const format = detectFormat(buf, fileName);
  return format === "xlsx" ? parseXlsx(buf) : parseDocument(buf, fileName);
}
