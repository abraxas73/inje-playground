import { nameCore } from "./overview";

export interface ExistingProject {
  id: string;
  name: string;
  agency: string | null;
  nameNorm: string;
  agencyNorm: string | null;
  fileHashes: string[];
  createdAt: string;
}

export interface DedupeInput {
  sha256: string;
  nameNorm: string;
  nameCore: string;
  agencyNorm: string | null;
}

export type DedupeResult =
  | { kind: "duplicate"; projectId: string; reason: "hash" | "name_agency" }
  | { kind: "needsConfirm"; candidates: ExistingProject[] }
  | { kind: "new" };

export const SIMILARITY_THRESHOLD = 0.85;

/** 바이그램 Dice 계수(0~1). 정규화된 사업명끼리 비교한다. */
export function bigramDice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/**
 * 스펙 §5. 해시 일치 또는 (사업명·발주기관 모두 있고) 둘 다 일치 → duplicate.
 * 발주기관이 없는데 사업명이 같거나, nameCore가 같거나, 사업명 유사도 ≥ 0.85 → needsConfirm. 그 외 new.
 */
export function decideDuplicate(input: DedupeInput, existing: ExistingProject[]): DedupeResult {
  const byHash = existing.find((p) => p.fileHashes.includes(input.sha256));
  if (byHash) return { kind: "duplicate", projectId: byHash.id, reason: "hash" };

  if (input.agencyNorm) {
    const exact = existing.find((p) => p.nameNorm === input.nameNorm && p.agencyNorm === input.agencyNorm);
    if (exact) return { kind: "duplicate", projectId: exact.id, reason: "name_agency" };
  }

  const candidates = existing.filter((p) => {
    if (!input.agencyNorm && p.nameNorm === input.nameNorm) return true;
    if (nameCore(p.name) === input.nameCore) return true;
    return bigramDice(p.nameNorm, input.nameNorm) >= SIMILARITY_THRESHOLD;
  });
  return candidates.length ? { kind: "needsConfirm", candidates } : { kind: "new" };
}
