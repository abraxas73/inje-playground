import { charBigrams, normalizeText, tokenize } from "./tokenize";
import { truncateDetails, type ChunkRequirement } from "./chunk";
import type { CatalogSolution, EngineItem } from "./types";

/**
 * 규칙 매핑 엔진(4단계 스펙 §5.3). 키워드 일치(이름 토큰 가중치 2, 나머지 1) + 문자 bigram 유사도로 점수를 매겨
 * (유사도는 운영 튜닝 2026-09-07에 overlap coefficient → cosine `|A∩B|/√(|A|·|B|)`: 짧은 기능 설명이 긴 요구사항에 우연히 포함돼 0.6~0.9로 부풀던 것을 길이로 정규화)
 * 요구사항마다 상위 후보를 "candidate" 판정으로 낸다. 순수 함수 — I/O 없음.
 */
export const RULES = {
  HIT_WEIGHT: 0.15,
  SIM_WEIGHT: 0.7,
  /** 키워드 히트가 없을 때 유사도만으로 후보가 되는 하한(운영 튜닝 2026-09-07: 0.3 → 0.5) */
  SIM_THRESHOLD: 0.5,
  /** 후보가 되는 최소 키워드 가중치 — 이름 키워드 1개 또는 설명 키워드 2개(운영 튜닝: 1 → 2) */
  MIN_HIT_WEIGHT: 2,
  /** 활성 기능의 이 비율을 넘게 쓰인 키워드는 변별력이 없어 매칭에서 뺀다(카탈로그가 DF_MIN_FEATURES 이상일 때) */
  DF_MAX_RATIO: 0.05,
  DF_MIN_FEATURES: 20,
  /** 기능 bigram이 이보다 적으면 유사도를 0으로 본다(이름만 있는 짧은 기능이 우연히 맞는 것 방지) */
  MIN_FEATURE_BIGRAMS: 6,
  TOP_PER_REQ: 3,
  MAX_PER_SOLUTION: 2,
  /** 부분 문자열 일치를 허용하는 키워드 최소 길이 */
  SUBSTRING_MIN_LEN: 3,
  /** rationale에 나열하는 키워드 수 */
  HITS_SHOWN: 5,
} as const;

/** 결정적 정렬(ICU 로케일에 기대지 않는다): 코드포인트 순 — 라틴이 한글보다 앞 */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface FeatureEntry {
  featureId: string;
  solutionCode: string;
  name: string;
  keywords: string[];
  nameTokens: Set<string>;
  bigrams: Set<string>;
}

/**
 * 활성 솔루션의 활성 기능만. 키워드는 저장값이 이미 정규화돼 있지만 방어적으로 한 번 더 정규화한다.
 * 카탈로그 전체에서 너무 흔한 키워드(활성 기능의 DF_MAX_RATIO 초과)는 변별력이 없어 매칭 목록에서 뺀다 — "설정·접근·화면"처럼 모든 요구사항에 걸리는 단어가 후보를 채우는 것을 막는다.
 */
export function buildFeatureIndex(catalog: CatalogSolution[]): FeatureEntry[] {
  const out: FeatureEntry[] = [];
  for (const s of catalog) {
    if (!s.isActive) continue;
    for (const f of s.features) {
      if (!f.isActive) continue;
      out.push({
        featureId: f.id,
        solutionCode: s.code,
        name: f.name,
        keywords: [...new Set(f.keywords.map((k) => normalizeText(k)).filter(Boolean))],
        nameTokens: new Set(tokenize(f.name)),
        bigrams: charBigrams(`${f.name} ${f.description}`),
      });
    }
  }
  if (out.length >= RULES.DF_MIN_FEATURES) {
    const df = new Map<string, number>();
    for (const f of out) for (const k of f.keywords) df.set(k, (df.get(k) ?? 0) + 1);
    const max = out.length * RULES.DF_MAX_RATIO;
    for (const f of out) f.keywords = f.keywords.filter((k) => (df.get(k) ?? 0) <= max);
  }
  return out;
}

