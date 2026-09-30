import type { DeckJson } from "@/lib/ppt/deck-json";

export type PptVersionStatus = "generating" | "building" | "done" | "failed";
export type PptSourceKind = "text" | "file" | "pptx";

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

export interface PptListResponse { decks: PptDeckSummary[]; llmAvailable: boolean }

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

/** POST /api/ppt/decks 본문. text 또는 storagePath+fileName 중 하나. */
export interface PptCreateRequest {
  text?: string;
  storagePath?: string;
  fileName?: string;
  prompt: string;
  title?: string;
  dept?: string;
}

export type PptActionErrorCode = "not_connected" | "reconnect" | "no_folder" | "no_channel";
