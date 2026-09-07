/**
 * exceljs 셀 값 → 텍스트. cell.text는 result가 null인 수식 셀에서 예외를 던지므로(운영 xlsx에서 발견) 값 객체를 직접 푼다.
 * 줄바꿈은 그대로 남긴다 — 엑셀 요건표의 항목 셀은 여러 줄(글머리표)로 쓰여 의미가 있다.
 */
import type ExcelJS from "exceljs";

export function xlsxValueText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { richText?: { text?: string }[]; result?: ExcelJS.CellValue; text?: unknown; hyperlink?: unknown; error?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text ?? "").join("");
    if ("result" in o) return xlsxValueText(o.result ?? null);
    if (typeof o.text === "string") return o.text;
    return "";
  }
  return String(v);
}

/** 셀 텍스트(줄바꿈 유지, 줄 안 공백만 정리) */
export function xlsxCellText(cell: ExcelJS.Cell): string {
  let raw: string;
  try {
    raw = String(cell.text ?? "");
  } catch {
    raw = xlsxValueText(cell.value);
  }
  return raw
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
