import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogFeature, CatalogSolution } from "../mapping/types";
import type { RfpAdminFeature, RfpAdminSolution, RfpImportStatus, RfpSolutionSource, RfpSourceKind } from "@/types/rfp";
import { selectAll } from "@/lib/work-metrics/common";

export const SOLUTION_CODE_RE = /^[a-z0-9-]{2,30}$/;

export const SOLUTION_COLUMNS = "code, name, description, is_active, sort_order, updated_at";
export const SOURCE_COLUMNS = "id, solution_code, kind, url, page_id, drive_id, title, page_version, import_status, imported_at, feature_count, error, note, created_at, updated_at";
export const FEATURE_COLUMNS = "id, solution_code, name, name_norm, description, keywords, evidence_url, source_id, is_active, edited, sort_order, updated_at";

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
  kind: RfpSourceKind;
  url: string;
  page_id: string;
  drive_id: string | null;
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
  keywords: string[] | null;
  evidence_url: string | null;
  source_id: string | null;
  is_active: boolean;
  edited: boolean;
  sort_order: number;
  updated_at: string;
}

export function mapFeature(row: FeatureDbRow, sourceTitle: string | null = null): CatalogFeature {
  return { id: row.id, solutionCode: row.solution_code, name: row.name, description: row.description, evidenceUrl: row.evidence_url, isActive: row.is_active, keywords: row.keywords ?? [], sourceTitle };
}

export function mapAdminSolution(row: SolutionDbRow, counts: { total: number; active: number; sources: number }): RfpAdminSolution {
  return {
    code: row.code, name: row.name, description: row.description, isActive: row.is_active, sortOrder: row.sort_order,
    featureCount: counts.total, activeFeatureCount: counts.active, sourceCount: counts.sources, updatedAt: row.updated_at,
  };
}

export function mapSource(row: SourceDbRow): RfpSolutionSource {
  return {
    id: row.id, kind: row.kind, url: row.url, pageId: row.page_id, driveId: row.drive_id, title: row.title, pageVersion: row.page_version, importStatus: row.import_status,
    importedAt: row.imported_at, featureCount: row.feature_count, error: row.error, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function mapAdminFeature(row: FeatureDbRow, mappingCount: number): RfpAdminFeature {
  return {
    id: row.id, name: row.name, description: row.description, evidenceUrl: row.evidence_url, keywords: row.keywords ?? [], sourceId: row.source_id,
    isActive: row.is_active, edited: row.edited, sortOrder: row.sort_order, updatedAt: row.updated_at, mappingCount,
  };
}

/**
 * 카탈로그 전체. 기능은 비활성 포함(매핑이 참조하는 이름을 그려야 함) — 활성만 필요하면 호출 쪽에서 거른다.
 * 4단계 규칙 파서·xlsx 기능명세서는 기능을 수백 건씩 올릴 수 있어 기능 조회는 selectAll로 1000행 상한을 넘어 읽는다.
 */
export async function loadCatalog(admin: SupabaseClient, opts: { activeSolutionsOnly?: boolean } = {}): Promise<CatalogSolution[]> {
  const base = admin.from("rfp_solutions").select(SOLUTION_COLUMNS);
  const solutionsQuery = (opts.activeSolutionsOnly ? base.eq("is_active", true) : base).order("sort_order").order("code");
  const [sols, feats, sources] = await Promise.all([
    solutionsQuery,
    selectAll<FeatureDbRow>(() => admin.from("rfp_solution_features").select(FEATURE_COLUMNS, { count: "exact" }).order("sort_order").order("name").order("id")),
    admin.from("rfp_solution_sources").select("id, title"),
  ]);
  if (sols.error) throw new Error(sols.error.message);
  if (feats.error) throw new Error(feats.error.message);
  if (sources.error) throw new Error(sources.error.message);
  const sourceTitle = new Map(((sources.data ?? []) as { id: string; title: string | null }[]).map((s) => [s.id, s.title]));
  const byCode = new Map<string, CatalogFeature[]>();
  for (const f of feats.data) {
    const list = byCode.get(f.solution_code) ?? [];
    list.push(mapFeature(f, f.source_id ? sourceTitle.get(f.source_id) ?? null : null));
    byCode.set(f.solution_code, list);
  }
  return ((sols.data ?? []) as SolutionDbRow[]).map((s) => ({
    code: s.code, name: s.name, description: s.description, isActive: s.is_active, sortOrder: s.sort_order, features: byCode.get(s.code) ?? [],
  }));
}
