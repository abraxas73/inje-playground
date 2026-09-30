import { describe, expect, it } from "vitest";
import { extractionText, sourceKindFor, sourceLengthError, textFromDocument, SOURCE_MAX_CHARS } from "@/lib/ppt/source";

describe("source", () => {
  it("classifies file kinds", () => {
    expect(sourceKindFor("a.pptx")).toBe("pptx");
    expect(sourceKindFor("A.PPTX")).toBe("pptx");
    expect(sourceKindFor("a.docx")).toBe("file");
  });
  it("checks length", () => {
    expect(sourceLengthError("")).toBe("원고를 입력하세요.");
    expect(sourceLengthError("x".repeat(SOURCE_MAX_CHARS))).toBeNull();
    expect(sourceLengthError("x".repeat(SOURCE_MAX_CHARS + 1))).toContain("60,001자");
  });
  it("reads md/txt as utf-8 and rejects xlsx", async () => {
    expect(await textFromDocument(Buffer.from("# 제목\n본문", "utf8"), "a.md")).toBe("# 제목\n본문");
    await expect(textFromDocument(Buffer.from("x"), "a.xlsx")).rejects.toThrow("지원하지 않습니다");
  });
  it("flattens pptx extraction and marks slides without text", () => {
    const t = extractionText([
      { no: 1, title: "배경", texts: ["배경", "첫 문단\n둘째 문단"], pictures: 0, hasTable: true, hasChart: false, titleBottomCm: 3 },
      { no: 2, title: null, texts: [], pictures: 2, hasTable: false, hasChart: false, titleBottomCm: null },
    ]);
    expect(t).toContain("## 장표 1 — 배경");
    expect(t).toContain("첫 문단\n둘째 문단");
    expect(t).toContain("(표 있음)");
    expect(t).toContain("## 장표 2 — (제목 없음)");
    expect(t).toContain("(텍스트 없음, 그림 2개)");
  });
});
