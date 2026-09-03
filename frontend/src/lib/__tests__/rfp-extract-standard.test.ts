import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHwp } from "@/lib/rfp/parse-hwp";
import { extractStandard, isStandardFormat, isRequirementTable, readSummaryCounts } from "@/lib/rfp/extract-standard";
import type { DocumentModel, Table } from "@/lib/rfp/document-model";

const here = import.meta.url; // Vite의 new URL(리터럴, import.meta.url) 특수 처리 우회
const sample = parseHwp(readFileSync(fileURLToPath(new URL("./fixtures/rfp/sample.hwp", here))));

/** 스펙 §6.2 7행 3열 표준 표 */
function reqTable(id: string, opts: Partial<{ category: string; title: string; definition: string; details: string; deliverables: string; related: string }> = {}): Table {
  const c = (row: number, col: number, text: string, rowSpan = 1, colSpan = 1) => ({ row, col, rowSpan, colSpan, text, tables: [] });
  return { type: "table", rows: 7, cols: 3, cells: [
    c(0, 0, "요구사항 분류"), c(0, 1, opts.category ?? "서비스 요구사항", 1, 2),
    c(1, 0, "요구사항 고유번호"), c(1, 1, id, 1, 2),
    c(2, 0, "요구사항 명칭"), c(2, 1, opts.title ?? "제목", 1, 2),
    c(3, 0, "요구사항\n상세설명", 2), c(3, 1, "정의"), c(3, 2, opts.definition ?? "정의값"),
    c(4, 1, "세부 내용"), c(4, 2, opts.details ?? "◦ 세부"),
    c(5, 0, "산출정보"), c(5, 1, opts.deliverables ?? "", 1, 2),
    c(6, 0, "관련요구사항"), c(6, 1, opts.related ?? "", 1, 2),
  ] };
}

describe("isRequirementTable / isStandardFormat", () => {
  it("첫 셀 '요구사항 분류' + 고유번호·명칭 라벨이 있어야 표준 표", () => {
    expect(isRequirementTable(reqTable("SER-001"))).toBe(true);
    const listTable: Table = { type: "table", rows: 2, cols: 3, cells: [
      { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "구 분", tables: [] }, { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "요구사항 ID", tables: [] }, { row: 0, col: 2, rowSpan: 1, colSpan: 1, text: "명 칭", tables: [] },
    ] };
    expect(isRequirementTable(listTable)).toBe(false);
    expect(isStandardFormat({ format: "hwp", blocks: [{ type: "paragraph", text: "x" }] })).toBe(false);
    expect(isStandardFormat(sample)).toBe(true);
  });
});

describe("extractStandard — 합성 문서", () => {
  it("라벨 오른쪽 값을 필드로 읽고 구분 코드는 ID에서 만든다", () => {
    const doc: DocumentModel = { format: "hwp", blocks: [reqTable("SER-001", { title: "AI 대화형 서비스", related: "SER-003 : 대상 업무" }), reqTable("INR-DTL-002", { category: "인프라 상세 요구사항" })] };
    const r = extractStandard(doc);
    expect(r.method).toBe("standard");
    expect(r.requirements).toHaveLength(2);
    expect(r.requirements[0]).toMatchObject({ categoryCode: "SER", categoryName: "서비스 요구사항", reqId: "SER-001", title: "AI 대화형 서비스", definition: "정의값", details: "◦ 세부", deliverables: "", related: "SER-003 : 대상 업무", sortOrder: 0, source: { blockIndex: 0 } });
    expect(r.requirements[1]).toMatchObject({ categoryCode: "INR-DTL", reqId: "INR-DTL-002", source: { blockIndex: 1 } });
    expect(r.warnings).toEqual([]);
  });
  it("ID 형식이 아닌 표는 건너뛰고 경고, 중복 ID는 첫 것만", () => {
    const doc: DocumentModel = { format: "hwp", blocks: [reqTable("없음"), reqTable("SER-001"), reqTable("SER-001", { title: "둘째" })] };
    const r = extractStandard(doc);
    expect(r.requirements.map((q) => q.reqId)).toEqual(["SER-001"]);
    expect(r.requirements[0].title).toBe("제목");
    expect(r.warnings.some((w) => w.includes("ID 형식"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("중복"))).toBe(true);
  });
  it("총괄표 건수가 다르면 경고", () => {
    const summary: Table = { type: "table", rows: 3, cols: 3, cells: [
      { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "요구사항 구분", tables: [] }, { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "ID 부여규칙", tables: [] }, { row: 0, col: 2, rowSpan: 1, colSpan: 1, text: "요구사항수", tables: [] },
      { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "서비스 요구사항", tables: [] }, { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "SER-000", tables: [] }, { row: 1, col: 2, rowSpan: 1, colSpan: 1, text: "3", tables: [] },
      { row: 2, col: 0, rowSpan: 1, colSpan: 1, text: "합 계", tables: [] }, { row: 2, col: 1, rowSpan: 1, colSpan: 1, text: "", tables: [] }, { row: 2, col: 2, rowSpan: 1, colSpan: 1, text: "3", tables: [] },
    ] };
    expect(readSummaryCounts({ format: "hwp", blocks: [summary] })).toEqual(new Map([["SER", 3]]));
    const r = extractStandard({ format: "hwp", blocks: [summary, reqTable("SER-001")] });
    expect(r.warnings).toEqual(["총괄표 SER 3건, 추출 1건"]);
  });
});

describe("extractStandard — 샘플 HWP", () => {
  const r = extractStandard(sample);
  it("124건, 경고 없음, 총괄표 합계 일치", () => {
    expect(r.requirements).toHaveLength(124);
    expect(r.warnings).toEqual([]);
    const counts = readSummaryCounts(sample)!;
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(124);
    expect(counts.get("INR-DTL")).toBe(4);
  });
  it("필드 값", () => {
    const ser1 = r.requirements.find((q) => q.reqId === "SER-001")!;
    expect(ser1).toMatchObject({ categoryCode: "SER", categoryName: "서비스 요구사항", title: "AI 대화형 서비스", definition: "AI 대화형 서비스 기본 기능" });
    expect(ser1.details).toContain("메시지 대화창 UI");
    expect(ser1.related).toContain("SER-003");
    const dtl4 = r.requirements.find((q) => q.reqId === "INR-DTL-004")!;
    expect(dtl4.details).toContain("[");
    expect(dtl4.deliverables).toContain("라이선스");
  });
  it("구분 코드 17개", () => {
    expect(new Set(r.requirements.map((q) => q.categoryCode)).size).toBe(17);
  });
});
