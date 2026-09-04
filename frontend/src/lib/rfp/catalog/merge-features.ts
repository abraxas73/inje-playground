import { normalizeName } from "../overview";

/** LLM 출력·수동 입력 모두 이 길이로 자른다 */
export const FEATURE_NAME_MAX = 40;

/** 1단계 사업명 정규화와 같은 규칙(NFKC → 소문자 → 공백·기호 제거, 괄호 안 내용은 유지) */
export function normalizeFeatureName(s: string): string {
  return normalizeName(s);
}

export interface IncomingFeature {
  name: string;
  description: string;
}

export interface ExistingFeature {
  id: string;
  name: string;
  nameNorm: string;
  edited: boolean;
}

export interface MergePlan {
  toInsert: { name: string; nameNorm: string; description: string }[];
  toUpdate: { id: string; description: string }[];
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

/** 청크별 결과 합치기: 같은 이름(정규화)은 설명이 긴 것을 남긴다. 순서는 처음 등장한 순서. */
export function dedupeIncoming(features: IncomingFeature[]): IncomingFeature[] {
  const byNorm = new Map<string, { name: string; description: string }>();
  for (const raw of features) {
    const f = clean(raw);
    if (!f) continue;
    const cur = byNorm.get(f.nameNorm);
    if (!cur) byNorm.set(f.nameNorm, { name: f.name, description: f.description });
    else if (f.description.length > cur.description.length) cur.description = f.description;
  }
  return [...byNorm.values()];
}

/**
 * 스펙 §3.2 병합 규칙. 기존에 있고 edited=false → 설명 갱신, edited=true → 건너뜀, 없으면 추가.
 * 이번 결과에 없는 기존 기능은 지우지 않는다(어드민이 비활성화).
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
    if (!cur) plan.toInsert.push(f);
    else if (cur.edited) plan.skippedEdited.push(cur.name);
    else plan.toUpdate.push({ id: cur.id, description: f.description });
  }
  return plan;
}
