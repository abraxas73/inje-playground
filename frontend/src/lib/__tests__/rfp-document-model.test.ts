import { describe, it, expect } from "vitest";
import {
  cellAt, rightOf, findLabelCell, flattenCellText, cellGrid, tableText, documentText, normalizeLabel,
  topLevelTables, paragraphTexts, type Table, type DocumentModel,
} from "@/lib/rfp/document-model";

/** 2x3 표. (0,0)은 세로 병합(rowSpan 2), (1,2)에 중첩 표 */
const nested: Table = {
  type: "table", rows: 1, cols: 2,
  cells: [
    { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "구분", tables: [] },
    { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "설명", tables: [] },
  ],
};
const table: Table = {
  type: "table", rows: 2, cols: 3,
  cells: [
    { row: 0, col: 0, rowSpan: 2, colSpan: 1, text: "요구사항\n상세설명", tables: [] },
    { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "정의", tables: [] },
    { row: 0, col: 2, rowSpan: 1, colSpan: 1, text: "AI 대화형 서비스 기본 기능", tables: [] },
    { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "세부 내용", tables: [] },
    { row: 1, col: 2, rowSpan: 1, colSpan: 1, text: "◦ 첫 줄\n - 둘째 줄", tables: [nested] },
  ],
};
const doc: DocumentModel = { format: "hwp", blocks: [{ type: "paragraph", text: " □ 사업명 : 테스트 사업" }, table, { type: "paragraph", text: "" }] };

describe("normalizeLabel", () => {
  it("공백·줄바꿈을 지우고 NFKC 정규화한다", () => {
    expect(normalizeLabel("요구사항\n상세설명")).toBe("요구사항상세설명");
    expect(normalizeLabel(" 세부  내용 ")).toBe("세부내용");
    expect(normalizeLabel("ＩＤ")).toBe("ID");
  });
});

describe("cellAt / rightOf / findLabelCell", () => {
  it("병합 셀이 덮는 위치를 찾는다", () => {
    expect(cellAt(table, 1, 0)?.text).toBe("요구사항\n상세설명");
    expect(cellAt(table, 1, 1)?.text).toBe("세부 내용");
    expect(cellAt(table, 2, 0)).toBeUndefined();
  });
  it("라벨 셀의 오른쪽 셀을 값으로 준다", () => {
    const label = findLabelCell(table, ["세부내용", "상세내용"])!;
    expect(label.text).toBe("세부 내용");
    expect(rightOf(table, label)?.text).toBe("◦ 첫 줄\n - 둘째 줄");
    expect(rightOf(table, cellAt(table, 0, 2)!)).toBeUndefined();
  });
  it("라벨이 없으면 undefined", () => {
    expect(findLabelCell(table, ["산출정보"])).toBeUndefined();
  });
});

describe("flattenCellText / cellGrid / tableText", () => {
  it("중첩 표를 [a | b] 줄로 펼친다", () => {
    expect(flattenCellText(cellAt(table, 1, 2)!)).toBe("◦ 첫 줄\n - 둘째 줄\n[구분 | 설명]");
  });
  it("그리드는 병합 셀 좌상단에만 텍스트를 둔다", () => {
    expect(cellGrid(table)).toEqual([
      ["요구사항\n상세설명", "정의", "AI 대화형 서비스 기본 기능"],
      ["", "세부 내용", "◦ 첫 줄\n - 둘째 줄"],
    ]);
    expect(tableText(nested)).toBe("| 구분 | 설명 |");
  });
});

describe("documentText / topLevelTables / paragraphTexts", () => {
  it("문단과 표를 문서 순서대로 텍스트로 만들고 빈 문단은 뺀다", () => {
    expect(documentText(doc).split("\n")[0]).toBe(" □ 사업명 : 테스트 사업");
    expect(documentText(doc)).toContain("| 요구사항 상세설명 | 정의 | AI 대화형 서비스 기본 기능 |");
    expect(topLevelTables(doc)).toHaveLength(1);
    expect(paragraphTexts(doc)).toEqual([" □ 사업명 : 테스트 사업", ""]);
  });
});
