import { describe, expect, it } from "vitest";
import { categoryLabel, findCategorySummary, matchesRule, parseCategorySummary, patternKey, ruleToPattern, shortCategoryName, type CategorySummaryRow } from "@/lib/rfp/category-summary";

const rows: CategorySummaryRow[] = [
  { name: "시스템 장비구성 요구사항", nameEn: "Equipment Composition Requirement", rule: "ECR-OOO-000", count: 64 },
  { name: "인터페이스 요구사항", nameEn: "System Interface Requirement", rule: "INR-OOO-000", count: 8 },
  { name: "인프라 요구사항 (Infra Requirement)", nameEn: null, rule: "INR-000", count: 11 },
  { name: "인프라 상세 요구사항(Infra Detail Requirement)", nameEn: null, rule: "INR-DTL-000", count: 4 },
  { name: "기능 요구사항", nameEn: null, rule: "SFR-GEN-000", count: 7 },
];

describe("ruleToPattern / matchesRule", () => {
  it("끝 숫자 자리를 버리고 O/X 세그먼트는 와일드카드", () => {
    expect(ruleToPattern("ECR-OOO-000")).toEqual({ segments: ["ECR", null] });
    expect(ruleToPattern("ecr - xxx - 000")).toEqual({ segments: ["ECR", null] });
    expect(ruleToPattern("SER-000")).toEqual({ segments: ["SER"] });
    expect(ruleToPattern("INR-DTL-000")).toEqual({ segments: ["INR", "DTL"] });
    expect(patternKey(ruleToPattern("ECR-OOO-000")!)).toBe("ECR-OOO");
    expect(ruleToPattern("합계")).toBeNull();
    expect(ruleToPattern("")).toBeNull();
  });
  it("정확 일치는 세그먼트 수까지, 접두 일치는 앞부분만", () => {
    const p = ruleToPattern("ECR-OOO-000")!;
    expect(matchesRule(p, "ECR-IFR")).toBe(true);
    expect(matchesRule(p, "ECR")).toBe(false);
    expect(matchesRule(p, "CTR-MSA")).toBe(false);
    const inr = ruleToPattern("INR-000")!;
    expect(matchesRule(inr, "INR-SIR")).toBe(false);
    expect(matchesRule(inr, "INR-SIR", "prefix")).toBe(true);
  });
});

describe("findCategorySummary", () => {
  it("와일드카드 없는 정확 일치 > 와일드카드 > 접두", () => {
    expect(findCategorySummary(rows, "INR-DTL")?.rule).toBe("INR-DTL-000");
    expect(findCategorySummary(rows, "INR-SIR")?.rule).toBe("INR-OOO-000");
    expect(findCategorySummary(rows, "INR")?.rule).toBe("INR-000");
    expect(findCategorySummary(rows, "ECR-HWA")?.name).toBe("시스템 장비구성 요구사항");
    expect(findCategorySummary(rows.filter((r) => r.rule !== "INR-OOO-000"), "INR-XYZ")?.rule).toBe("INR-000");
    expect(findCategorySummary(rows, "PMR-GEN")).toBeNull();
  });
});

describe("shortCategoryName / categoryLabel", () => {
  it("괄호(영문·코드)와 끝의 '요구사항'을 떼어 탭용 짧은 이름", () => {
    expect(shortCategoryName("클라우드 서비스 요구사항(CSR – MSA)")).toBe("클라우드 서비스");
    expect(shortCategoryName("인프라 상세 요구사항(Infra Detail Requirement)")).toBe("인프라 상세");
    expect(shortCategoryName("프로젝트관리 요구사항 (PMR : Project Management Requirement)")).toBe("프로젝트관리");
    expect(shortCategoryName("제약사항")).toBe("제약사항");
    expect(shortCategoryName("요구사항")).toBe("요구사항");
  });
  it("총괄표 우선, 없으면 행의 구분 셀, 코드와 같으면 null", () => {
    expect(categoryLabel(rows, "ECR-SWA", "시스템 장비구성")).toBe("시스템 장비구성");
    expect(categoryLabel(rows, "CSR-MSA", "클라우드 서비스 요구사항(CSR – MSA)")).toBe("클라우드 서비스");
    expect(categoryLabel([], "SER", "SER")).toBeNull();
    expect(categoryLabel([], "SER", null)).toBeNull();
  });
});

describe("parseCategorySummary", () => {
  it("jsonb 배열만 받아 형식이 맞는 행만 남긴다", () => {
    expect(parseCategorySummary(null)).toEqual([]);
    expect(parseCategorySummary([{ name: "A", rule: "SER-000" }, { rule: "X" }, 3])).toEqual([{ name: "A", nameEn: null, rule: "SER-000", count: null }]);
  });
});
