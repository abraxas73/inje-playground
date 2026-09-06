import { LlmUnavailableError } from "../extract-llm";
import { buildCatalogPrompt, buildChunkMessage } from "./prompt";
import { createAnthropicMappingCall } from "./llm";
import { buildFeatureIndex, matchChunk } from "./rules";
import type { CatalogSolution, EngineKind, FeatureLookup, MappingEngine } from "./types";

export { LlmUnavailableError };

/** 엔진 하나 = 청크 실행 함수 + 출력의 feature 키를 실제 기능으로 되돌리는 조회 표(4단계 스펙 §5.4) */
export interface EngineSetup {
  run: MappingEngine;
  lookup: FeatureLookup;
}
/** 카탈로그로 엔진을 만든다. llm은 키가 없으면 LlmUnavailableError를 던진다. */
export type EngineFactory = (catalog: CatalogSolution[]) => EngineSetup;

/** 규칙 엔진: lookup 키 = 기능 id */
export function createRulesEngine(catalog: CatalogSolution[]): EngineSetup {
  const index = buildFeatureIndex(catalog);
  const lookup: FeatureLookup = new Map(index.map((f) => [f.featureId, { featureId: f.featureId, solutionCode: f.solutionCode }]));
  return { lookup, run: async (chunk) => matchChunk(chunk, index) };
}

/** Claude 엔진(2단계 그대로): lookup 키 = "F{n}" 별칭. 출력 feature는 trim·대문자로 정리해 돌려준다. */
export function createLlmEngine(catalog: CatalogSolution[], opts: { apiKey?: string; model?: string } = {}): EngineSetup {
  const { systemText, aliases } = buildCatalogPrompt(catalog);
  const call = createAnthropicMappingCall(systemText, opts);
  return {
    lookup: aliases.features,
    run: async (chunk) => (await call(buildChunkMessage(chunk))).mappings.map((m) => ({ ...m, feature: m.feature ? m.feature.trim().toUpperCase() : null })),
  };
}

export const ENGINE_FACTORIES: Record<EngineKind, EngineFactory> = {
  rules: createRulesEngine,
  llm: (catalog) => createLlmEngine(catalog),
};
