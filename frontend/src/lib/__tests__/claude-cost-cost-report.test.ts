import { describe, it, expect, vi } from "vitest";
import { chunkDateRange, fetchCostReport, mergeCostRows, parseCostReport } from "@/lib/claude-cost/anthropic-cost-report";

/** 공식 문서 예시 응답을 본뜬 픽스처 */
const bucket = (day: string, results: Record<string, unknown>[]) => ({ starting_at: `${day}T00:00:00Z`, ending_at: `${day}T00:00:00Z`, results });
const item = (over: Record<string, unknown> = {}) => ({
  amount: "123.78912", context_window: "0-200k", cost_type: "tokens", currency: "USD",
  description: "Claude Opus 5 Usage - Input Tokens", inference_geo: "global", model: "claude-opus-5",
  service_tier: "standard", token_type: "uncached_input_tokens", workspace_id: "wrkspc_01", ...over,
});

describe("parseCostReport", () => {
  it("버킷 starting_at의 날짜 + results를 행으로; amount는 소수 센트 문자열 그대로", () => {
    const r = parseCostReport({ data: [bucket("2026-08-01", [item(), item({ workspace_id: null, description: "Code Execution Usage", cost_type: "code_execution", model: null, amount: "50" })])], has_more: true, next_page: "page_x" });
    expect(r.hasMore).toBe(true);
    expect(r.nextPage).toBe("page_x");
    expect(r.rows).toEqual([
      { day: "2026-08-01", workspace_id: "wrkspc_01", description: "Claude Opus 5 Usage - Input Tokens", cost_type: "tokens", model: "claude-opus-5", amount_cents: "123.78912", currency: "USD" },
      { day: "2026-08-01", workspace_id: "", description: "Code Execution Usage", cost_type: "code_execution", model: null, amount_cents: "50", currency: "USD" },
    ]);
  });
  it("빈 버킷은 행이 없고, 형식이 아니면 throw", () => {
    expect(parseCostReport({ data: [bucket("2026-08-02", [])], has_more: false, next_page: null }).rows).toEqual([]);
    expect(() => parseCostReport({ nope: 1 })).toThrow();
  });
});

describe("mergeCostRows", () => {
  it("같은 (day, workspace, description) 행은 금액을 더해 하나로(컨텍스트 창이 달라 description이 같은 경우)", () => {
    const rows = parseCostReport({ data: [bucket("2026-08-01", [item({ amount: "100.5" }), item({ amount: "0.25", context_window: "200k-1M" })])], has_more: false, next_page: null }).rows;
    const merged = mergeCostRows(rows);
    expect(merged).toHaveLength(1);
    expect(Number(merged[0].amount_cents)).toBeCloseTo(100.75, 6);
  });
});

describe("chunkDateRange", () => {
  it("31일 단위로 나눈다(양끝 포함)", () => {
    expect(chunkDateRange("2026-07-01", "2026-07-10")).toEqual([{ from: "2026-07-01", to: "2026-07-10" }]);
    expect(chunkDateRange("2026-07-01", "2026-08-31")).toEqual([
      { from: "2026-07-01", to: "2026-07-31" },
      { from: "2026-08-01", to: "2026-08-31" },
    ]);
  });
});

describe("fetchCostReport", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("헤더·쿼리를 맞춰 부르고 next_page를 따라간다", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ data: [bucket("2026-08-01", [item()])], has_more: true, next_page: "p2" }))
      .mockResolvedValueOnce(json({ data: [bucket("2026-08-02", [item({ amount: "1" })])], has_more: false, next_page: null }));
    const rows = await fetchCostReport({ apiKey: "sk-ant-admin01-test", from: "2026-08-01", to: "2026-08-02", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(rows.map((r) => r.day)).toEqual(["2026-08-01", "2026-08-02"]);
    const [url1, init1] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url1);
    expect(u.origin + u.pathname).toBe("https://api.anthropic.com/v1/organizations/cost_report");
    expect(u.searchParams.get("starting_at")).toBe("2026-08-01T00:00:00Z");
    expect(u.searchParams.get("ending_at")).toBe("2026-08-03T00:00:00Z");
    expect(u.searchParams.getAll("group_by[]")).toEqual(["workspace_id", "description"]);
    expect(u.searchParams.get("bucket_width")).toBe("1d");
    expect(u.searchParams.get("limit")).toBe("31");
    const headers = init1.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-admin01-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const url2 = fetchImpl.mock.calls[1][0] as string;
    expect(new URL(url2).searchParams.get("page")).toBe("p2");
  });

  it("429·5xx는 한 번 재시도하고, 401은 키 값 없이 오류", async () => {
    const retry = vi.fn()
      .mockResolvedValueOnce(json({ error: "rate" }, 429))
      .mockResolvedValueOnce(json({ data: [], has_more: false, next_page: null }));
    await expect(fetchCostReport({ apiKey: "k", from: "2026-08-01", to: "2026-08-01", fetchImpl: retry as unknown as typeof fetch, retryDelayMs: 0 })).resolves.toEqual([]);
    expect(retry).toHaveBeenCalledTimes(2);
    const denied = vi.fn().mockResolvedValue(json({ error: "unauthorized" }, 401));
    await expect(fetchCostReport({ apiKey: "sk-secret", from: "2026-08-01", to: "2026-08-01", fetchImpl: denied as unknown as typeof fetch })).rejects.toThrow(/거부/);
    await expect(fetchCostReport({ apiKey: "sk-secret", from: "2026-08-01", to: "2026-08-01", fetchImpl: denied as unknown as typeof fetch })).rejects.not.toThrow(/sk-secret/);
  });
});
