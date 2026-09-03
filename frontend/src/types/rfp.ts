export type RfpProjectStatus = "extracting" | "ready" | "failed";
export type RfpExtractionMethod = "standard" | "llm";

export interface RfpProjectSummary {
  id: string;
  name: string;
  agency: string | null;
  status: RfpProjectStatus;
  extractionMethod: RfpExtractionMethod | null;
  requirementCount: number;
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
  files: RfpFile[];
  requirements: RfpRequirement[];
}

/** GET /api/rfp/projects/[id]?fields=status */
export interface StatusResponse {
  status: RfpProjectStatus;
  error: string | null;
  requirementCount: number;
  extractionMethod: RfpExtractionMethod | null;
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
