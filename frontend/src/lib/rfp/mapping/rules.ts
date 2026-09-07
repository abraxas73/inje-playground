import { charBigrams, normalizeText, tokenize } from "./tokenize";
import { truncateDetails, type ChunkRequirement } from "./chunk";
import { parseDetailUnits, type DetailUnit } from "./detail-items";
import type { CatalogSolution, EngineItem } from "./types";
import { MAPPING_CANDIDATES_DEFAULT, parseMaxCandidates } from "./settings";

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
  /** 요구사항당 후보 기본 상한. 어드민 설정(1~5)이 있으면 그 값을 쓴다 — matchRequirement 인자 */
  TOP_PER_REQ: MAPPING_CANDIDATES_DEFAULT,
  MAX_PER_SOLUTION: 2,
  /** 부분 문자열 일치를 허용하는 키워드 최소 길이 */
  SUBSTRING_MIN_LEN: 3,
  /** rationale에 나열하는 키워드 수 */
  HITS_SHOWN: 5,
  /** 근거 문장 최대 길이 */
  EVIDENCE_MAX: 180,
  /** 근거 문장 최소 길이 — 중점(·)으로 끊긴 "Repository" 같은 조각을 쓰지 않는다 */
  EVIDENCE_MIN: 14,
  /** 근거 문장 길이 보정 기준 — 이보다 짧으면 점수를 깎아 조각보다 온전한 문장을 고른다 */
  EVIDENCE_FULL_LEN: 40,
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
  return textOf(text);
}

function textOf(text: string): RequirementText {
  return { tokens: new Set(tokenize(text)), compact: normalizeText(text).replace(/\s+/g, ""), bigrams: charBigrams(text) };
}

/** 세부 항목 하나의 매칭 텍스트 — 요구사항 명칭을 문맥으로 함께 넣는다(항목만으로는 도메인 단어가 빠진다) */
export function detailUnitText(r: ChunkRequirement, unit: DetailUnit): RequirementText {
  return textOf(`${r.title} ${truncateDetails(unit.text)}`);
}

/**
 * 판정 근거 문장: 기능 설명에서 요구 텍스트와 가장 많이 겹치는 문장을 고른다. 겹치는 게 없으면 첫 문장, 설명이 없으면 기능 이름.
 * 문장 분리는 줄바꿈·중점(·)·마침표 기준(카탈로그 설명이 글머리 목록인 경우가 많다).
 */
export function evidenceSentence(req: RequirementText, f: FeatureEntry, description: string): string {
  const cut = (s: string) => (s.length <= RULES.EVIDENCE_MAX ? s : `${s.slice(0, RULES.EVIDENCE_MAX).trim()}…`);
  const clean = (s: string) => s.replace(/^[\s\-–—•·※*]+/, "").replace(/\s+/g, " ").trim();
  const whole = clean(description);
  const sentences = description
    .split(/\n|·|(?<=[.。!?])\s+/)
    .map(clean)
    .filter((s) => s.length >= RULES.EVIDENCE_MIN);
  // 쓸 만한 문장이 없으면 설명 전체(짧으면 그대로), 설명도 없으면 기능 이름
  if (!sentences.length) return cut(whole || f.name);
  let best = sentences[0];
  let bestScore = -1;
  for (const s of sentences) {
    const b = charBigrams(s);
    if (!b.size) continue;
    let inter = 0;
    for (const x of b) if (req.bigrams.has(x)) inter += 1;
    // 길이 보정: 짧은 조각이 우연히 높은 겹침을 얻어 뽑히는 것을 막는다
    const score = (inter / Math.sqrt(b.size * Math.max(1, req.bigrams.size))) * Math.min(1, s.length / RULES.EVIDENCE_FULL_LEN);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return cut(best);
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

/**
 * 텍스트 하나(요구사항 전체 또는 세부 항목)에 대한 후보: 점수 내림차순(동점은 기능 이름 코드포인트순),
 * 솔루션당 MAX_PER_SOLUTION개, 전체는 maxCandidates개(어드민 설정 1~5, 기본 5)까지.
 */
function matchText(reqId: string, req: RequirementText, index: FeatureEntry[], top: number, detailKey: string | null, descriptions: Map<string, string>): EngineItem[] {
  const cands = index.map((f) => ({ f, d: scoreFeature(req, f) })).filter((c) => isCandidate(c.d));
  cands.sort((a, b) => b.d.score - a.d.score || byCodePoint(a.f.name, b.f.name));
  const perSolution = new Map<string, number>();
  const out: EngineItem[] = [];
  for (const c of cands) {
    if (out.length >= top) break;
    const n = perSolution.get(c.f.solutionCode) ?? 0;
    if (n >= RULES.MAX_PER_SOLUTION) continue;
    perSolution.set(c.f.solutionCode, n + 1);
    out.push({
      reqId, verdict: "candidate", feature: c.f.featureId, rationale: rationaleFor(c.d), score: c.d.score, detailKey,
      evidenceText: evidenceSentence(req, c.f, descriptions.get(c.f.featureId) ?? ""),
    });
  }
  return out;
}

/**
 * 요구사항 하나. 세부 내용이 목록이면 **세부 항목마다** 후보를 내고(detailKey 1,2…), 목록이 아니면 요구사항 전체로 한 번 낸다.
 * 2depth 목록은 1단 항목으로 묶는다(detail-items 규칙).
 */
export function matchRequirement(
  r: ChunkRequirement, index: FeatureEntry[], maxCandidates: number = RULES.TOP_PER_REQ, descriptions: Map<string, string> = new Map(),
): EngineItem[] {
  const top = parseMaxCandidates(maxCandidates);
  const { units, flat } = parseDetailUnits(r.details);
  if (!units.length || flat) return matchText(r.reqId, requirementText(r), index, top, null, descriptions);
  return units.flatMap((u) => matchText(r.reqId, detailUnitText(r, u), index, top, u.key, descriptions));
}

export function matchChunk(
  chunk: readonly ChunkRequirement[], index: FeatureEntry[], maxCandidates: number = RULES.TOP_PER_REQ, descriptions: Map<string, string> = new Map(),
): EngineItem[] {
  return chunk.flatMap((r) => matchRequirement(r, index, maxCandidates, descriptions));
}
