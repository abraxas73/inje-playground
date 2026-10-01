import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { RULES_TEXT, catalogText, fixMessages, generateMessages, regenerateMessages, systemBlocks } from "@/lib/ppt/prompt";
import type { PptCatalog } from "@/lib/ppt/service";
import type { DeckJson } from "@/lib/ppt/deck-json";

const catalog: PptCatalog = {
  layouts: [
    { name: "card-4", slide: 28, arity: 4, desc: "카드 4장 + 마무리 바", use: "서로 독립한 4가지", closing: { required: true, maxLines: 2 }, chips: null, required: [], example: { layout: "card-4", title: ["…", "…"], cards: [{ title: "…", body: ["…"] }], closing: "…" }, capacity: { title: [9, 2], body: [17, 4], closing: [47, 3] } },
    { name: "pill-4", slide: 52, arity: 4, desc: "Pill 4", use: "항목마다 결론", closing: null, chips: 2, required: [], example: { layout: "pill-4", items: [] } },
    { name: "table-note", slide: 92, arity: null, desc: "표 + 설명", use: "표 아래 주석", closing: null, chips: null, required: [], example: { layout: "table-note", tables: [] }, capacity: { note_title: [20, 1] }, table: { widthCm: 27, heightCm: 7.1, rowsOneLine: 6, rowsTwoLine: 4, charsPerLine: 95 } },
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
    expect(t).toContain("용량: note_title 20/1 · 표 자리 높이 7.1cm = 머리글 + 한 줄 행 6개(두 줄 행 4개), 폭 27cm ≈ 한 줄 95자(열 합계, 8pt)");
  });
  it("rules carry the table row budget and the slides split protocol", () => {
    for (const s of ["표 자리", "두 줄 행", '{"slides":[', "한 줄이 원칙", "표 셀(tables)에는 쓰지 않는다"]) expect(RULES_TEXT).toContain(s);
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
    // 같은 장표가 다시 넘치면 지시를 올린다: 행·항목 수, 장표 교체, 장 분리
    const tableDeck: DeckJson = { meta: { title: ["a", "b."] }, sections: [{ name: "s", slides: [{ layout: "table-note", tables: [] }] }] };
    const err = { ok: false as const, kind: "overflow" as const, message: "[table-note] 표가 7.4cm 로 자리(7.1cm)를 넘친다 — 행을 나누어", section: 0, slide: 0 };
    const first = text(fixMessages({ prior, deck: tableDeck, error: err, catalog })[2]);
    expect(first).toContain("표 자리 높이 7.1cm = 머리글 + 한 줄 행 6개");
    expect(first).not.toContain("이미");
    const third = text(fixMessages({ prior, deck: tableDeck, error: err, catalog, history: ["표가 8.9cm 로 자리(7.1cm)를 넘친다", "표가 8.7cm 로 자리(7.1cm)를 넘친다"] })[2]);
    expect(third).toContain("이미 2회 고쳤지만 다시 넘쳤다(표가 8.9cm 로 자리(7.1cm)를 넘친다 → 표가 8.7cm 로 자리(7.1cm)를 넘친다)");
    expect(third).toContain('{"slides":[');
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
