import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateDeck, GenerationError } from "@/lib/ppt/generate";
import type { DeckLlm, LlmReply } from "@/lib/ppt/llm";
import type { PptBuildResult, PptCatalog, PptServiceClient } from "@/lib/ppt/service";
import type { DeckJson } from "@/lib/ppt/deck-json";

const catalog: PptCatalog = { layouts: [], message: { name: "message", slide: 26, arity: null, desc: "", use: "", closing: null, chips: null, required: [], example: {} }, products: [], overview: [], productExample: [], templateSlides: 106, package: "v3.1" };
const deck: DeckJson = { meta: { title: ["a", "b."], ver: "01", date: "2026. 09. 30" }, sections: [{ name: "s", slides: [{ layout: "card-4", cards: [] }] }] };
const usage = { in: 100, out: 50, cacheRead: 0, cacheWrite: 0 };
const reply = (text: string): LlmReply => ({ text, usage, stopReason: "end_turn" });

function llmOf(replies: string[]): DeckLlm & { calls: Anthropic.MessageParam[][] } {
  const calls: Anthropic.MessageParam[][] = [];
  return { model: "test", calls, async complete(_s, m) { calls.push(m); const t = replies.shift(); if (t === undefined) throw new Error("no more replies"); return reply(t); } };
}
function serviceOf(results: PptBuildResult[]): PptServiceClient & { built: unknown[] } {
  const built: unknown[] = [];
  return { built, async catalog() { return catalog; }, async extract() { return []; }, async build(req) { built.push(req.spec); const r = results.shift(); if (!r) throw new Error("no more results"); return r; } };
}
const ok: PptBuildResult = { ok: true, slides: 5, advisories: ["권고1"], issues: {}, bytes: 100 };
const uploads = vi.fn(async () => ({ pptxUrl: "https://s/p", yamlUrl: "https://s/y" }));
const base = { source: { kind: "text" as const, text: "원고" }, prompt: "", today: "2026. 09. 30", uploads };

describe("generateDeck", () => {
  it("happy path: one LLM call, one build", async () => {
    const llm = llmOf([JSON.stringify(deck)]);
    const svc = serviceOf([ok]);
    const out = await generateDeck(base, { llm, service: svc });
    expect(out.deck.meta.title).toEqual(["a", "b."]);
    expect(out.build.slides).toBe(5);
    expect(out.calls).toBe(1);
    expect(out.usage).toEqual(usage);
  });
  it("retries once when the reply is not JSON", async () => {
    const llm = llmOf(["죄송합니다, 여기 있습니다:", JSON.stringify(deck)]);
    const out = await generateDeck(base, { llm, service: serviceOf([ok]) });
    expect(out.calls).toBe(2);
    expect(llm.calls[1]).toHaveLength(3);
  });
  it("fixes only the failing slide on a spec error, then succeeds", async () => {
    const fixed = { layout: "card-3", cards: [] };
    const llm = llmOf([JSON.stringify(deck), JSON.stringify({ slide: fixed })]);
    const svc = serviceOf([{ ok: false, kind: "spec", message: "card-4는 4개", section: 0, slide: 0 }, ok]);
    const out = await generateDeck(base, { llm, service: svc });
    expect(out.deck.sections[0].slides[0]).toEqual(fixed);
    expect(svc.built).toHaveLength(2);
    expect(out.calls).toBe(2);
  });
  it("accepts a whole deck as the reply to a positioned fix round", async () => {
    const fixedDeck = { ...deck, meta: { ...deck.meta, title: ["x", "y."] } };
    const llm = llmOf([JSON.stringify(deck), JSON.stringify(fixedDeck)]);
    const svc = serviceOf([{ ok: false, kind: "spec", message: "card-4는 4개", section: 0, slide: 0 }, ok]);
    const out = await generateDeck(base, { llm, service: svc });
    expect(out.deck.meta.title).toEqual(["x", "y."]);
    expect(out.calls).toBe(2);
  });
  it("gives up after 4 fix rounds with the package message and the last deck", async () => {
    const fixes = ["x", "y", "z", "w"].map((l) => JSON.stringify({ slide: { layout: l } }));
    const llm = llmOf([JSON.stringify(deck), ...fixes]);
    const fail: PptBuildResult = { ok: false, kind: "overflow", message: "'body' 슬롯이 넘친다", section: 0, slide: 0 };
    const svc = serviceOf([fail, fail, fail, fail, fail]);
    const err = await generateDeck(base, { llm, service: svc }).catch((e: GenerationError) => e);
    expect(err).toMatchObject({ message: "'body' 슬롯이 넘친다", calls: 5 } satisfies Partial<GenerationError>);
    expect(svc.built).toHaveLength(5);
    expect(err.deck?.sections[0].slides[0]).toEqual({ layout: "w" }); // 마지막으로 빌드한 덱이 실패 행에 남는다
  });
  it("regeneration: applies keep, falls back to a full request when keep does not fit", async () => {
    const next = { ...deck, sections: [{ name: "s", slides: [{ keep: true }] }] };
    const llm = llmOf([JSON.stringify(next)]);
    const out = await generateDeck({ ...base, baseDeck: deck, feedback: "제목만" }, { llm, service: serviceOf([ok]) });
    expect(out.deck.sections[0].slides[0]).toEqual(deck.sections[0].slides[0]);
    const bad = { ...deck, sections: [{ name: "s", slides: [{ keep: true }, { keep: true }] }] };
    const llm2 = llmOf([JSON.stringify(bad), JSON.stringify(deck)]);
    const out2 = await generateDeck({ ...base, baseDeck: deck, feedback: "장 추가" }, { llm: llm2, service: serviceOf([ok]) });
    expect(out2.calls).toBe(2);
    expect(llm2.calls[1].at(-1)?.content).toContain("keep을 쓰지 말고");
  });
  it("regeneration retries once when the first reply is not JSON", async () => {
    const llm = llmOf(["설명입니다", JSON.stringify(deck)]);
    const out = await generateDeck({ ...base, baseDeck: deck, feedback: "제목만" }, { llm, service: serviceOf([ok]) });
    expect(out.calls).toBe(2);
  });
  it("calls onBuild exactly once, even when a fix round happens", async () => {
    const onBuild = vi.fn(async () => {});
    const llm = llmOf([JSON.stringify(deck), JSON.stringify({ slide: { layout: "card-3", cards: [] } })]);
    const svc = serviceOf([{ ok: false, kind: "spec", message: "x", section: 0, slide: 0 }, ok]);
    await generateDeck({ ...base, onBuild }, { llm, service: svc });
    expect(svc.built).toHaveLength(2);
    expect(onBuild).toHaveBeenCalledTimes(1);
  });
  it("wraps a service outage into GenerationError with usage so far", async () => {
    const llm = llmOf([JSON.stringify(deck)]);
    const svc: PptServiceClient = { async catalog() { return catalog; }, async extract() { return []; }, async build() { throw new Error("PPT 서비스에 연결할 수 없습니다(TimeoutError)."); } };
    await expect(generateDeck(base, { llm, service: svc })).rejects.toMatchObject({ message: "PPT 서비스에 연결할 수 없습니다(TimeoutError).", calls: 1, usage });
  });
});
