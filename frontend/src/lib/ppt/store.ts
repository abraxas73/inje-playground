/** ppt_decks · ppt_deck_versions 접근과 매핑, Storage 경로. 라우트와 generate.ts가 함께 쓴다. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUILTIN_TEMPLATE_LABEL, type PptDeckSummary, type PptSourceKind, type PptTemplate, type PptTemplateOption, type PptVersion, type PptVersionStatus } from "@/types/ppt";
import type { DeckJson } from "./deck-json";
import { safeFileName } from "./deck-json";

export const PPT_BUCKET = "ppt";
export const STALE_MS = 15 * 60 * 1000; // 라우트 maxDuration 800초보다 길게
export const ACTIVE_STATUSES: PptVersionStatus[] = ["generating", "building"];

export const DECK_COLUMNS = "id, owner_id, owner_email, title, share_token, share_enabled, current_version, created_at, updated_at";
export const VERSION_COLUMNS = "id, deck_id, no, status, source_kind, source_name, prompt, feedback, base_version, deck_json, pptx_path, yaml_path, slide_count, advisories, check_issues, llm_model, llm_calls, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write, duration_ms, error, sharepoint_url, sharepoint_at, created_at, finished_at, template_id, template_name";
export const TEMPLATE_COLUMNS = "id, name, file_name, storage_path, bytes, slides, check_issues, advisories, status, is_default, uploaded_by, uploaded_by_email, note, created_at";
export const VERSION_SOURCE_COLUMNS = `${VERSION_COLUMNS}, source_text, source_path`;

export interface DeckRow {
  id: string; owner_id: string | null; owner_email: string; title: string; share_token: string; share_enabled: boolean; current_version: number; created_at: string; updated_at: string;
}
export interface VersionRow {
  id: string; deck_id: string; no: number; status: PptVersionStatus; source_kind: PptSourceKind; source_name: string | null; prompt: string | null; feedback: string | null;
  base_version: number | null; deck_json: DeckJson | null; pptx_path: string | null; yaml_path: string | null; slide_count: number | null; advisories: string[] | null;
  check_issues: Record<string, string[]> | null; llm_model: string | null; llm_calls: number; tokens_in: number; tokens_out: number; tokens_cache_read: number; tokens_cache_write: number;
  duration_ms: number | null; error: string | null; sharepoint_url: string | null; sharepoint_at: string | null; created_at: string; finished_at: string | null;
  template_id: string | null; template_name: string | null;
}
export interface TemplateRow {
  id: string; name: string; file_name: string; storage_path: string; bytes: number; slides: number | null; check_issues: Record<string, string[]> | null; advisories: string[] | null;
  status: "active" | "disabled"; is_default: boolean; uploaded_by: string | null; uploaded_by_email: string; note: string | null; created_at: string;
}
export interface VersionSourceRow extends VersionRow { source_text: string | null; source_path: string | null }

export function mapVersion(r: VersionRow): PptVersion {
  return {
    id: r.id, no: r.no, status: r.status, sourceKind: r.source_kind, sourceName: r.source_name, prompt: r.prompt, feedback: r.feedback, baseVersion: r.base_version,
    deckJson: r.deck_json, slideCount: r.slide_count, advisories: r.advisories ?? [], checkIssues: r.check_issues ?? {}, llmModel: r.llm_model, llmCalls: r.llm_calls,
    tokens: { in: r.tokens_in, out: r.tokens_out, cacheRead: r.tokens_cache_read, cacheWrite: r.tokens_cache_write },
    durationMs: r.duration_ms, error: r.error, sharepointUrl: r.sharepoint_url, sharepointAt: r.sharepoint_at, createdAt: r.created_at, finishedAt: r.finished_at,
    templateName: r.template_name,
  };
}

export function mapTemplate(r: TemplateRow): PptTemplate {
  return {
    id: r.id, name: r.name, fileName: r.file_name, bytes: r.bytes, slides: r.slides, issueCount: Object.values(r.check_issues ?? {}).reduce((a, b) => a + b.length, 0),
    status: r.status, isDefault: r.is_default, uploadedByEmail: r.uploaded_by_email, note: r.note, createdAt: r.created_at,
  };
}

/** 생성 폼 선택지: 내장 + 활성 템플릿. 기본으로 지정된 업로드 템플릿이 없으면 내장이 기본 */
export function templateOptions(rows: Pick<TemplateRow, "id" | "name" | "status" | "is_default">[]): PptTemplateOption[] {
  const active = rows.filter((r) => r.status === "active");
  const hasDefault = active.some((r) => r.is_default);
  return [{ id: null, name: BUILTIN_TEMPLATE_LABEL, isDefault: !hasDefault }, ...active.map((r) => ({ id: r.id, name: r.name, isDefault: r.is_default }))];
}

