import type { RfpCatalogResponse } from "@/types/rfp";
import type { CatalogSolution } from "./types";

/** GET /api/rfp/catalog 응답 → 순수 함수(summary.ts)가 쓰는 CatalogSolution[] */
export function toCatalog(res: RfpCatalogResponse): CatalogSolution[] {
  return res.solutions.map((s, i) => ({
    code: s.code, name: s.name, description: s.description, isActive: s.isActive, sortOrder: i,
    features: s.features.map((f) => ({ id: f.id, solutionCode: s.code, name: f.name, description: f.description, evidenceUrl: f.evidenceUrl, isActive: f.isActive })),
  }));
}
