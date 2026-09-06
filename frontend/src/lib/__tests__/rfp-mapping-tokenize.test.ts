import { describe, it, expect } from "vitest";
import { normalizeText, stripJosa, tokenize, charBigrams, STOPWORDS } from "@/lib/rfp/mapping/tokenize";

describe("normalizeText / stripJosa", () => {
  it("NFKC·소문자·앞뒤 공백", () => {
    expect(normalizeText("  ＳＳＯ Login ")).toBe("sso login");
  });
  it("조사를 한 번 떼되 2자 미만이 남으면 그대로", () => {
    expect(stripJosa("사용자의")).toBe("사용자");
    expect(stripJosa("서버에서")).toBe("서버");
    expect(stripJosa("로그인으로")).toBe("로그인");
    expect(stripJosa("회의")).toBe("회의");
    expect(stripJosa("결과")).toBe("결과");
    expect(stripJosa("네트워크")).toBe("네트워크");
  });
});

describe("tokenize", () => {
  it("기호로 나누고 조사·불용어·2자 미만·중복을 없앤다", () => {
    expect(tokenize("사용자의 권한 관리 기능을 제공한다. SSO(통합 인증) 및 SSO")).toEqual(["권한", "sso", "통합", "인증"]);
    expect(STOPWORDS.has("제공한다")).toBe(true);
    expect(STOPWORDS.has("사용자")).toBe(true);
    expect(STOPWORDS.has("관리")).toBe(true);
    expect(tokenize("")).toEqual([]);
  });
  it("영문·숫자는 그대로, 한글·영문이 붙은 토큰은 나누지 않는다", () => {
    expect(tokenize("KVM기반 VM 2대")).toEqual(["kvm기반", "vm", "2대"]);
  });
});

describe("charBigrams", () => {
  it("공백·기호를 뺀 문자열의 인접 2자 집합", () => {
    expect([...charBigrams("멀티 테넌트")]).toEqual(["멀티", "티테", "테넌", "넌트"]);
    expect([...charBigrams("SSO 로그인")]).toEqual(["ss", "so", "o로", "로그", "그인"]);
    expect(charBigrams("a").size).toBe(0);
    expect(charBigrams("").size).toBe(0);
  });
});
