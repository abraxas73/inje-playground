import { describe, expect, it } from "vitest";
import { storyboard } from "@/lib/ppt/storyboard";
import type { DeckJson } from "@/lib/ppt/deck-json";

const deck: DeckJson = {
  meta: { title: ["a", "b."] },
  sections: [{
    name: "개요", subs: ["현황"], slides: [
      { layout: "card-4", sub: "현황", title: ["네 가지로 보는", "현황입니다."], cards: [{ num: "01", title: "속도", body: ["느림", "수작업"] }, { title: "비용", body: "서술형 문장." }], closing: "결론입니다." },
      { layout: "table", title: ["표", "입니다."], tables: [{ header: ["구분", "값"], rows: [["A", "1"], ["B", "2"]] }], closing: "표 결론." },
      { layout: "message", headline: "핵심 한 줄", detail: "부연" },
      { layout: "chart-donut", title: ["비율", "입니다."], chart: { categories: ["x", "y"], values: [60, 40] }, summary: "요약." },
      { keep: true },
    ],
  }],
};

describe("storyboard", () => {
  it("maps slides into title, groups and footer generically", () => {
    const [sec] = storyboard(deck);
    expect(sec.name).toBe("개요");
    expect(sec.subs).toEqual(["현황"]);
    const [card, table, message, donut, keep] = sec.slides;
    expect(card.layout).toBe("card-4");
    expect(card.title).toEqual(["네 가지로 보는", "현황입니다."]);
    expect(card.groups[0].label).toBe("cards");
    expect(card.groups[0].items[0]).toEqual({ title: "01 속도", body: ["느림", "수작업"] });
    expect(card.groups[0].items[1]).toEqual({ title: "비용", body: ["서술형 문장."] });
    expect(card.footer).toEqual(["결론입니다."]);
    expect(table.groups[0].items[0].body).toEqual(["구분 | 값", "A | 1", "B | 2"]);
    expect(message.title).toEqual(["핵심 한 줄"]);
    expect(message.footer).toEqual(["부연"]);
    expect(donut.groups[0].items[0].body).toEqual(["x: 60", "y: 40"]);
    expect(donut.footer).toEqual(["요약."]);
    expect(keep.layout).toBe("(이전 버전 유지)");
  });
});
