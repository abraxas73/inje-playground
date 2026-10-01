// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { Messages } from "@anthropic-ai/sdk/resources/messages";
import { ENGINE_FACTORIES } from "@/lib/rfp/mapping/engine";
import { createAnthropicMappingCall } from "@/lib/rfp/mapping/llm";
import { createAnthropicExtractCall } from "@/lib/rfp/extract-llm";
import { createAnthropicFeatureCall } from "@/lib/rfp/catalog/extract-features";
import { assertCompleteLlmMapping, validateMappingOutput } from "@/lib/rfp/mapping/validate";
import type { CatalogSolution } from "@/lib/rfp/mapping/types";

const chunk = [{ id: "r1", reqId: "SFR-001", title: "플랫폼", categoryName: "기능", definition: "", details: "○ 인증\n○ 백업" }];
const catalog: CatalogSolution[] = ["a", "b"].map((code) => ({
  code, name: code, description: "", isActive: true, sortOrder: 0,
  features: Array.from({ length: 3 }, (_, i) => ({ id: `${code}${i}`, solutionCode: code, name: `기능${i}`, description: "기능 설명", evidenceUrl: null, isActive: true, keywords: [] })),
}));
function respond(body: object, stopReason = "end_turn") {
  return vi.spyOn(Messages.prototype, "stream").mockReturnValue({
    finalMessage: async () => ({ stop_reason: stopReason, content: [{ type: "text", text: JSON.stringify(body) }] }),
  } as ReturnType<Messages["stream"]>);
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Claude SDK 연결", () => {
  it("주입된 키·모델로 세 경로가 구조화 출력을 요청하고 읽는다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("RFP_LLM_MODEL", "configured-model");
    const stream = respond({ requirements: [], features: [], mappings: [] });
    await expect(createAnthropicExtractCall()("본문")).resolves.toEqual({ requirements: [] });
    await expect(createAnthropicFeatureCall({ name: "제품", description: "" })("본문")).resolves.toEqual({ features: [] });
    await expect(createAnthropicMappingCall("카탈로그")("요구")).resolves.toEqual({ mappings: [] });
    expect(stream).toHaveBeenCalledTimes(3);
    for (const [request] of stream.mock.calls) {
      expect(request).toMatchObject({ model: "configured-model", thinking: { type: "adaptive" }, output_config: { format: { type: "json_schema" } } });
    }
  });
  it.each(["max_tokens", "refusal"])("중단된 응답(%s)을 성공으로 취급하지 않는다", async (reason) => {
    respond({ mappings: [] }, reason);
    await expect(createAnthropicMappingCall("catalog", { apiKey: "test-key" })("req")).rejects.toThrow();
  });
  it("엔진 팩토리의 후보 상한이 실제 Claude 요청까지 전달된다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const stream = respond({ mappings: [{ reqId: "SFR-001", detail: "1", verdict: "fulfilled", feature: " f1 ", rationale: "인증", evidence: "기능 설명" }] });
    const engine = ENGINE_FACTORIES.llm(catalog, { maxCandidates: 1 });
    const items = await engine.run(chunk);
    expect(stream.mock.calls[0][0].messages[0].content).toContain("세부 항목당 최대 후보 1개");
    expect(items[0]).toMatchObject({ feature: "F1", detailKey: "1", evidenceText: "기능 설명" });
    expect(engine.lookup.get("F1")?.featureId).toBe("a0");
  });
});

describe("Claude 결과 저장 전 검증", () => {
  const lookup = new Map(Array.from({ length: 6 }, (_, i) => [`F${i + 1}`, { featureId: `f${i}`, solutionCode: i < 3 ? "a" : "b" }]));
  const items = ["1", "2"].flatMap((detailKey) => Array.from({ length: 6 }, (_, i) => ({ reqId: "SFR-001", detailKey, feature: `F${i + 1}`, verdict: "fulfilled" as const, rationale: "근거" })));
  it("모델이 무시해도 단위별 전체·솔루션 상한을 서버에서 지킨다", () => {
    const v = validateMappingOutput(items, chunk, lookup, { maxCandidates: 3, maxPerSolution: 2 });
    for (const key of ["1", "2"]) expect(v.rows.filter((r) => r.detailKey === key).map((r) => r.featureId)).toEqual(["f0", "f1", "f3"]);
    expect(() => assertCompleteLlmMapping(v.rows, chunk)).not.toThrow();
    expect(validateMappingOutput(items, chunk, lookup, { maxCandidates: 1, maxPerSolution: 2 }).rows).toHaveLength(2);
  });
  it("빈 결과·항목 누락·없는 기능은 기존 결과 교체 전에 거부한다", () => {
    for (const input of [[], items.filter((r) => r.detailKey === "1"), items.map((r) => ({ ...r, feature: "F999" }))]) {
      const v = validateMappingOutput(input, chunk, lookup);
      expect(() => assertCompleteLlmMapping(v.rows, chunk)).toThrow("기존 매핑은 유지됩니다");
    }
  });
});
