// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { extractFeatures, featureSystemPrompt, createAnthropicFeatureCall, type FeatureExtractCall } from "@/lib/rfp/catalog/extract-features";
import { LlmUnavailableError } from "@/lib/rfp/extract-llm";

describe("featureSystemPrompt", () => {
  it("솔루션 이름·설명과 출력 규칙을 담는다", () => {
    const p = featureSystemPrompt({ name: "SECloudit", description: "멀티 클라우드 보안 플랫폼" });
    expect(p).toContain("SECloudit");
    expect(p).toContain("멀티 클라우드 보안 플랫폼");
    expect(p).toContain("40자");
  });
});

describe("extractFeatures", () => {
  it("청크마다 호출하고 결과를 이름 기준으로 합친다(긴 설명 우선)", async () => {
    const seen: string[] = [];
    const call: FeatureExtractCall = async (chunk) => {
      seen.push(chunk);
      return chunk.includes("둘째")
        ? { features: [{ name: "SSO", description: "훨씬 긴 설명" }, { name: "백업", description: "b" }] }
        : { features: [{ name: "SSO", description: "짧" }] };
    };
    const text = `${"첫째 줄 ".repeat(20)}\n${"둘째 줄 ".repeat(20)}`;
    const out = await extractFeatures(text, call, { maxChars: 120 });
    expect(seen).toHaveLength(2);
    expect(out.features).toEqual([{ name: "SSO", description: "훨씬 긴 설명" }, { name: "백업", description: "b" }]);
    expect(out.warnings).toEqual([]);
  });
  it("기능이 없으면 경고, 청크 실패는 번호를 붙여 던진다", async () => {
    const none = await extractFeatures("본문", async () => ({ features: [] }));
    expect(none.warnings).toEqual(["문서에서 기능을 찾지 못했습니다."]);
    await expect(extractFeatures("본문", async () => { throw new Error("boom"); })).rejects.toThrow("기능 추출 실패(청크 1/1): boom");
  });
});

describe("createAnthropicFeatureCall", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => { if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved; });
  it("키가 없으면 LlmUnavailableError", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => createAnthropicFeatureCall({ name: "X", description: "" })).toThrow(LlmUnavailableError);
  });
  it("키가 있으면 함수를 돌려준다(호출은 하지 않음)", () => {
    expect(typeof createAnthropicFeatureCall({ name: "X", description: "" }, { apiKey: "test-key" })).toBe("function");
  });
});