export async function loadActiveTemplates(admin: SupabaseClient): Promise<TemplateRow[]> {
  const { data, error } = await admin.from("ppt_templates").select(TEMPLATE_COLUMNS).eq("status", "active").order("created_at", { ascending: false });
  if (error) { console.error("[ppt] 템플릿 목록 조회 실패:", error.message); return []; }
  return (data ?? []) as TemplateRow[];
}

export const PPT_RULES_SETTING_KEY = "ppt_llm_rules";
/** 관리자가 저장한 LLM 규칙. 비어 있으면 null(기본본 사용) */
export async function loadPptRules(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.from("settings").select("value").eq("key", PPT_RULES_SETTING_KEY).maybeSingle();
  if (error) { console.error("[ppt] 규칙 설정 조회 실패:", error.message); return null; }
  const v = (data as { value?: string } | null)?.value?.trim();
  return v ? v : null;
}

export function mapDeck(r: DeckRow, latest: VersionRow | null): PptDeckSummary {
  return {
    id: r.id, title: r.title || "제목 없음", ownerId: r.owner_id, ownerEmail: r.owner_email, currentVersion: r.current_version, shareEnabled: r.share_enabled,
    latest: latest ? { no: latest.no, status: latest.status, slideCount: latest.slide_count, createdAt: latest.created_at } : null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function deckPaths(deckId: string, no: number) {
  return { pptx: `decks/${deckId}/v${no}/deck.pptx`, yaml: `decks/${deckId}/v${no}/deck.yaml` };
}
export const TEMPLATE_PATH_RE = /^templates\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pptx$/;
export function newTemplatePath(): string { return `templates/${crypto.randomUUID()}.pptx`; }
export const SOURCE_PATH_RE = /^source\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(docx|pdf|hwp|hwpx|pptx|md|txt)$/;
export function newSourcePath(ext: string): string { return `source/${crypto.randomUUID()}.${ext.toLowerCase()}`; }
export function pptxFileName(title: string, no: number): string { return `${safeFileName(title)}_v${String(no).padStart(2, "0")}.pptx`; }

export function canManage(deck: Pick<DeckRow, "owner_id">, userId: string, role: "user" | "admin"): boolean {
  return (deck.owner_id !== null && deck.owner_id === userId) || role === "admin";
}

export async function loadDeck(admin: SupabaseClient, id: string): Promise<DeckRow | null> {
  const { data, error } = await admin.from("ppt_decks").select(DECK_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DeckRow | null) ?? null;
}
export async function loadVersions(admin: SupabaseClient, deckId: string): Promise<VersionRow[]> {
  const { data, error } = await admin.from("ppt_deck_versions").select(VERSION_COLUMNS).eq("deck_id", deckId).order("no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as VersionRow[];
}
export async function loadVersionWithSource(admin: SupabaseClient, id: string): Promise<VersionSourceRow | null> {
  const { data, error } = await admin.from("ppt_deck_versions").select(VERSION_SOURCE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VersionSourceRow | null) ?? null;
}

/** 15분 넘게 generating/building인 버전을 실패로 정리한다(after()가 시간 제한에 걸린 경우). */
export async function failStaleVersions(admin: SupabaseClient, now: number = Date.now()): Promise<void> {
  const cutoff = new Date(now - STALE_MS).toISOString();
  const { error } = await admin.from("ppt_deck_versions")
    .update({ status: "failed", error: "시간 초과(15분) — 다시 시도하세요.", finished_at: new Date(now).toISOString() })
    .in("status", ACTIVE_STATUSES).lt("created_at", cutoff);
  if (error) console.error("[ppt] stale 정리 실패:", error.message);
}

/** 사용자당 동시 생성 1건 */
export async function hasActiveVersion(admin: SupabaseClient, ownerId: string): Promise<boolean> {
  const { data: decks, error } = await admin.from("ppt_decks").select("id").eq("owner_id", ownerId);
  if (error) { console.error("[ppt] 진행 중 확인 실패:", error.message); return true; } // 안전측: 호출자가 409
  const ids = (decks ?? []).map((d) => (d as { id: string }).id);
  if (!ids.length) return false;
  const { count, error: e2 } = await admin.from("ppt_deck_versions").select("id", { count: "exact", head: true }).in("deck_id", ids).in("status", ACTIVE_STATUSES);
  if (e2) { console.error("[ppt] 진행 중 확인 실패:", e2.message); return true; }
  return (count ?? 0) > 0;
}
