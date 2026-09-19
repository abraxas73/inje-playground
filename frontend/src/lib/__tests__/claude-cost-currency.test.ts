import { describe, it, expect } from "vitest";
import { centsToKrw, csvSuffix, formatKrw, formatMoney, formatUsdAmount, moneyCsv, parseUsdKrwRate } from "@/lib/claude-cost/currency";

describe("parseUsdKrwRate", () => {
  it("숫자 문자열(천 단위 구분 포함)·숫자를 받고, 비었거나 0 이하·비숫자는 null", () => {
    expect(parseUsdKrwRate("1380")).toBe(1380);
    expect(parseUsdKrwRate("1,380.5")).toBe(1380.5);
    expect(parseUsdKrwRate(1400)).toBe(1400);
    expect(parseUsdKrwRate("")).toBeNull();
    expect(parseUsdKrwRate("0")).toBeNull();
    expect(parseUsdKrwRate("abc")).toBeNull();
    expect(parseUsdKrwRate(undefined)).toBeNull();
  });
});

describe("원화 변환·표시", () => {
  it("센트 × 환율 / 100을 원 단위로 반올림", () => {
    expect(centsToKrw(780338, 1380)).toBe(10768664); // $7,803.38 × 1380 = 10,768,664.4
    expect(centsToKrw(1, 1380)).toBe(14);
    expect(centsToKrw(-497824, 1380)).toBe(-6869971);
  });
  it("formatKrw는 ₩ + 천 단위, 소수 없음", () => {
    expect(formatKrw(10768664)).toBe("₩10,768,664");
    expect(formatKrw(-1234.6)).toBe("-₩1,235");
    expect(formatKrw(0)).toBe("₩0");
  });
  it("formatMoney: KRW+환율이면 원, 아니면(USD 또는 환율 없음) 달러", () => {
    expect(formatMoney(780338, "USD", 1380)).toBe("$7,803.38");
    expect(formatMoney(780338, "KRW", 1380)).toBe("₩10,768,664");
    expect(formatMoney(780338, "KRW", null)).toBe("$7,803.38");
  });
  it("formatUsdAmount는 달러 실수를 센트로 반올림해 같은 규칙", () => {
    expect(formatUsdAmount(21518.82, "KRW", 1380)).toBe("₩29,695,972");
    expect(formatUsdAmount(21518.824, "USD", 1380)).toBe("$21,518.82");
  });
  it("CSV 값·접미", () => {
    expect(moneyCsv(780338, "USD", 1380)).toBe("7803.38");
    expect(moneyCsv(780338, "KRW", 1380)).toBe("10768664");
    expect(moneyCsv(780338, "KRW", null)).toBe("7803.38");
    expect(csvSuffix("KRW", 1380)).toBe("krw");
    expect(csvSuffix("KRW", null)).toBe("usd");
    expect(csvSuffix("USD", 1380)).toBe("usd");
  });
});
