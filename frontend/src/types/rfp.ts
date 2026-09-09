import type { MappingEngineKind, MappingRow, Verdict } from "@/lib/rfp/mapping/types";
import type { CategorySummaryRow } from "@/lib/rfp/category-summary";

export type RfpMappingStatus = "none" | "running" | "ready" | "failed";
export type RfpVerdict = Verdict;

export type RfpProjectStatus = "extracting" | "ready" | "failed";
export type RfpExtractionMethod = "standard" | "llm" | "xlsx";

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
  format: "hwp" | "hwpx" | "docx" | "xlsx" | "pdf";
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
  /** 3단계 — 상세 초기 표시용. 이력 전체는 GET …/sharepoint */
  sharepoint: { folder: SharepointFolder | null; lastUpload: RfpSharepointUpload | null };
  /** 요구사항 총괄표 행(구분명·ID 부여규칙·건수). 문서에 총괄표가 없으면 빈 배열 — 구분 탭 이름·검색용 */
  categorySummary: CategorySummaryRow[];
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
  /** 행을 만든 주체. 사람이 고쳐도 바뀌지 않는다(edited로 표시) */
  engine: MappingEngineKind;
  /** 규칙 엔진 점수 0~1. llm·manual은 null */
  score: number | null;
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
  /** 소스 문서 제목(Confluence 페이지·xlsx 파일명) — 근거 표시용 */
  sourceTitle: string | null;
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
  /** ANTHROPIC_API_KEY 존재 여부 — Claude 엔진 선택 가능 */
  llmAvailable: boolean;
  /** 규칙 엔진의 요구사항당 후보 상한(어드민 설정 1~5, 기본 5) — 실행 다이얼로그 안내용 */
  mappingMaxCandidates: number;
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
/** GET /api/admin/rfp-catalog/confluence-search 결과 행 */
export interface ConfluenceSearchHit {
  pageId: string;
  title: string;
  spaceKey: string | null;
  spaceName: string | null;
  /** 전체 페이지 URL — POST …/sources {url}에 그대로 넣는다 */
  url: string;
  lastModified: string | null;
}

/** GET /api/admin/rfp-catalog/solutions */
export interface RfpAdminSolutionsResponse {
  solutions: RfpAdminSolution[];
  llmAvailable: boolean;
}
export type RfpSourceKind = "confluence" | "xlsx";
export type RfpImportStatus = "idle" | "running" | "ready" | "failed";
export interface RfpSolutionSource {
  id: string;
  kind: RfpSourceKind;
  url: string;
  pageId: string;
  /** kind가 xlsx일 때 Graph driveId */
  driveId: string | null;
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
  keywords: string[];
  sourceId: string | null;
  isActive: boolean;
  edited: boolean;
  sortOrder: number;
  updatedAt: string;
  mappingCount: number;
}

/** 3단계 — rfp_projects.sharepoint_folder(jsonb) */
export interface SharepointFolder {
  url: string;
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string;
  setBy: string | null;
  setAt: string;
}

export interface RfpSharepointUpload {
  id: string;
  fileName: string;
  webUrl: string;
  sizeBytes: number;
  uploadedBy: { id: string | null; name: string | null };
  createdAt: string;
}

/** GET /api/rfp/projects/[id]/sharepoint */
export interface SharepointResponse {
  folder: SharepointFolder | null;
  /** 프로젝트 폴더가 없을 때 업로드에 쓰이는 내 기본 폴더(개인 설정). 없으면 null */
  defaultFolder?: SharepointFolder | null;
  lastUpload: RfpSharepointUpload | null;
  uploads: RfpSharepointUpload[];
}

/** folder PUT·upload POST 오류 응답의 code — 화면이 버튼(연결/재연결/폴더 지정)을 고르는 기준 */
export type SharepointErrorCode = "no_folder" | "not_connected" | "reconnect";

/** POST /api/rfp/projects/[id]/sharepoint/upload */
export interface UploadResponse {
  upload: RfpSharepointUpload;
  /** Teams 채널 알림 전송 여부. false이고 notifyError가 없으면 웹후크 미설정 */
  notified: boolean;
  notifyError?: string;
}

/** 공유 링크 공개 범위 — public은 로그인 없이, private은 사내 로그인 후 열람 */
export type RfpShareVisibility = "public" | "private";

/** 소유자 화면용 공유 링크(토큰은 url 안에만 들어간다) */
export interface RfpShareLink {
  id: string;
  visibility: RfpShareVisibility;
  /** 전체 URL(https://…/rfp/shared/{token}) */
  url: string;
  createdAt: string;
  viewCount: number;
  lastViewedAt: string | null;
}

/** GET /api/rfp/projects/[id]/shares */
export interface ShareLinksResponse {
  links: RfpShareLink[];
  /** 소유자·admin이 아니면 false — 화면이 만들기 버튼을 감춘다 */
  canManage: boolean;
}

/** 공유 화면에 내려주는 매핑 행(솔루션·기능 이름을 미리 붙여 카탈로그 없이 그린다) */
export interface SharedMapping extends RfpMapping {
  solutionName: string | null;
  featureName: string | null;
}

/** GET /api/rfp/shared/[token] — 읽기 전용 payload(파일·SharePoint·소유자 정보 없음) */
export interface SharedProject {
  visibility: RfpShareVisibility;
  project: {
    id: string;
    name: string;
    agency: string | null;
    period: string | null;
    budget: string | null;
    bidMethod: string | null;
    extra: Record<string, string>;
    requirementCount: number;
    mappingAt: string | null;
    updatedAt: string;
  };
  requirements: RfpRequirement[];
  mappings: SharedMapping[];
}
