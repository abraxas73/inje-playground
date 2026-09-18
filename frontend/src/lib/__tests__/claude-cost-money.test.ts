import { describe, it, expect } from "vitest";
import { formatCents, lastMonths, monthOf, monthRange, parseEnglishDate, parseMoneyCents, parsePeriod } from "@/lib/claude-cost/money";

describe("parseMoneyCents", () => {
  it("달러 문자열을 센트 정수로 바꾼다(천 단위 구분·음수·US$ 접두)", () => {
    expect(parseMoneyCents("$12,072.22")).toBe(1207222);
    expect(parseMoneyCents("-$4,978.24")).toBe(-497824);
    expect(parseMoneyCents("US$7,803.38")).toBe(780338);
    expect(parseMoneyCents("$0.00")).toBe(0);
  });
  it("형식이 다르면 null", () => {
    expect(parseMoneyCents("7,093.98")).toBeNull();
    expect(parseMoneyCents("$12")).toBeNull();
    expect(parseMoneyCents("97")).toBeNull();
  });
});

describe("formatCents", () => {
  it("센트 → $1,234.56, 음수·반올림 포함", () => {
    expect(formatCents(1207222)).toBe("$12,072.22");
    expect(formatCents(-497824)).toBe("-$4,978.24");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123.78912)).toBe("$1.24");
  });
});

describe("parseEnglishDate", () => {
  it("영문 월 이름 날짜", () => {
    expect(parseEnglishDate("August 23, 2026")).toBe("2026-08-23");
    expect(parseEnglishDate("Sep 1, 2026")).toBe("2026-09-01");
    expect(parseEnglishDate("2026-08-23")).toBeNull();
  });
});

describe("parsePeriod", () => {
  it("연도가 뒤에 하나만 있으면 앞 날짜도 그 연도", () => {
    expect(parsePeriod("Aug 23–Sep 23, 2026")).toEqual({ start: "2026-08-23", end: "2026-09-23" });
    expect(parsePeriod("Aug 23 - Sep 23, 2026")).toEqual({ start: "2026-08-23", end: "2026-09-23" });
    expect(parsePeriod("Aug 23 Sep 23, 2026")).toEqual({ start: "2026-08-23", end: "2026-09-23" }); // 대시가 NUL로 사라진 경우
  });
  it("연말을 걸치면 앞 날짜 연도를 하나 뺀다", () => {
    expect(parsePeriod("Dec 23–Jan 23, 2027")).toEqual({ start: "2026-12-23", end: "2027-01-23" });
  });
  it("양쪽에 연도가 있으면 그대로", () => {
    expect(parsePeriod("Dec 23, 2026–Jan 23, 2027")).toEqual({ start: "2026-12-23", end: "2027-01-23" });
  });
  it("기간이 아니면 null", () => {
    expect(parsePeriod("Remaining time on 97 × Team plan - Premium after 24 Aug 2026")).toBeNull();
    expect(parsePeriod("Aug 23–Sep 23")).toBeNull();
  });
});

describe("월 유틸", () => {
  it("monthOf·monthRange", () => {
    expect(monthOf("2026-08-23")).toBe("2026-08");
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("lastMonths는 KST 이번 달을 포함해 오래된 → 최신 순", () => {
    // 2026-09-30 23:30 UTC = 2026-10-01 08:30 KST → 10월이 이번 달
    expect(lastMonths(3, new Date("2026-09-30T23:30:00Z"))).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(lastMonths(1, new Date("2026-01-15T00:00:00Z"))).toEqual(["2026-01"]);
  });
});
