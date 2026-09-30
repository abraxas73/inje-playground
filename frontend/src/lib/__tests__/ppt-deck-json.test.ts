import { describe, expect, it } from "vitest";
import { applyKeep, deckTitle, extractJsonObject, parseDeckJson, parseSlidePatch, replaceSlide, safeFileName, todayLabel, DeckParseError, type DeckJson } from "@/lib/ppt/deck-json";

const TODAY = "2026. 09. 30";
const base: DeckJson = {
  meta: { title: ["A", "B."], ver: "01", date: TODAY },
  sections: [
    { name: "s1", slides: [{ layout: "card-3", title: ["x", "y."] }, { layout: "message", headline: "h" }] },
    { name: "s2", slides: [{ layout: "table", title: ["p", "q."] }] },
  ],
};

describe("parseDeckJson", () => {
  it("strips code fences and prose around the JSON", () => {
    const text = "다음은 결과입니다.\n```json\n" + JSON.stringify(base) + "\n```\n끝.";
    expect(extractJsonObject(text)).toBe(JSON.stringify(base));
    expect(parseDeckJson(text, TODAY).sections).toHaveLength(2);
  });
  it("normalizes meta: string title → array, numeric ver → string, missing/ISO date → YYYY. MM. DD", () => {
    const d = parseDeckJson(JSON.stringify({ meta: { title: "한 줄 제목입니다.", ver: 1 }, sections: base.sections }), TODAY);
    expect(d.meta.title).toEqual(["한 줄 제목입니다."]);
    expect(d.meta.ver).toBe("01");
    expect(d.meta.date).toBe(TODAY);
    const iso = parseDeckJson(JSON.stringify({ meta: { title: ["a"], date: "2026-10-01" }, sections: base.sections }), TODAY);
    expect(iso.meta.date).toBe("2026. 10. 01");
  });
  it("rejects non-JSON, 0 sections and 9 sections", () => {
    expect(() => parseDeckJson("no json here", TODAY)).toThrow(DeckParseError);
    expect(() => parseDeckJson(JSON.stringify({ meta: { title: ["a"] }, sections: [] }), TODAY)).toThrow(DeckParseError);
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, slides: [{ layout: "card-3" }] }));
    expect(() => parseDeckJson(JSON.stringify({ meta: { title: ["a"] }, sections: nine }), TODAY)).toThrow(DeckParseError);
  });
});

describe("keep / replace", () => {
  it("fills keep slides from the base at the same position", () => {
    const next: DeckJson = { ...base, sections: [{ name: "s1", slides: [{ keep: true }, { layout: "message", headline: "new" }] }, { name: "s2", slides: [{ keep: true }] }] };
    const r = applyKeep(next, base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deck.sections[0].slides[0]).toEqual(base.sections[0].slides[0]);
      expect(r.deck.sections[0].slides[1]).toEqual({ layout: "message", headline: "new" });
      expect(r.deck.sections[1].slides[0]).toEqual(base.sections[1].slides[0]);
    }
  });
  it("fails when a keep points outside the base", () => {
    const next: DeckJson = { ...base, sections: [{ name: "only", slides: [{ keep: true }, { keep: true }, { keep: true }] }] };
    const r = applyKeep(next, base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("섹션 1 장표 3");
  });
  it("replaceSlide is immutable and range-checked", () => {
    const d = replaceSlide(base, 1, 0, { layout: "card-4" });
    expect(d.sections[1].slides[0]).toEqual({ layout: "card-4" });
    expect(base.sections[1].slides[0]).toEqual({ layout: "table", title: ["p", "q."] });
    expect(() => replaceSlide(base, 5, 0, { layout: "x" })).toThrow(RangeError);
  });
  it("parseSlidePatch accepts {slide:{…}} only", () => {
    expect(parseSlidePatch('{"slide":{"layout":"card-3","cards":[]}}')).toEqual({ layout: "card-3", cards: [] });
    expect(() => parseSlidePatch('{"layout":"card-3"}')).toThrow(DeckParseError);
  });
});

describe("helpers", () => {
  it("deckTitle joins lines, safeFileName strips path characters, todayLabel is KST", () => {
    expect(deckTitle(base)).toBe("A B.");
    expect(safeFileName('클라우드/전환: "2026"?')).toBe("클라우드_전환_ _2026__");
    expect(safeFileName("   ")).toBe("deck");
    expect(todayLabel(new Date("2026-09-30T20:00:00Z"))).toBe("2026. 10. 01");
  });
});