export interface RequirementText {
  tokens: Set<string>;
  /** 정규화 뒤 공백을 모두 뺀 문자열(부분 문자열 일치용) */
  compact: string;
  bigrams: Set<string>;
}

export function requirementText(r: ChunkRequirement): RequirementText {
  const text = `${r.title} ${r.definition} ${truncateDetails(r.details)}`;
  return { tokens: new Set(tokenize(text)), compact: normalizeText(text).replace(/\s+/g, ""), bigrams: charBigrams(text) };
}

export interface ScoreDetail {
  /** 일치한 키워드(가중치 큰 순, 같으면 코드포인트순) */
  hits: string[];
  hitWeight: number;
  sim: number;
  score: number;
}

export function scoreFeature(req: RequirementText, f: FeatureEntry): ScoreDetail {
  const scored: { k: string; w: number }[] = [];
  for (const k of f.keywords) {
    const compactK = k.replace(/\s+/g, "");
    const hit = req.tokens.has(k) || (compactK.length >= RULES.SUBSTRING_MIN_LEN && req.compact.includes(compactK));
    if (hit) scored.push({ k, w: f.nameTokens.has(k) ? 2 : 1 });
  }
  scored.sort((a, b) => b.w - a.w || byCodePoint(a.k, b.k));
  const hitWeight = scored.reduce((s, x) => s + x.w, 0);
  let sim = 0;
  if (f.bigrams.size >= RULES.MIN_FEATURE_BIGRAMS && req.bigrams.size > 0) {
    let inter = 0;
    for (const b of f.bigrams) if (req.bigrams.has(b)) inter += 1;
    sim = inter / Math.sqrt(f.bigrams.size * req.bigrams.size);
  }
  const score = Math.round(Math.min(1, RULES.HIT_WEIGHT * hitWeight + RULES.SIM_WEIGHT * sim) * 100) / 100;
  return { hits: scored.map((x) => x.k), hitWeight, sim, score };
}

export function isCandidate(d: ScoreDetail): boolean {
  return d.hitWeight >= RULES.MIN_HIT_WEIGHT || d.sim >= RULES.SIM_THRESHOLD;
}

export function rationaleFor(d: ScoreDetail): string {
  const simText = `유사도 ${d.sim.toFixed(2)}`;
  return d.hits.length ? `자동 매칭 — 일치 키워드: ${d.hits.slice(0, RULES.HITS_SHOWN).join(", ")} · ${simText}` : `자동 매칭 — ${simText}`;
}

/** 요구사항 하나: 후보를 점수 내림차순(동점은 기능 이름 코드포인트순)으로 정렬해 솔루션당 2개, 전체 3개까지 */
export function matchRequirement(r: ChunkRequirement, index: FeatureEntry[]): EngineItem[] {
  const req = requirementText(r);
  const cands = index.map((f) => ({ f, d: scoreFeature(req, f) })).filter((c) => isCandidate(c.d));
  cands.sort((a, b) => b.d.score - a.d.score || byCodePoint(a.f.name, b.f.name));
  const perSolution = new Map<string, number>();
  const out: EngineItem[] = [];
  for (const c of cands) {
    if (out.length >= RULES.TOP_PER_REQ) break;
    const n = perSolution.get(c.f.solutionCode) ?? 0;
    if (n >= RULES.MAX_PER_SOLUTION) continue;
    perSolution.set(c.f.solutionCode, n + 1);
    out.push({ reqId: r.reqId, verdict: "candidate", feature: c.f.featureId, rationale: rationaleFor(c.d), score: c.d.score });
  }
  return out;
}

export function matchChunk(chunk: readonly ChunkRequirement[], index: FeatureEntry[]): EngineItem[] {
  return chunk.flatMap((r) => matchRequirement(r, index));
}
