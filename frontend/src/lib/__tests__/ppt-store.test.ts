import { describe, expect, it } from "vitest";
import { deckPaths, mapVersion, newSourcePath, pptxFileName, SOURCE_PATH_RE, canManage, type VersionRow } from "@/lib/ppt/store";

const row: VersionRow = {
  id: "v1", deck_id: "d1", no: 2, status: "done", source_kind: "file", source_name: "a.docx", prompt: "p", feedback: null, base_version: null,
  deck_json: { meta: { title: ["a"] }, sections: [] }, pptx_path: "decks/d1/v2/deck.pptx", yaml_path: "decks/d1/v2/deck.yaml", slide_count: 12,
  advisories: ["x"], check_issues: {}, llm_model: "claude-sonnet-5-5", llm_calls: 2, tokens_in: 10, tokens_out: 20, tokens_cache_read: 30, tokens_cache_write: 40,
  duration_ms: 1000, error: null, sharepoint_url: null, sharepoint_at: null, created_at: "2026-09-30T00:00:00Z", finished_at: "2026-09-30T00:01:00Z",
};

describe("store", () => {
  it("maps a version row", () => {
    const v = mapVersion(row);
    expect(v.tokens).toEqual({ in: 10, out: 20, cacheRead: 30, cacheWrite: 40 });
    expect(v.sourceKind).toBe("file");
    expect(v.deckJson?.meta.title).toEqual(["a"]);
  });
  it("builds storage paths and file names", () => {
    expect(deckPaths("d1", 3)).toEqual({ pptx: "decks/d1/v3/deck.pptx", yaml: "decks/d1/v3/deck.yaml" });
    expect(newSourcePath("pptx")).toMatch(SOURCE_PATH_RE);
    expect(SOURCE_PATH_RE.test("source/../etc.pptx")).toBe(false);
    expect(pptxFileName("클라우드 전환", 2)).toBe("클라우드 전환_v02.pptx");
  });
  it("owner or admin can manage", () => {
    const deck = { owner_id: "u1" } as Parameters<typeof canManage>[0];
    expect(canManage(deck, "u1", "user")).toBe(true);
    expect(canManage(deck, "u2", "user")).toBe(false);
    expect(canManage(deck, "u2", "admin")).toBe(true);
  });
});
