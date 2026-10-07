import type { DeckJson } from "@/lib/ppt/deck-json";

export type PptVersionStatus = "generating" | "building" | "done" | "failed";
export type PptSourceKind = "text" | "file" | "pptx" | "url";

export interface PptTokens { in: number; out: number; cacheRead: number; cacheWrite: number }

export interface PptVersion {
  id: string;
  no: number;
  status: PptVersionStatus;
  sourceKind: PptSourceKind;
  sourceName: string | null;
  prompt: string | null;
  feedback: string | null;
  baseVersion: number | null;
  deckJson: DeckJson | null;
  slideCount: number | null;
  advisories: string[];
  checkIssues: Record<string, string[]>;
  llmModel: string | null;
  llmCalls: number;
  tokens: PptTokens;
  durationMs: number | null;
  error: string | null;
  sharepointUrl: string | null;
  sharepointAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** 생성에 쓴 템플릿 표시 이름(내장이면 BUILTIN_TEMPLATE_LABEL) */
  templateName: string | null;
  /** URL 원고에서 가져온 이미지 수 */
  sourceImages: number;
}

/** URL 원고의 이미지. path = 버킷 ppt의 images/<versionId>/<n>.<ext>, null이면 받기 실패, 없으면 아직 안 받음 */
export interface PptSourceImage { url: string; alt: string | null; width: number | null; height: number | null; path?: string | null }

export interface PptDeckSummary {
  id: string;
  title: string;
  ownerId: string | null;
  ownerEmail: string;
  currentVersion: number;
  shareEnabled: boolean;
  latest: { no: number; status: PptVersionStatus; slideCount: number | null; createdAt: string; llmModel: string | null; templateName: string | null } | null;
  /** 모든 버전 LLM 추정 비용 합(USD). 단가 미등록 모델만 있으면 null */
  costUsd: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 관리자 전체 덱 목록 */
export interface PptAdminDecksResponse { decks: (PptDeckSummary & { versionCount: number })[] }

/** 생성 폼의 템플릿 선택지. id null = 내장 템플릿 */
export interface PptTemplateOption { id: string | null; name: string; isDefault: boolean }
export interface PptListResponse { decks: PptDeckSummary[]; llmAvailable: boolean; templates: PptTemplateOption[] }

/** 관리자 템플릿 목록 행 */
export interface PptTemplate {
  id: string; name: string; fileName: string; bytes: number; slides: number | null; issueCount: number; status: "active" | "disabled"; isDefault: boolean;
  uploadedByEmail: string; note: string | null; createdAt: string;
}
export interface PptTemplatesResponse { templates: PptTemplate[]; builtin: { file: string | null; slides: number | null } }
export const BUILTIN_TEMPLATE_LABEL = "기본형(내장 · 이노그리드 v1.0 최신본)";

export interface PptDeckDetail {
  deck: PptDeckSummary & { shareUrl: string | null; canManage: boolean };
  versions: PptVersion[];
}

/** GET /api/ppt/decks/[id]?fields=status */
export interface PptStatusResponse { versions: { no: number; status: PptVersionStatus; error: string | null }[] }

export interface PptSharedDeck {
  title: string;
  ownerEmail: string;
  version: number;
  slideCount: number | null;
  deckJson: DeckJson;
  updatedAt: string;
}

export interface PptUploadTicket { storagePath: string; token: string; signedUrl: string }

/** POST /api/ppt/decks 본문. text · storagePath+fileName · url 중 하나. */
export interface PptCreateRequest {
  text?: string;
  /** 웹 페이지 주소(https). 서버가 본문을 가져와 텍스트 원고처럼 다룬다 */
  url?: string;
  /** URL 원고: 페이지 본문의 이미지도 가져와 PPT에 넣는다 */
  includeImages?: boolean;
  storagePath?: string;
  fileName?: string;
  prompt: string;
  title?: string;
  dept?: string;
  /** PPT_MODEL_OPTIONS의 id. 비우면 서버 기본(PPT_LLM_MODEL 또는 Sonnet) */
  model?: string;
  /** 업로드 템플릿 id. 비우면 내장 템플릿 */
  templateId?: string | null;
}

/** 폼에서 고르는 생성 모델. 재생성·재시도는 기준 버전의 모델을 잇는다. */
export const DEFAULT_PPT_MODEL = "claude-sonnet-5-5";
export const PPT_MODEL_OPTIONS: ReadonlyArray<{ id: string; label: string; note: string }> = [
  { id: DEFAULT_PPT_MODEL, label: "Sonnet 5.5", note: "기본 · 빠르고 저렴" },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "더 정교 · 비용 약 2배" },
];

export type PptActionErrorCode = "not_connected" | "reconnect" | "no_folder" | "no_channel";

export const SOURCE_MAX_CHARS = 60_000;
export const PPT_SOURCE_EXTENSIONS = ["docx", "pdf", "hwp", "hwpx", "pptx", "md", "txt", "html", "htm"] as const;
export const PPT_SOURCE_EXTENSIONS_TEXT = "docx·pdf·hwp·hwpx·pptx·md·txt·html";
export const SOURCE_KIND_LABEL: Record<PptSourceKind, string> = { text: "텍스트", file: "문서 파일", pptx: "PPT 원고", url: "웹 페이지" };
