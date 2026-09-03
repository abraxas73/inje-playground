import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractOverview, normalizeName, nameCore, normalizeAgency } from "@/lib/rfp/overview";
import { parseHwp } from "@/lib/rfp/parse-hwp";
import type { DocumentModel, Table } from "@/lib/rfp/document-model";

const p = (text: string) => ({ type: "paragraph" as const, text });

describe("extractOverview — 라벨 문단", () => {
  const doc: DocumentModel = { format: "hwp", blocks: [
    p("1. 일반사항"),
    p(" □ 사업명 : 생성형 AI 플랫폼 구축 및 AX 개발 사업"),
    p(" □ 사업기간 : 계약체결일로부터 12개월"),
    p(" □ 설계금액 : 13,225,835,150원 (VAT 포함)"),
    p(" □ 입찰 및 계약 방법"),
    p("  ◦ 일반경쟁입찰(협상에 의한 계약체결기준) / 차등점수제 적용"),
    p("    - ｢국가종합전자조달시스템 입찰참가자격 등록 규정｣에 따라 …"),
    p(" □ 한국석유공사(이하 “공사”)의 전사적 성과를 창출하고, 에너지 산업의 미래 가치 창출을 위한 공사 특화형 AI 도입 필요"),
  ] };
  const o = extractOverview(doc);
  it("사업명·기간·금액", () => {
    expect(o.name).toBe("생성형 AI 플랫폼 구축 및 AX 개발 사업");
    expect(o.period).toBe("계약체결일로부터 12개월");
    expect(o.budget).toBe("13,225,835,150원 (VAT 포함)");
  });
  it("값이 없는 라벨은 다음 문단을 값으로", () => {
    expect(o.bidMethod).toBe("일반경쟁입찰(협상에 의한 계약체결기준) / 차등점수제 적용");
  });
  it("발주기관은 '(이하' 패턴 폴백", () => {
    expect(o.agency).toBe("한국석유공사");
  });
});

describe("extractOverview — 라벨 표와 표지 인용", () => {
  const labelTable: Table = { type: "table", rows: 2, cols: 2, cells: [
    { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "발주기관", tables: [] },
    { row: 0, col: 1, rowSpan: 1, colSpan: 1, text: "한국석유공사(KNOC)", tables: [] },
    { row: 1, col: 0, rowSpan: 1, colSpan: 1, text: "사업 기간", tables: [] },
    { row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "12개월", tables: [] },
  ] };
  const cover: Table = { type: "table", rows: 1, cols: 1, cells: [
    { row: 0, col: 0, rowSpan: 1, colSpan: 1, text: "｢ 생성형 AI 플랫폼 구축 및 AX 개발 사업 ｣\n제 안 요 청 서", tables: [] },
  ] };
  it("2열 표의 왼쪽 라벨 → 오른쪽 값", () => {
    const o = extractOverview({ format: "docx", blocks: [labelTable] });
    expect(o.agency).toBe("한국석유공사(KNOC)");
    expect(o.period).toBe("12개월");
    expect(o.name).toBeNull();
  });
  it("사업명이 없으면 앞쪽 블록의 「…」 인용을 쓴다", () => {
    const o = extractOverview({ format: "hwp", blocks: [cover, p("본문")] });
    expect(o.name).toBe("생성형 AI 플랫폼 구축 및 AX 개발 사업");
  });
  it("아무것도 없으면 전부 null", () => {
    expect(extractOverview({ format: "hwp", blocks: [p("그냥 문장")] })).toEqual({ name: null, agency: null, period: null, budget: null, bidMethod: null, extra: {} });
  });
});

describe("extractOverview — 샘플 HWP", () => {
  const here = import.meta.url; // Vite의 new URL(리터럴, import.meta.url) 특수 처리 우회
  const sample = readFileSync(fileURLToPath(new URL("./fixtures/rfp/sample.hwp", here)));
  it("샘플에서 개요 5항목이 나온다", () => {
    const o = extractOverview(parseHwp(sample));
    expect(o.name).toBe("생성형 AI 플랫폼 구축 및 AX 개발 사업");
    expect(o.agency).toBe("한국석유공사");
    expect(o.period).toBe("계약체결일로부터 12개월");
    expect(o.budget).toBe("13,225,835,150원 (VAT 포함)");
    expect(o.bidMethod).toContain("일반경쟁입찰");
  });
});

describe("정규화", () => {
  it("normalizeName: 소문자·공백·기호 제거(괄호는 문자만 제거하고 내용은 남긴다)", () => {
    expect(normalizeName("생성형 AI 플랫폼 구축 및 AX 개발 사업 (재공고)")).toBe("생성형ai플랫폼구축및ax개발사업재공고");
    expect(normalizeName("「차세대 e-Learning」 사업")).toBe("차세대elearning사업");
  });
  it("normalizeName: 괄호 안 내용이 다르면 다른 사업으로 남는다(1단계/2단계)", () => {
    expect(normalizeName("정보시스템 구축 (1단계)")).not.toBe(normalizeName("정보시스템 구축 (2단계)"));
  });
  it("nameCore: 재공고·긴급·차수 같은 접미 단어를 뗀다(괄호 안이어도)", () => {
    expect(nameCore("생성형 AI 플랫폼 구축 사업 재공고")).toBe(nameCore("생성형 AI 플랫폼 구축 사업"));
    expect(nameCore("생성형 AI 플랫폼 구축 사업 (재공고)")).toBe(nameCore("생성형 AI 플랫폼 구축 사업"));
    expect(nameCore("정보시스템 구축 2차 긴급")).toBe("정보시스템구축");
  });
  it("normalizeAgency: 약칭·(이하 …)·법인 표기 제거", () => {
    expect(normalizeAgency("한국석유공사(KNOC)")).toBe("한국석유공사");
    expect(normalizeAgency("한국석유공사 (이하 “공사”)")).toBe("한국석유공사");
    expect(normalizeAgency("(주) 이노그리드")).toBe("이노그리드");
  });
});
