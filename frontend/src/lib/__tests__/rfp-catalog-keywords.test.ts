import { describe, it, expect } from "vitest";
import { seedKeywords, parseKeywordInput, KEYWORDS_MAX, KEYWORD_MAX_LEN, DESCRIPTION_SEED_MAX } from "@/lib/rfp/catalog/keywords";

describe("seedKeywords", () => {
  it("이름 토큰 전부 → 설명 토큰 앞 10개(중복 제외) → extra, 순서 유지", () => {
    expect(seedKeywords("SSO 로그인", "통합 인증으로 한 번 로그인", ["SSO", "Single Sign-On"])).toEqual(["sso", "로그인", "통합", "인증", "single sign-on"]);
  });
  it("설명 토큰은 10개까지, 전체 20개 상한, 30자 초과 항목 제거", () => {
    const desc = Array.from({ length: 15 }, (_, i) => `단어${String(i).padStart(2, "0")}`).join(" ");
    const seeded = seedKeywords("이름", desc);
    expect(seeded).toHaveLength(1 + DESCRIPTION_SEED_MAX);
    const extra = Array.from({ length: 30 }, (_, i) => `추가${i}`);
    expect(seedKeywords("이름", desc, extra)).toHaveLength(KEYWORDS_MAX);
    expect(seedKeywords("이름", "", ["가".repeat(KEYWORD_MAX_LEN + 1)])).toEqual(["이름"]);
  });
  it("이름·설명이 불용어만이면 빈 배열", () => {
    expect(seedKeywords("기능 관리", "제공 및 지원")).toEqual([]);
  });
});

describe("parseKeywordInput", () => {
  it("쉼표·전각 쉼표·줄바꿈으로 나누고 정규화·중복 제거", () => {
    expect(parseKeywordInput("SSO, 로그인、통합 인증\nsso ,  x , 가")).toEqual(["sso", "로그인", "통합 인증"]);
  });
  it("20개 상한", () => {
    expect(parseKeywordInput(Array.from({ length: 25 }, (_, i) => `k${i}`).join(","))).toHaveLength(KEYWORDS_MAX);
  });
});
