import { describe, expect, it } from "vitest";
import { rankMatch } from "@/components/shared/SearchableSelect";

describe("rankMatch (콤보박스 검색 순위)", () => {
  it("전치 일치 2 > 부분 일치 1 > 불일치 0, 대소문자 무시", () => {
    expect(rankMatch("team:UI.UX디자인팀", "ui", ["UI.UX디자인팀"])).toBe(2);
    expect(rankMatch("team:UI.UX디자인팀", "디자인", ["UI.UX디자인팀"])).toBe(1);
    expect(rankMatch("team:UI.UX디자인팀", "플랫폼", ["UI.UX디자인팀"])).toBe(0);
  });
  it("빈 검색어는 전부 표시, 내부 값(value)은 비교하지 않는다", () => {
    expect(rankMatch("hq:R&D본부", "", ["R&D본부"])).toBe(1);
    expect(rankMatch("team:x", "team", ["팀이름"])).toBe(0);
  });
});
