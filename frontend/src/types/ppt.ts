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
}

export interface PptDeckSummary {
  id: string;
  title: string;
  ownerId: string | null;
  ownerEmail: string;
  currentVersion: number;
  shareEnabled: boolean;
  latest: { no: number; status: PptVersionStatus; slideCount: number | null; createdAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

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
export const PPT_SOURCE_EXTENSIONS = ["docx", "pdf", "hwp", "hwpx", "pptx", "md", "txt"] as const;
export const PPT_SOURCE_EXTENSIONS_TEXT = "docx·pdf·hwp·hwpx·pptx·md·txt";
export const SOURCE_KIND_LABEL: Record<PptSourceKind, string> = { text: "텍스트", file: "문서 파일", pptx: "PPT 원고", url: "웹 페이지" };
