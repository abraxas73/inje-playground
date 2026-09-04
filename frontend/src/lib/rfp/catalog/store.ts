import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogFeature, CatalogSolution } from "../mapping/types";
import type { RfpAdminFeature, RfpAdminSolution, RfpImportStatus, RfpSolutionSource } from "@/types/rfp";

export const SOLUTION_CODE_RE = /^[a-z0-9-]{2,30}$/;

export const SOLUTION_COLUMNS = "code, name, description, is_active, sort_order, updated_at";
export const SOURCE_COLUMNS = "id, solution_code, url, page_id, title, page_version, import_status, imported_at, feature_count, error, note, created_at, updated_at";
export const FEATURE_COLUMNS = "id, solution_code, name, name_norm, description, evidence_url, source_id, is_active, edited, sort_order, updated_at";

export interface SolutionDbRow {
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  updated_at: string;
}

export interface SourceDbRow {
  id: string;
  solution_code: string;
  url: string;
  page_id: string;
  title: string | null;
  page_version: number | null;
  import_status: RfpImportStatus;
  imported_at: string | null;
  feature_count: number;
  error: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureDbRow {
  id: string;
  solution_code: string;
  name: string;
  name_norm: string;
  description: string;
  evidence_url: string | null;
  source_id: string | null;
  is_active: boolean;
  edited: boolean;
  sort_order: number;
  updated_at: string;
}

export function mapFeature(row: FeatureDbRow): CatalogFeature {
  return { id: row.id, solutionCode: row.solution_code, name: row.name, description: row.description, evidenceUrl: row.evidence_url, isActive: row.is_active };
}

export function mapAdminSolution(row: SolutionDbRow, counts: { total: number; active: number; sources: number }): RfpAdminSolution {
  return {
    code: row.code, name: row.name, description: row.description, isActive: row.is_active, sortOrder: row.sort_order,
    featureCount: counts.total, activeFeatureCount: counts.active, sourceCount: counts.sources, updatedAt: row.updated_at,
  };
}

export function mapSource(row: SourceDbRow): RfpSolutionSource {
  return {
    id: row.id, url: row.url, pageId: row.page_id, title: row.title, pageVersion: row.page_version, importStatus: row.import_status,
    importedAt: row.imported_at, featureCount: row.feature_count, error: row.error, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function mapAdminFeature(row: FeatureDbRow, mappingCount: number): RfpAdminFeature {
  return {
    id: row.id, name: row.name, description: row.description, evidenceUrl: row.evidence_url, sourceId: row.source_id,
    isActive: row.is_active, edited: row.edited, sortOrder: row.sort_order, updatedAt: row.updated_at, mappingCount,
  };
}

/**
 * 카탈로그 전체. 기능은 비활성 포함(매핑이 참조하는 이름을 그려야 함) — 활성만 필요하면 호출 쪽에서 거른다.
 * 솔루션 수 개 × 기능 수십 개라 Supabase 1000행 상한에 걸리지 않는다.
 */
export async function loadCatalog(admin: SupabaseClient, opts: { activeSolutionsOnly?: boolean } = {}): Promise<CatalogSolution[]> {
  const base = admin.from("rfp_solutions").select(SOLUTION_COLUMNS);
  const solutionsQuery = (opts.activeSolutionsOnly ? base.eq("is_active", true) : base).order("sort_order").order("code");
  const [sols, feats] = await Promise.all([
    solutionsQuery,
    admin.from("rfp_solution_features").select(FEATURE_COLUMNS).order("sort_order").order("name"),
  ]);
  if (sols.error) throw new Error(sols.error.message);
  if (feats.error) throw new Error(feats.error.message);
  const byCode = new Map<string, CatalogFeature[]>();
  for (const f of (feats.data ?? []) as FeatureDbRow[]) {
    const list = byCode.get(f.solution_code) ?? [];
    list.push(mapFeature(f));
    byCode.set(f.solution_code, list);
  }
  return ((sols.data ?? []) as SolutionDbRow[]).map((s) => ({
    code: s.code, name: s.name, description: s.description, isActive: s.is_active, sortOrder: s.sort_order, features: byCode.get(s.code) ?? [],
  }));
}
