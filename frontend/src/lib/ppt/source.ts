/** 원고 정리 — 텍스트·문서 파일·PPT 원고를 LLM에 넣을 텍스트로. 파서는 RFP 것을 재사용한다. */
import { parseDocumentAsync } from "@/lib/rfp/parse";
import { documentText, UnsupportedDocumentError } from "@/lib/rfp/document-model";
import { PPT_SOURCE_EXTENSIONS_TEXT, SOURCE_MAX_CHARS } from "@/types/ppt";
import type { PptSourceKind } from "@/types/ppt";
import type { PptExtractSlide } from "./service";

export { SOURCE_MAX_CHARS, PPT_SOURCE_EXTENSIONS, PPT_SOURCE_EXTENSIONS_TEXT, SOURCE_KIND_LABEL } from "@/types/ppt";

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

export function sourceKindFor(fileName: string): PptSourceKind {
  return extensionOf(fileName) === "pptx" ? "pptx" : "file";
}

export function sourceLengthError(text: string): string | null {
  const n = text.trim().length;
  if (n === 0) return "원고를 입력하세요.";
  if (n > SOURCE_MAX_CHARS) return `원고가 너무 깁니다(${n.toLocaleString("ko-KR")}자). ${SOURCE_MAX_CHARS.toLocaleString("ko-KR")}자 이하로 줄여 주세요.`;
  return null;
}

/** docx·pdf·hwp·hwpx는 RFP 파서로, md·txt는 UTF-8로. 그 밖(xlsx 등)은 UnsupportedDocumentError. */
export async function textFromDocument(buf: Buffer, fileName: string): Promise<string> {
  const ext = extensionOf(fileName);
  if (ext === "md" || ext === "txt") return buf.toString("utf8").replace(/^﻿/, "");
  if (ext === "docx" || ext === "pdf" || ext === "hwp" || ext === "hwpx") return documentText(await parseDocumentAsync(buf, fileName));
  throw new UnsupportedDocumentError(`${ext || "확장자 없는"} 파일은 PPT 원고로 지원하지 않습니다(${PPT_SOURCE_EXTENSIONS_TEXT}).`);
}

/** /extract 결과를 LLM용 텍스트로. 장표 순서 유지가 규칙이므로 번호를 앞세운다. */
export function extractionText(slides: PptExtractSlide[]): string {
  return slides.map((s) => {
    const flags = [s.hasTable ? "표 있음" : "", s.hasChart ? "차트 있음" : ""].filter(Boolean);
    const lines = [`## 장표 ${s.no} — ${s.title ?? "(제목 없음)"}`];
    if (s.texts.length) lines.push(...s.texts);
    else lines.push(`(텍스트 없음, 그림 ${s.pictures}개)`);
    if (s.texts.length && s.pictures) lines.push(`(그림 ${s.pictures}개)`);
    if (flags.length) lines.push(`(${flags.join(", ")})`);
    return lines.join("\n");
  }).join("\n\n");
}
