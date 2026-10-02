import { describe, it, expect } from "vitest";
import { allocateCostByKey, parseUsageReport, tokenKindOf } from "@/lib/claude-cost/api-key-usage";
import type { ApiCostRow, ApiUsageRow } from "@/types/claude-cost";

const cost = (description: string, cents: string, model: string | null = "claude-opus-5-5", cost_type: string | null = "tokens"): ApiCostRow =>
  ({ day: "2026-10-01", workspace_id: "w", description, cost_type, model, amount_cents: cents, currency: "USD" });
const use = (api_key_id: string, p: Partial<ApiUsageRow>): ApiUsageRow =>
  ({ day: "2026-10-01", api_key_id, model: "claude-opus-5-5", uncached_input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0, web_search: 0, ...p });

describe("tokenKindOf", () => {
  it("cost_report description에서 토큰 종류를 읽는다", () => {
    expect(tokenKindOf("Claude Opus 5.5 - Input Tokens")).toBe("input");
    expect(tokenKindOf("Claude Opus 5.5 - Input Tokens, Cache Hit")).toBe("cache_read");
    expect(tokenKindOf("Claude Opus 5.5 - Input Tokens, Cache Write")).toBe("cache_write");
    expect(tokenKindOf("Claude Opus 5.5 - Output Tokens")).toBe("output");
    expect(tokenKindOf("Web Search")).toBeNull();
  });
});

describe("allocateCostByKey", () => {
  it("종류별 실제 금액을 그 종류의 키별 토큰 비중으로 나누고, 합은 실제 금액과 같다", () => {
    const rows = allocateCostByKey(
      [cost("Claude Opus 5.5 - Output Tokens", "100"), cost("Claude Opus 5.5 - Input Tokens", "30")],
      [use("k1", { output: 300, uncached_input: 0 }), use("k2", { output: 100, uncached_input: 10 })],
    );
    const by = Object.fromEntries(rows.map((r) => [r.apiKeyId, r.cents]));
    expect(by.k1).toBeCloseTo(75);
    expect(by.k2).toBeCloseTo(25 + 30);
    expect(rows.reduce((a, r) => a + r.cents, 0)).toBeCloseTo(130);
  });
  it("캐시 쓰기는 1시간(×2)·5분(×1.25) 단가 비율로 가중한다", () => {
    const rows = allocateCostByKey([cost("Claude Opus 5.5 - Input Tokens, Cache Write", "325")], [use("k1", { cache_write_5m: 100 }), use("k2", { cache_write_1h: 100 })]);
    const by = Object.fromEntries(rows.map((r) => [r.apiKeyId, r.cents]));
    expect(by.k1).toBeCloseTo(125);
    expect(by.k2).toBeCloseTo(200);
  });
  it("토큰 외 비용·그날 사용량이 없는 금액·키 없는 사용량은 미배분(null)", () => {
    const rows = allocateCostByKey(
      [cost("Web Search", "5", null, "web_search"), cost("Claude Sonnet 5.5 - Output Tokens", "7", "claude-sonnet-5-5"), cost("Claude Opus 5.5 - Output Tokens", "10")],
      [use("", { output: 50 }), use("k1", { output: 50 })],
    );
    const nul = rows.filter((r) => r.apiKeyId === null).reduce((a, r) => a + r.cents, 0);
    expect(nul).toBeCloseTo(5 + 7 + 5);
    expect(rows.find((r) => r.apiKeyId === "k1")?.cents).toBeCloseTo(5);
  });
});

describe("parseUsageReport", () => {
  it("키·모델별 토큰을 읽고 같은 키·모델은 더한다", () => {
    const r = parseUsageReport({ has_more: false, data: [{ starting_at: "2026-10-01T00:00:00Z", results: [
      { api_key_id: "k1", model: "m", uncached_input_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 3 }, cache_read_input_tokens: 4, output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
      { api_key_id: "k1", model: "m", uncached_input_tokens: 10, output_tokens: 50, service_tier: "batch" },
      { api_key_id: null, model: "m", output_tokens: 7 },
    ] }] });
    expect(r.rows).toEqual([
      { day: "2026-10-01", api_key_id: "k1", model: "m", uncached_input: 11, cache_write_5m: 2, cache_write_1h: 3, cache_read: 4, output: 55, web_search: 1 },
      { day: "2026-10-01", api_key_id: "", model: "m", uncached_input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 7, web_search: 0 },
    ]);
  });
});
