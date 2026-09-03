import { describe, it, expect } from "vitest";
import {
  parseReqId, orderCategoryCodes, sheetNameFor, nextReqId, categoryCodeFromName, sortRequirements,
  STANDARD_CATEGORY_ORDER, type Requirement,
} from "@/lib/rfp/requirements";

const req = (categoryCode: string, reqId: string, sortOrder: number): Requirement => ({
  categoryCode, categoryName: categoryCode, reqId, title: "", definition: "", details: "", deliverables: "", related: "", sortOrder, source: { blockIndex: sortOrder },
});

describe("parseReqId", () => {
  it("코드-숫자 형식을 읽고 공백·소문자를 정리한다", () => {
    expect(parseReqId("SER-001")).toEqual({ code: "SER", num: 1 });
    expect(parseReqId("INR-DTL-004")).toEqual({ code: "INR-DTL", num: 4 });
    expect(parseReqId(" ser-12 ")).toEqual({ code: "SER", num: 12 });
    expect(parseReqId("요구사항")).toBeNull();
    expect(parseReqId("SER001")).toBeNull();
    expect(parseReqId("")).toBeNull();
  });
});

describe("orderCategoryCodes / sheetNameFor", () => {
  it("표준 순서를 먼저, 그 외는 등장 순서", () => {
    expect(orderCategoryCodes(["COR", "XYZ", "SER", "INR-DTL", "ABC", "SER"])).toEqual(["SER", "INR-DTL", "COR", "XYZ", "ABC"]);
    expect(STANDARD_CATEGORY_ORDER[0]).toBe("SER");
    expect(STANDARD_CATEGORY_ORDER).toContain("INR-DTL");
  });
  it("시트명은 순번.코드(하이픈 제거)", () => {
    expect(sheetNameFor("SER", 2)).toBe("2.SER");
    expect(sheetNameFor("INR-DTL", 12)).toBe("12.INRDTL");
  });
});

describe("nextReqId", () => {
  it("같은 코드의 최대 번호 + 1, 3자리", () => {
    expect(nextReqId("SER", ["SER-001", "SER-004", "ASR-009"])).toBe("SER-005");
    expect(nextReqId("SEC", [])).toBe("SEC-001");
  });
});

describe("categoryCodeFromName", () => {
  it("구분명 키워드로 표준 코드를 고른다", () => {
    expect(categoryCodeFromName("서비스 요구사항")).toBe("SER");
    expect(categoryCodeFromName("AI 기반 솔루션 요구사항")).toBe("ASR");
    expect(categoryCodeFromName("데이터 플랫폼 요구사항")).toBe("DPR");
    expect(categoryCodeFromName("데이터 요구사항")).toBe("DAR");
    expect(categoryCodeFromName("인프라 상세 요구사항")).toBe("INR-DTL");
    expect(categoryCodeFromName("인프라 요구사항")).toBe("INR");
    expect(categoryCodeFromName("프로젝트지원 요구사항")).toBe("PSR");
    expect(categoryCodeFromName("제약사항")).toBe("COR");
    expect(categoryCodeFromName("알 수 없음")).toBe("REQ");
  });
});

describe("sortRequirements", () => {
  it("구분 표준 순서 → sortOrder", () => {
    const rows = [req("COR", "COR-001", 0), req("SER", "SER-002", 5), req("SER", "SER-001", 4), req("ZZZ", "ZZZ-001", 2)];
    expect(sortRequirements(rows).map((r) => r.reqId)).toEqual(["SER-001", "SER-002", "COR-001", "ZZZ-001"]);
  });
});
