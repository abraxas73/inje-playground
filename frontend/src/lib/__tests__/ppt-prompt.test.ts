import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { RULES_TEXT, catalogText, fixMessages, generateMessages, regenerateMessages, systemBlocks } from "@/lib/ppt/prompt";
import type { PptCatalog } from "@/lib/ppt/service";
import type { DeckJson } from "@/lib/ppt/deck-json";

const catalog: PptCatalog = {
  layouts: [
    { name: "card-4", slide: 28, arity: 4, desc: "카드 4장 + 마무리 바", use: "서로 독립한 4가지", closing: { required: true, maxLines: 2 }, chips: null, required: [], example: { layout: "card-4", title: ["…", "…"], cards: [{ title: "…", body: ["…"] }], closing: "…" }, capacity: { title: [9, 2], body: [17, 4], closing: [47, 3] } },
    { name: "pill-4", slide: 52, arity: 4, desc: "Pill 4", use: "항목마다 결론", closing: null, chips: 2, required: [], example: { layout: "pill-4", items: [] } },
  ],
  message: { name: "message", slide: 26, arity: null, desc: "핵심 메시지", use: "한 문장", closing: null, chips: null, required: ["headline"], example: { layout: "message", headline: "…", detail: "…" } },
  products: ["openstackit"], overview: ["tafa"], productExample: [{ layout: "product", product: "openstackit" }], templateSlides: 106, package: "v3.1",
  capacityCommon: { page_title: [47, 2], section_label: [20, 1] },
};
const deck: DeckJson = { meta: { title: ["a", "b."] }, sections: [{ name: "s", slides: [{ layout: "card-4" }] }] };
const text = (m: Anthropic.MessageParam) => (typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "text" ? b.text : "")).join("\n"));

describe("prompt", () => {
  it("rules mention the load-bearing constraints", () => {
    for (const s of ["~합니다.", "마침표", "closing", "keep", "JSON", "[[", "표는", "5개", "8개", "용량", "0.55", "90%"]) expect(RULES_TEXT).toContain(s);
  });
  it("catalog text lists every layout with arity, closing rule and example, plus message and products", () => {
    const t = catalogText(catalog);
    expect(t).toContain("card-4 (slide 28, 항목 4개, 마무리 문구 필수·2줄까지)");
    expect(t).toContain("pill-4 (slide 52, 항목 4개, 키워드 칩 2개)");
    expect(t).toContain('{"layout":"card-4"');
    expect(t).toContain("message");
    expect(t).toContain("openstackit");
    expect(t).toContain("용량: title 9/2 · body 17/4 · closing 47/3");
    expect(t).toContain("page_title 47/2 · section_label 20/1");
    expect(t).not.toContain("용량: \n"); // pill-4는 용량 없음 → 줄 자체를 생략
  });
  it("system blocks are two cached text blocks", () => {
    const b = systemBlocks(catalog);
    expect(b).toHaveLength(2);
    expect(b.every((x) => x.cache_control?.type === "ephemeral")).toBe(true);
    expect(b[0].text).toBe(RULES_TEXT);
  });
  it("generate messages: cached source block + instruction with hints and today", () => {
    const m = generateMessages({ source: { kind: "text", text: "원고 본문" }, prompt: "12장 이내", title: "제안", dept: "R&D본부", today: "2026. 09. 30" });
    expect(m).toHaveLength(1);
    const blocks = m[0].content as Anthropic.TextBlockParam[];
    expect(blocks[0].cache_control?.type).toBe("ephemeral");
    expect(blocks[0].text).toContain("원고 본문");
    expect(blocks[1].text).toContain("12장 이내");
    expect(blocks[1].text).toContain("제안");
    expect(blocks[1].text).toContain("R&D본부");
    expect(blocks[1].text).toContain("2026. 09. 30");
  });
  it("fix messages ask for one slide when the error has a position, the whole deck otherwise", () => {
    const prior = generateMessages({ source: { kind: "text", text: "x" }, prompt: "", today: "2026. 09. 30" });
    const one = fixMessages({ prior, deck, error: { ok: false, kind: "spec", message: "'card-4'는 항목 4개 고정인데 3개가 왔다.", section: 0, slide: 0 }, catalog });
    expect(one).toHaveLength(3);
    expect(one[1].role).toBe("assistant");
    expect(text(one[2])).toContain("섹션 1 장표 1(card-4)");
    expect(text(one[2])).toContain('{"slide":');
    // 넘침 수정에 필요한 그 장표의 용량표 — 카드 제목 title과 장표 타이틀 page_title을 구분해 준다
    expect(text(one[2])).toContain("이 장표의 용량(역할 줄당글자/줄수): title 9/2 · body 17/4 · closing 47/3 · page_title 47/2 · section_label 20/1");
    expect(text(one[2])).toContain("모든 문자열을 용량의 90% 안으로");
    // 카탈로그 없이(구버전 서비스) 호출해도 용량 줄만 빠진다
    expect(text(fixMessages({ prior, deck, error: { ok: false, kind: "overflow", message: "x", section: 0, slide: 0 } })[2])).not.toContain("이 장표의 용량");
    const whole = fixMessages({ prior, deck, error: { ok: false, kind: "spec", message: "섹션은 최대 8개다", section: null, slide: null } });
    expect(text(whole[2])).toContain("덱 전체");
    expect(text(whole[2])).not.toContain('{"slide":');
  });
  it("regenerate messages carry the base deck and the keep rule (or forbid keep)", () => {
    const withKeep = regenerateMessages({ source: { kind: "text", text: "x" }, baseDeck: deck, feedback: "3장을 표로", today: "2026. 09. 30", withKeep: true });
    expect(withKeep[1].role).toBe("assistant");
    expect(text(withKeep[2])).toContain('{"keep": true}');
    const noKeep = regenerateMessages({ source: { kind: "text", text: "x" }, baseDeck: deck, feedback: "3장을 표로", today: "2026. 09. 30", withKeep: false });
    expect(text(noKeep[2])).toContain("keep을 쓰지 말고");
  });
});
