import { LlmUnavailableError } from "../extract-llm";
import { buildCatalogPrompt, buildChunkMessage } from "./prompt";
import { createAnthropicMappingCall } from "./llm";
import { buildFeatureIndex, matchChunk } from "./rules";
import { MAPPING_CANDIDATES_DEFAULT, parseMaxCandidates } from "./settings";
import type { CatalogSolution, EngineKind, FeatureLookup, MappingEngine } from "./types";

export { LlmUnavailableError };

/** 엔진 하나 = 청크 실행 함수 + 출력의 feature 키를 실제 기능으로 되돌리는 조회 표(4단계 스펙 §5.4) */
export interface EngineSetup {
  run: MappingEngine;
  lookup: FeatureLookup;
}
/** 엔진 실행 옵션. maxCandidates는 규칙 엔진의 요구사항당 후보 상한(어드민 설정, 1~5) — Claude 엔진은 무시한다. */
export interface EngineOptions {
  maxCandidates?: number;
}

/** 카탈로그로 엔진을 만든다. llm은 키가 없으면 LlmUnavailableError를 던진다. */
export type EngineFactory = (catalog: CatalogSolution[], opts?: EngineOptions) => EngineSetup;

/** 규칙 엔진: lookup 키 = 기능 id */
export function createRulesEngine(catalog: CatalogSolution[], opts: EngineOptions = {}): EngineSetup {
  const index = buildFeatureIndex(catalog);
  const top = parseMaxCandidates(opts.maxCandidates ?? MAPPING_CANDIDATES_DEFAULT);
  const lookup: FeatureLookup = new Map(index.map((f) => [f.featureId, { featureId: f.featureId, solutionCode: f.solutionCode }]));
  // 근거 문장은 기능 설명에서 뽑으므로 id → 설명 표를 함께 넘긴다(색인은 이름·키워드만 들고 있다)
  const descriptions = new Map(catalog.flatMap((s) => s.features.map((f) => [f.id, f.description] as const)));
  return { lookup, run: async (chunk) => matchChunk(chunk, index, top, descriptions) };
}

/** Claude 엔진(2단계 그대로): lookup 키 = "F{n}" 별칭. 출력 feature는 trim·대문자로 정리해 돌려준다. */
export function createLlmEngine(catalog: CatalogSolution[], opts: { apiKey?: string; model?: string } = {}): EngineSetup {
  const { systemText, aliases } = buildCatalogPrompt(catalog);
  const call = createAnthropicMappingCall(systemText, opts);
  return {
    lookup: aliases.features,
    run: async (chunk) =>
      (await call(buildChunkMessage(chunk))).mappings.map((m) => ({
        reqId: m.reqId, verdict: m.verdict, rationale: m.rationale,
        feature: m.feature ? m.feature.trim().toUpperCase() : null,
        detailKey: m.detail?.trim() || null,
        evidenceText: m.evidence?.trim() || undefined,
      })),
  };
}

export const ENGINE_FACTORIES: Record<EngineKind, EngineFactory> = {
  rules: createRulesEngine,
  llm: (catalog) => createLlmEngine(catalog),
};
