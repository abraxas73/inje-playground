import { describe, expect, it } from "vitest";
import {
  cleanName, inventedNumbers, isOwnUploadPath, latestProfile, parseReflowSpec, resultFileName, uploadExtension,
  type OutlineSlide, type TemplateInfo,
} from "@/lib/proposal/core";
import { planReflow } from "@/lib/proposal/run";
import type { DeckLlm } from "@/lib/ppt/llm";

const id = "123e4567-e89b-12d3-a456-426614174000";
const profile: OutlineSlide[] = [
  { no: 1, title: "회사 개요", texts: ["설립 2007년", "임직원 312명"], tables: [], images: [] },
  { no: 2, title: "주요 실적", texts: [], tables: [[["연도", "금액"], ["2025", "1,200억"]]], images: [{ id: "s2-1", w: 8, h: 4 }] },
];
const template: TemplateInfo = { widthCm: 33.87, heightCm: 19.05, layouts: [{ index: 0, name: "Title", placeholders: [] }, { index: 1, name: "Title and Content", placeholders: [] }] };

describe("제안도우미-일반현황 core", () => {
  it("업로드 확장자·경로: 일반현황은 pptx만, 템플릿은 pptx·potx, 경로는 우리가 발급한 모양만", () => {
    expect(uploadExtension("a.PPTX", "profile")).toBe("pptx");
    expect(uploadExtension("a.potx", "profile")).toBeNull();
    expect(uploadExtension("a.potx", "template")).toBe("potx");
    expect(uploadExtension("a.pptm", "template")).toBeNull();
    expect(isOwnUploadPath(`proposal/templates/${id}.potx`, "template")).toBe(true);
    expect(isOwnUploadPath(`proposal/profiles/${id}.pptx`, "template")).toBe(false);
    expect(isOwnUploadPath(`proposal/templates/../profiles/${id}.pptx`, "template")).toBe(false);
    expect(isOwnUploadPath(`decks/${id}.pptx`, "profile")).toBe(false);
  });
  it("프로젝트명은 1~100자, 제어 문자 제거 / 다운로드 이름은 파일 이름에 못 쓰는 글자를 _로", () => {
    expect(cleanName("  ○○공사\n차세대  ")).toBe("○○공사 차세대");
    expect(cleanName("")).toBeNull();
    expect(cleanName("x".repeat(101))).toBeNull();
    expect(resultFileName('A/B: "C"')).toBe("A_B_ _C__일반현황.pptx");
  });
  it("최신 일반현황 = 숨기지 않은 것 중 가장 나중", () => {
    const rows = [
      { id: "a", hidden: false, created_at: "2026-10-01T00:00:00Z" },
      { id: "b", hidden: true, created_at: "2026-10-20T00:00:00Z" },
      { id: "c", hidden: false, created_at: "2026-10-10T00:00:00Z" },
    ];
    expect(latestProfile(rows)?.id).toBe("c");
    expect(latestProfile([{ id: "x", hidden: true, created_at: "2026-10-01T00:00:00Z" }])).toBeNull();
  });
  it("배치표 파싱: 범위 밖 레이아웃·없는 그림 id는 거르거나 거절", () => {
    const ok = parseReflowSpec('설명 {"slides":[{"layout":1,"title":"주요 실적","table":{"header":["연도","금액"],"rows":[["2025","1,200억"]]},"images":["s2-1","s9-9"]}]} 끝', 2, new Set(["s2-1"]));
    expect(ok?.slides[0].images).toEqual(["s2-1"]);
    expect(ok?.slides[0].table?.rows).toEqual([["2025", "1,200억"]]);
    expect(parseReflowSpec('{"slides":[{"layout":5,"title":"x"}]}', 2, new Set())).toBeNull();
    expect(parseReflowSpec("not json", 2, new Set())).toBeNull();
    expect(parseReflowSpec('{"slides":[]}', 2, new Set())).toBeNull();
  });
  it("원문에 없는 숫자를 찾는다(쉼표 차이는 같은 숫자)", () => {
    const spec = { slides: [{ layout: 1, title: "회사 개요", body: ["설립 2007년", "임직원 320명"], table: { rows: [["2025", "1200억"]] } }] };
    expect(inventedNumbers(spec, profile)).toEqual(["320"]);
  });
  it("planReflow: 숫자가 틀리면 한 번 다시 묻고, 두 번 다 틀리면 실패", async () => {
    const replies = ['{"slides":[{"layout":1,"title":"회사 개요","body":["임직원 999명"]}]}', '{"slides":[{"layout":1,"title":"회사 개요","body":["임직원 312명"]}]}'];
    const asked: string[] = [];
    const llm: DeckLlm = { model: "m", complete: async (_s, messages) => { asked.push(String(messages.at(-1)?.content)); return { text: replies.shift() ?? "", usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: "end_turn" }; } };
    const spec = await planReflow(llm, profile, template);
    expect(spec.slides[0].body).toEqual(["임직원 312명"]);
    expect(asked[1]).toContain("999");
    const always = { model: "m", complete: async () => ({ text: '{"slides":[{"layout":1,"title":"x","body":["777명"]}]}', usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, stopReason: "end_turn" }) } as DeckLlm;
    await expect(planReflow(always, profile, template)).rejects.toThrow(/모양 유지/);
  });
});
