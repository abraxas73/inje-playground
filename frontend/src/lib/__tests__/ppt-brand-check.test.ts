import { describe, expect, it } from "vitest";
import { brandCheckItems } from "@/lib/ppt/brand-check";

describe("brandCheckItems", () => {
  it("lists every fixed item with empty issues when the check passed", () => {
    const items = brandCheckItems({});
    expect(items.map((i) => i.label)).toEqual(["색상", "글꼴", "굵게", "글자 크기", "줄간격", "잔여 문구"]);
    expect(items.every((i) => i.issues.length === 0)).toBe(true);
  });
  it("routes check.py messages to their item, keeps the slide key, and parks unknown ones under 기타", () => {
    const items = brandCheckItems({
      "slide 7": ["팔레트 밖 색 #FF0000", "Pretendard 아닌 폰트 'Arial'", '굵게(b="1") 사용 — 굵기는 폰트 이름으로 (가이드 p.4)'],
      "slide 9": ["허용 밖 글자 크기 6.5pt", "줄간격 150% (템플릿에 없는 값)", "템플릿 잔여 문구 '항목 제목 1' — 슬롯을 안 채웠다", "제품 지정색 #00AA00은 제품 소개 장표에만 허용 (가이드 p.3)", "이상한 지적"],
    });
    const by = Object.fromEntries(items.map((i) => [i.label, i.issues]));
    expect(by["색상"]).toEqual(["slide 7: 팔레트 밖 색 #FF0000", "slide 9: 제품 지정색 #00AA00은 제품 소개 장표에만 허용 (가이드 p.3)"]);
    expect(by["글꼴"]).toEqual(["slide 7: Pretendard 아닌 폰트 'Arial'"]);
    expect(by["굵게"]).toHaveLength(1);
    expect(by["글자 크기"]).toEqual(["slide 9: 허용 밖 글자 크기 6.5pt"]);
    expect(by["줄간격"]).toHaveLength(1);
    expect(by["잔여 문구"]).toHaveLength(1);
    expect(by["기타"]).toEqual(["slide 9: 이상한 지적"]);
  });
});
