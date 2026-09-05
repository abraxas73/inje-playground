import type { RfpFile, RfpMapping, RfpProjectDetail, RfpProjectSummary, RfpRequirement, RfpSharepointUpload, SharepointFolder } from "@/types/rfp";
import type { Verdict } from "./mapping/types";
import type { RequirementRow } from "./requirements";

export const PROJECT_COLUMNS =
  "id, name, agency, period, budget, bid_method, extra, status, extraction_method, error, warnings, requirement_count, created_by, created_at, updated_at, mapping_status, mapping_error, mapping_warnings, mapping_at, sharepoint_folder";

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
  /** 3단계 — jsonb. parseSharepointFolder로 읽는다 */
  sharepoint_folder: unknown;
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

export const SHAREPOINT_UPLOAD_COLUMNS = "id, project_id, drive_id, item_id, file_name, web_url, size_bytes, uploaded_by, created_at";

export interface SharepointUploadDbRow {
  id: string;
  project_id: string;
  drive_id: string;
  item_id: string;
  file_name: string;
  web_url: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

/** rfp_projects.sharepoint_folder(jsonb) → 타입. 필수 문자열 필드가 하나라도 없으면 null(지정 안 됨으로 취급). */
export function parseSharepointFolder(v: unknown): SharepointFolder | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
  const url = str("url"), driveId = str("driveId"), itemId = str("itemId"), name = str("name"), webUrl = str("webUrl"), setAt = str("setAt");
  if (url === null || driveId === null || itemId === null || name === null || webUrl === null || setAt === null) return null;
  return { url, driveId, itemId, name, webUrl, setBy: str("setBy"), setAt };
}

export function mapSharepointUpload(row: SharepointUploadDbRow, uploaderName: string | null): RfpSharepointUpload {
  return {
    id: row.id, fileName: row.file_name, webUrl: row.web_url, sizeBytes: Number(row.size_bytes),
    uploadedBy: { id: row.uploaded_by, name: row.uploaded_by ? uploaderName : null }, createdAt: row.created_at,
  };
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

export function mapProjectDetail(
  row: ProjectDbRow, creatorName: string | null, files: FileDbRow[], requirements: RfpRequirement[], mappings: RfpMapping[],
  lastUpload: RfpSharepointUpload | null = null,
): RfpProjectDetail {
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
    sharepoint: { folder: parseSharepointFolder(row.sharepoint_folder), lastUpload },
  };
}
