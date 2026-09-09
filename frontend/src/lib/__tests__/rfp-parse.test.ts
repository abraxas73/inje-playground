import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { detectFormat, parseDocument, extensionOf, isUploadPath, ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/rfp/parse";
import { topLevelTables, UnsupportedDocumentError } from "@/lib/rfp/document-model";

// vitest(Vite)는 `new URL("./x", import.meta.url)` 리터럴을 자산 URL로 바꿔 버리므로 변수로 우회한다
const here = import.meta.url;
const sample = readFileSync(fileURLToPath(new URL("./fixtures/rfp/sample.hwp", here)));
const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

describe("extensionOf / 상수", () => {
  it("확장자는 소문자", () => {
    expect(extensionOf("제안요청서.HWPX")).toBe("hwpx");
    expect(extensionOf("a.b.docx")).toBe("docx");
    expect(extensionOf("noext")).toBe("");
    expect(extensionOf("요건표.XLSX")).toBe("xlsx");
    expect(ALLOWED_EXTENSIONS).toEqual(["hwp", "hwpx", "docx", "xlsx", "pdf"]);
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("detectFormat", () => {
  it("OLE + .hwp → hwp, OLE + 다른 확장자 → 거부", () => {
    expect(detectFormat(sample, "제안요청서.hwp")).toBe("hwp");
    expect(() => detectFormat(sample, "제안요청서.doc")).toThrow(UnsupportedDocumentError);
  });
  it("zip 내용으로 hwpx/docx/xlsx 구분", () => {
    expect(detectFormat(zip({ "Contents/content.hpf": "<p/>", "Contents/section0.xml": "<hs:sec/>" }), "a.hwpx")).toBe("hwpx");
    expect(detectFormat(zip({ "word/document.xml": "<w:document/>" }), "a.docx")).toBe("docx");
    expect(detectFormat(zip({ "xl/workbook.xml": "<x/>" }), "a.xlsx")).toBe("xlsx");
    expect(detectFormat(zip({ "xl/worksheets/sheet1.xml": "<w/>" }), "a.xlsx")).toBe("xlsx");
    // 옛 .xls는 OLE이거나 zip이 아니라서 안내 문구가 다르다
    expect(() => detectFormat(zip({ "xl/workbook.xml": "<x/>" }), "a.xls")).toThrow(/xls/);
    expect(() => detectFormat(zip({ "other.txt": "x" }), "a.docx")).toThrow(UnsupportedDocumentError);
  });
  it("xlsx·pdf는 동기 parseDocument로는 읽지 않는다(parseDocumentAsync)", () => {
    expect(() => parseDocument(zip({ "xl/workbook.xml": "<x/>" }), "a.xlsx")).toThrow(/parseDocumentAsync/);
    expect(() => parseDocument(Buffer.from("%PDF-1.4\n"), "a.pdf")).toThrow(/parseDocumentAsync/);
  });
  it("OLE도 zip도 아니면 거부", () => {
    expect(() => detectFormat(Buffer.from("plain text"), "a.hwp")).toThrow(UnsupportedDocumentError);
  });
});

describe("parseDocument", () => {
  it("샘플 hwp를 파싱한다", () => {
    const doc = parseDocument(sample, "제안요청서.hwp");
    expect(doc.format).toBe("hwp");
    expect(topLevelTables(doc)).toHaveLength(232);
  });
});

describe("isUploadPath", () => {
  const ok = "uploads/0b3a4f2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/1a2b3c4d-5e6f-4718-9a0b-1c2d3e4f5a6b.hwp";
  it("업로드 라우트가 만드는 형식만 통과한다", () => {
    expect(isUploadPath(ok)).toBe(true);
    expect(isUploadPath(ok.replace(".hwp", ".xlsx"))).toBe(true);
    expect(isUploadPath(ok.replace(".hwp", ".pdf"))).toBe(true);
  });
  it("경로 조작·다른 버킷·확장자 위조를 막는다", () => {
    expect(isUploadPath("uploads/../../nlm-files/secret.docx")).toBe(false);
    expect(isUploadPath("uploads/%2e%2e/%2e%2e/nlm-files/secret.docx")).toBe(false);
    expect(isUploadPath(ok.replace(".hwp", ".exe"))).toBe(false);
    expect(isUploadPath("uploads/abc/def.hwp")).toBe(false);
    expect(isUploadPath(`${ok}?x=1`)).toBe(false);
    expect(isUploadPath(`/${ok}`)).toBe(false);
    expect(isUploadPath("")).toBe(false);
    expect(isUploadPath(null)).toBe(false);
  });
});
