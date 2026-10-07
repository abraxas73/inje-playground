import { describe, expect, it } from "vitest";
import { extractionText, sourceKindFor, sourceLengthError, textFromDocument, SOURCE_MAX_CHARS, PPT_SOURCE_EXTENSIONS } from "@/lib/ppt/source";

describe("source", () => {
  it("html·htm 파일은 태그·스크립트를 걷어 본문 텍스트로(제목 구조·목록 유지, meta charset 존중)", async () => {
    expect(PPT_SOURCE_EXTENSIONS).toContain("html");
    expect(PPT_SOURCE_EXTENSIONS).toContain("htm");
    const html = '<html><head><title>T</title><style>p{}</style></head><body><script>alert(1)</script><h1>개요</h1><p>본문 &amp; 설명</p><ul><li>하나</li><li>둘</li></ul></body></html>';
    expect(await textFromDocument(Buffer.from(html, "utf8"), "a.html")).toBe("# 개요\n\n본문 & 설명\n\n- 하나\n- 둘");
    const euc = Buffer.concat([Buffer.from('<meta charset="euc-kr"><p>'), Buffer.from([0xc7, 0xd1]), Buffer.from("</p>")]);
    expect(await textFromDocument(euc, "b.HTM")).toBe("한");
  });

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
