import { normalizeName } from "../overview";
import { seedKeywords } from "./keywords";

/** LLM 출력·수동 입력 모두 이 길이로 자른다 */
export const FEATURE_NAME_MAX = 40;

/** 1단계 사업명 정규화와 같은 규칙(NFKC → 소문자 → 공백·기호 제거, 괄호 안 내용은 유지) */
export function normalizeFeatureName(s: string): string {
  return normalizeName(s);
}

export interface IncomingFeature {
  name: string;
  description: string;
  /** 소스가 직접 준 키워드(xlsx "키워드" 열). 시드에 extra로 들어간다 */
  keywords?: string[];
}

export interface ExistingFeature {
  id: string;
  name: string;
  nameNorm: string;
  edited: boolean;
}

export interface MergePlan {
  toInsert: { name: string; nameNorm: string; description: string; keywords: string[] }[];
  toUpdate: { id: string; description: string; keywords: string[] }[];
  /** 사람이 고쳐서 건너뛴 기존 기능의 이름 */
  skippedEdited: string[];
}

function clean(f: IncomingFeature): { name: string; nameNorm: string; description: string } | null {
  const name = f.name.trim().slice(0, FEATURE_NAME_MAX);
  if (!name) return null;
  const nameNorm = normalizeFeatureName(name);
  if (!nameNorm) return null;
  return { name, nameNorm, description: f.description.trim() };
}

/** 청크·소스별 결과 합치기: 같은 이름(정규화)은 설명이 긴 것을 남기고 keywords는 합친다. 순서는 처음 등장한 순서. */
export function dedupeIncoming(features: IncomingFeature[]): IncomingFeature[] {
  const byNorm = new Map<string, { name: string; description: string; keywords: string[] }>();
  for (const raw of features) {
    const f = clean(raw);
    if (!f) continue;
    const cur = byNorm.get(f.nameNorm);
    if (!cur) byNorm.set(f.nameNorm, { name: f.name, description: f.description, keywords: [...(raw.keywords ?? [])] });
    else {
      if (f.description.length > cur.description.length) cur.description = f.description;
      for (const k of raw.keywords ?? []) if (!cur.keywords.includes(k)) cur.keywords.push(k);
    }
  }
  return [...byNorm.values()].map((v) => (v.keywords.length ? { name: v.name, description: v.description, keywords: v.keywords } : { name: v.name, description: v.description }));
}

/**
 * 스펙 §3.2 병합 규칙. 기존에 있고 edited=false → 설명 갱신, edited=true → 건너뜀, 없으면 추가.
 * 이번 결과에 없는 기존 기능은 지우지 않는다(어드민이 비활성화).
 * 키워드는 이름·설명(+incoming.keywords)에서 시드한다(edited 기능은 건너뛰므로 키워드도 보존 — 4단계 §4.5).
 */
export function mergeFeatures(existing: ExistingFeature[], incoming: IncomingFeature[]): MergePlan {
  const byNorm = new Map(existing.map((f) => [f.nameNorm, f]));
  const plan: MergePlan = { toInsert: [], toUpdate: [], skippedEdited: [] };
  const seen = new Set<string>();
  for (const raw of incoming) {
    const f = clean(raw);
    if (!f || seen.has(f.nameNorm)) continue;
    seen.add(f.nameNorm);
    const cur = byNorm.get(f.nameNorm);
    const keywords = seedKeywords(f.name, f.description, raw.keywords ?? []);
    if (!cur) plan.toInsert.push({ ...f, keywords });
    else if (cur.edited) plan.skippedEdited.push(cur.name);
    else plan.toUpdate.push({ id: cur.id, description: f.description, keywords });
  }
  return plan;
}
