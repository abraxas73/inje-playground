import { describe, expect, it } from "vitest";
import { maskText } from "@/lib/chat/mask";

describe("maskText", () => {
  it("주민번호 — 하이픈 유무, 날짜가 아니면 그대로", () => {
    expect(maskText("주민 900101-1234567 끝")).toEqual({ text: "주민 [주민번호] 끝", count: 1 });
    expect(maskText("주민 9001012234567").text).toBe("주민 [주민번호]");
    expect(maskText("코드 901399-1234567").count).toBe(0);
  });
  it("카드번호 — Luhn이 맞을 때만", () => {
    expect(maskText("카드 4111-1111-1111-1111 결제").text).toBe("카드 [카드번호] 결제");
    expect(maskText("카드 4111 1111 1111 1111").text).toBe("카드 [카드번호]");
    expect(maskText("주문 4111-1111-1111-1112").count).toBe(0);
  });
  it("휴대전화, 조직도 예외(keepPhone)", () => {
    expect(maskText("연락 010-1234-5678").text).toBe("연락 [전화번호]");
    expect(maskText("연락 01012345678").text).toBe("연락 [전화번호]");
    expect(maskText("연락 010-1234-5678", { keepPhone: true })).toEqual({ text: "연락 010-1234-5678", count: 0 });
  });
  it("휴대전화 — 공백·점·국가번호 형식, 주민번호 성별 자리 5~8", () => {
    for (const p of ["010 1234 5678", "010.1234.5678", "+82-10-1234-5678", "+821012345678", "+82 10 1234 5678"]) {
      expect(maskText(`연락 ${p} 끝`)).toEqual({ text: "연락 [전화번호] 끝", count: 1 });
      expect(maskText(`연락 ${p}`, { keepPhone: true })).toEqual({ text: `연락 ${p}`, count: 0 });
    }
    expect(maskText("외국인 900101-5123456").text).toBe("외국인 [주민번호]");
    expect(maskText("외국인 900101-8123456").text).toBe("외국인 [주민번호]");
    expect(maskText("코드 900101-9123456").count).toBe(0);
  });
  it("계좌번호 — 하이픈 형식, 숫자 10~14자리", () => {
    expect(maskText("계좌 110-123-456789 입금").text).toBe("계좌 [계좌번호] 입금");
    expect(maskText("계좌 1002-345-678901").text).toBe("계좌 [계좌번호]");
    expect(maskText("계좌 110123456789").count).toBe(0);
  });
  it("오탐 없음 — 날짜·회사 전화·사업자번호·금액·시각", () => {
    const s = "2026-10-15 14:00 회의, 대표 02-1234-5678, 031-123-4567, 사업자 123-45-67890, 1,234,567원";
    expect(maskText(s)).toEqual({ text: s, count: 0 });
  });
  it("여러 건을 센다", () => {
    expect(maskText("010-1111-2222, 900101-1234567, 110-123-456789").count).toBe(3);
  });
});
