import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHwp, decodeParaText } from "@/lib/rfp/parse-hwp";
import { cellAt, findLabelCell, rightOf, topLevelTables, paragraphTexts, normalizeLabel } from "@/lib/rfp/document-model";
import { UnsupportedDocumentError } from "@/lib/rfp/document-model";

// import.meta.url을 new URL(...)에 리터럴로 바로 넣으면 Vite가 자산 번들링용 특수 구문으로 인식해
// vitest(jsdom) 환경에서 file:// 대신 http://localhost:3000 기준으로 잘못 해석한다. 변수에 담아 우회한다.
const here = import.meta.url;
const sample = readFileSync(fileURLToPath(new URL("./fixtures/rfp/sample.hwp", here)));

describe("decodeParaText", () => {
  it("일반 문자는 그대로, 줄바꿈(10)은 \\n, 문단 끝(13)은 제거, 확장 컨트롤(11)은 16바이트 건너뜀", () => {
    const buf = Buffer.alloc(2 * 4 + 16 + 2 * 2);
    buf.writeUInt16LE("가".charCodeAt(0), 0);
    buf.writeUInt16LE(10, 2);
    buf.writeUInt16LE("나".charCodeAt(0), 4);
    buf.writeUInt16LE(11, 6); // 확장 컨트롤 시작(뒤 14바이트 포함 총 16바이트)
    buf.writeUInt16LE("다".charCodeAt(0), 6 + 16);
    buf.writeUInt16LE(13, 8 + 16);
    expect(decodeParaText(buf)).toBe("가\n나다");
  });
});

describe("parseHwp(sample)", () => {
  const doc = parseHwp(sample);
  it("형식과 블록 수", () => {
    expect(doc.format).toBe("hwp");
    expect(topLevelTables(doc)).toHaveLength(232);
    expect(paragraphTexts(doc).length).toBeGreaterThan(900);
  });
  it("사업 개요 문단이 최상위 문단으로 나온다", () => {
    expect(paragraphTexts(doc).some((p) => p.includes("사업명 : 생성형 AI 플랫폼 구축 및 AX 개발 사업"))).toBe(true);
  });
  it("7행 요구사항 표가 124개이고 첫 표는 SER-001", () => {
    const req = topLevelTables(doc).filter((t) => t.rows === 7 && normalizeLabel(cellAt(t, 0, 0)?.text ?? "") === "요구사항분류");
    expect(req).toHaveLength(124);
    const first = req[0];
    expect(rightOf(first, findLabelCell(first, ["요구사항고유번호"])!)?.text).toBe("SER-001");
    expect(rightOf(first, findLabelCell(first, ["요구사항명칭"])!)?.text).toBe("AI 대화형 서비스");
    expect(rightOf(first, findLabelCell(first, ["정의"])!)?.text).toBe("AI 대화형 서비스 기본 기능");
  });
  it("병합 셀과 중첩 표가 보존된다", () => {
    const req = topLevelTables(doc).filter((t) => t.rows === 7 && normalizeLabel(cellAt(t, 0, 0)?.text ?? "") === "요구사항분류");
    const first = req[0];
    const label = findLabelCell(first, ["요구사항상세설명"])!;
    expect(label.rowSpan).toBe(2);
    const withNested = req.filter((t) => t.cells.some((c) => c.tables.length > 0));
    expect(withNested.length).toBeGreaterThan(0);
  });
  it("총괄표(19x4)에 요구사항수 합계 124가 있다", () => {
    const summary = topLevelTables(doc).find((t) => normalizeLabel(cellAt(t, 0, 0)?.text ?? "") === "요구사항구분");
    expect(summary).toBeDefined();
    expect(summary!.rows).toBe(19);
    expect(summary!.cells.some((c) => c.text.trim() === "124")).toBe(true);
  });
});

describe("parseHwp(잘못된 입력)", () => {
  it("OLE가 아니면 UnsupportedDocumentError", () => {
    expect(() => parseHwp(Buffer.from("not an ole file"))).toThrow(UnsupportedDocumentError);
  });
});
