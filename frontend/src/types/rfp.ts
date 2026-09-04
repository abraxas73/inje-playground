import type { MappingRow, Verdict } from "@/lib/rfp/mapping/types";

export type RfpMappingStatus = "none" | "running" | "ready" | "failed";
export type RfpVerdict = Verdict;

export type RfpProjectStatus = "extracting" | "ready" | "failed";
export type RfpExtractionMethod = "standard" | "llm";

export interface RfpProjectSummary {
  id: string;
  name: string;
  agency: string | null;
  status: RfpProjectStatus;
  extractionMethod: RfpExtractionMethod | null;
  requirementCount: number;
  mappingStatus: RfpMappingStatus;
  createdBy: { id: string | null; name: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface RfpFile {
  id: string;
  originalFilename: string;
  format: "hwp" | "hwpx" | "docx";
  sizeBytes: number;
  createdAt: string;
}

export interface RfpRequirement {
  id: string;
  categoryCode: string;
  categoryName: string;
  reqId: string;
  title: string;
  definition: string;
  details: string;
  deliverables: string;
  related: string;
  solution: string;
  sortOrder: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface RfpProjectDetail extends RfpProjectSummary {
  period: string | null;
  budget: string | null;
  bidMethod: string | null;
  extra: Record<string, string>;
  error: string | null;
  warnings: string[];
  mappingError: string | null;
  mappingWarnings: string[];
  mappingAt: string | null;
  mappings: RfpMapping[];
  files: RfpFile[];
  requirements: RfpRequirement[];
}

/** GET /api/rfp/projects/[id]?fields=status */
export interface StatusResponse {
  status: RfpProjectStatus;
  error: string | null;
  requirementCount: number;
  extractionMethod: RfpExtractionMethod | null;
  mappingStatus: RfpMappingStatus;
  mappingError: string | null;
  mappingAt: string | null;
  updatedAt: string;
}

export interface UploadTicket {
  storagePath: string;
  token: string;
  signedUrl: string;
}

export type RegisterResponse =
  | { duplicate: true; projectId: string }
  | { needsConfirm: true; candidates: { id: string; name: string; agency: string | null; createdAt: string }[]; overview: { name: string; agency: string | null } }
  | { created: true; projectId: string };

export interface RfpMapping extends MappingRow {
  updatedAt: string;
  updatedBy: string | null;
}

/** GET /api/rfp/projects/[id]/mapping */
export interface MappingResponse {
  mappingStatus: RfpMappingStatus;
  mappingError: string | null;
  mappingWarnings: string[];
  mappingAt: string | null;
  mappings: RfpMapping[];
}

/** GET /api/rfp/catalog — 활성 솔루션, 기능은 비활성 포함(isActive로 구분) */
export interface RfpCatalogFeature {
  id: string;
  name: string;
  description: string;
  evidenceUrl: string | null;
  isActive: boolean;
}
export interface RfpCatalogSolution {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  features: RfpCatalogFeature[];
}
export interface RfpCatalogResponse {
  solutions: RfpCatalogSolution[];
}

/** 어드민 /api/admin/rfp-catalog */
export interface RfpAdminSolution {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
  featureCount: number;
  activeFeatureCount: number;
  sourceCount: number;
  updatedAt: string;
}
export type RfpImportStatus = "idle" | "running" | "ready" | "failed";
export interface RfpSolutionSource {
  id: string;
  url: string;
  pageId: string;
  title: string | null;
  pageVersion: number | null;
  importStatus: RfpImportStatus;
  importedAt: string | null;
  featureCount: number;
  error: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RfpAdminFeature {
  id: string;
  name: string;
  description: string;
  evidenceUrl: string | null;
  sourceId: string | null;
  isActive: boolean;
  edited: boolean;
  sortOrder: number;
  updatedAt: string;
  mappingCount: number;
}
