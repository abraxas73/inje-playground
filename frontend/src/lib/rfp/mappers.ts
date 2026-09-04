import type { RfpFile, RfpMapping, RfpProjectDetail, RfpProjectSummary, RfpRequirement } from "@/types/rfp";
import type { Verdict } from "./mapping/types";
import type { RequirementRow } from "./requirements";

export const PROJECT_COLUMNS =
  "id, name, agency, period, budget, bid_method, extra, status, extraction_method, error, warnings, requirement_count, created_by, created_at, updated_at, mapping_status, mapping_error, mapping_warnings, mapping_at";

/** rfp_projects 행(PROJECT_COLUMNS) */
export interface ProjectDbRow {
  id: string;
  name: string;
  agency: string | null;
  period: string | null;
  budget: string | null;
  bid_method: string | null;
  extra: Record<string, string> | null;
  status: "extracting" | "ready" | "failed";
  extraction_method: "standard" | "llm" | null;
  error: string | null;
  warnings: unknown;
  requirement_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  mapping_status: "none" | "running" | "ready" | "failed";
  mapping_error: string | null;
  mapping_warnings: unknown;
  mapping_at: string | null;
}

export interface RequirementDbRow {
  id: string;
  category_code: string;
  category_name: string;
  req_id: string;
  title: string;
  definition: string;
  details: string;
  deliverables: string;
  related: string;
  solution: string;
  sort_order: number;
  source: unknown;
  updated_at: string;
  updated_by: string | null;
}

export interface FileDbRow {
  id: string;
  original_filename: string;
  format: "hwp" | "hwpx" | "docx";
  size_bytes: number;
  created_at: string;
}

export const MAPPING_COLUMNS = "id, project_id, requirement_id, solution_code, feature_id, verdict, rationale, evidence_url, edited, sort_order, updated_at, updated_by";

export interface MappingDbRow {
  id: string;
  project_id: string;
  requirement_id: string;
  solution_code: string | null;
  feature_id: string | null;
  verdict: Verdict;
  rationale: string;
  evidence_url: string | null;
  edited: boolean;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
}

export function mapMapping(row: MappingDbRow): RfpMapping {
  return {
    id: row.id, requirementId: row.requirement_id, solutionCode: row.solution_code, featureId: row.feature_id, verdict: row.verdict,
    rationale: row.rationale, evidenceUrl: row.evidence_url, edited: row.edited, sortOrder: row.sort_order, updatedAt: row.updated_at, updatedBy: row.updated_by,
  };
}

export function mapProjectSummary(row: ProjectDbRow, creatorName: string | null): RfpProjectSummary {
  return {
    id: row.id,
    name: row.name,
    agency: row.agency,
    status: row.status,
    extractionMethod: row.extraction_method,
    requirementCount: row.requirement_count,
    mappingStatus: row.mapping_status,
    createdBy: { id: row.created_by, name: creatorName },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFile(row: FileDbRow): RfpFile {
  return { id: row.id, originalFilename: row.original_filename, format: row.format, sizeBytes: Number(row.size_bytes), createdAt: row.created_at };
}

export function mapRequirement(row: RequirementDbRow): RfpRequirement {
  return {
    id: row.id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    reqId: row.req_id,
    title: row.title,
    definition: row.definition,
    details: row.details,
    deliverables: row.deliverables,
    related: row.related,
    solution: row.solution,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** xlsx 입력(RequirementRow) */
export function toRequirementRow(row: RequirementDbRow): RequirementRow {
  const source = (row.source && typeof row.source === "object" ? row.source : { blockIndex: -1 }) as RequirementRow["source"];
  return {
    id: row.id,
    categoryCode: row.category_code,
    categoryName: row.category_name,
    reqId: row.req_id,
    title: row.title,
    definition: row.definition,
    details: row.details,
    deliverables: row.deliverables,
    related: row.related,
    solution: row.solution,
    sortOrder: row.sort_order,
    source,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function mapProjectDetail(row: ProjectDbRow, creatorName: string | null, files: FileDbRow[], requirements: RfpRequirement[], mappings: RfpMapping[]): RfpProjectDetail {
  return {
    ...mapProjectSummary(row, creatorName),
    period: row.period,
    budget: row.budget,
    bidMethod: row.bid_method,
    extra: row.extra ?? {},
    error: row.error,
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
    mappingError: row.mapping_error,
    mappingWarnings: Array.isArray(row.mapping_warnings) ? (row.mapping_warnings as string[]) : [],
    mappingAt: row.mapping_at,
    files: files.map(mapFile),
    requirements,
    mappings,
  };
}
