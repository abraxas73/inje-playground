/**
 * RFP 분석 결과 공유 링크(SQL `docs/sql/2026-09-09-rfp-share-links.sql`).
 *
 * - 소유자(프로젝트 최초 생성자) 또는 admin만 만들고 폐기한다.
 * - `public`  링크는 **로그인 없이** 열람된다(사외 공유). `private`는 링크가 있어도 사내 로그인이 필요하다.
 * - token이 곧 열람 권한(capability URL)이므로 **어떤 로그·감사 기록에도 토큰을 남기지 않는다**.
 *   유출 대비는 폐기(삭제)로 한다.
 * - 공개 링크로 나가는 payload는 사내 정보를 덜어낸다(`toSharedProject`) — 근거 URL(사내 Confluence 주소)과
 *   비고(내부 메모)는 private 링크에만 담는다.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RfpMapping, RfpRequirement, RfpShareLink, RfpShareVisibility, SharedProject } from "@/types/rfp";
import type { CatalogSolution } from "./mapping/types";
import { indexCatalog } from "./mapping/summary";
import { allowedOrigins, requestOrigin, resolveRedirectOrigin } from "@/lib/ms/origin";

export const SHARE_COLUMNS = "id, project_id, token, visibility, created_by, created_at, view_count, last_viewed_at";
/** 한 프로젝트에 만들 수 있는 링크 수(무한 생성 방지) */
export const SHARE_LINKS_MAX = 10;

export interface ShareLinkDbRow {
  id: string;
  project_id: string;
  token: string;
  visibility: RfpShareVisibility;
  created_by: string | null;
  created_at: string;
  view_count: number;
  last_viewed_at: string | null;
}

export function isShareVisibility(v: unknown): v is RfpShareVisibility {
  return v === "public" || v === "private";
}

/** URL-safe 32자 토큰(192비트). 추측 불가능해야 하므로 randomBytes만 쓴다. */
export function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/** 토큰 형식 검사 — DB를 두드리기 전에 형식이 아닌 값을 걸러낸다 */
export function isShareToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(v);
}

/** 화면·API 응답용(토큰은 링크 URL을 만들 때만 쓰고, 목록에도 URL 형태로만 내려준다) */
export function mapShareLink(row: ShareLinkDbRow, origin: string): RfpShareLink {
  return {
    id: row.id,
    visibility: row.visibility,
    url: shareUrl(origin, row.token),
    createdAt: row.created_at,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
  };
}

export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/rfp/shared/${token}`;
}

/**
 * 링크에 쓸 오리진. 접속 오리진이 허용 목록(MS_ALLOWED_ORIGINS)에 있으면 그것을, 없으면 목록의 첫 값을 쓴다 —
 * `x-forwarded-host`를 그대로 믿으면 공유 링크가 엉뚱한 도메인으로 만들어질 수 있다.
 */
export function shareOrigin(req: { nextUrl: { origin: string }; headers: { get(name: string): string | null } }): string {
  return resolveRedirectOrigin(requestOrigin(req)) ?? allowedOrigins()[0] ?? requestOrigin(req);
}

/**
 * 공유 화면에 내려줄 읽기 전용 payload.
 * 편집·업로드·원본 다운로드에 필요한 것(파일 목록·SharePoint·소유자 이메일)은 담지 않는다.
 */
export function toSharedProject(
  project: {
    id: string; name: string; agency: string | null; period: string | null; budget: string | null; bidMethod: string | null;
    extra: Record<string, string>; requirementCount: number; mappingAt: string | null; updatedAt: string;
  },
  requirements: RfpRequirement[],
  mappings: RfpMapping[],
  catalog: CatalogSolution[],
  visibility: RfpShareVisibility,
): SharedProject {
  const index = indexCatalog(catalog);
  const isPublic = visibility === "public";
  return {
    visibility,
    project,
    requirements,
    // 공개 링크에서는 사내 주소(근거 URL)와 내부 메모(비고)를 감춘다.
    mappings: mappings.map((m) => ({
      ...m,
      evidenceUrl: isPublic ? null : m.evidenceUrl,
      note: isPublic ? null : m.note ?? null,
      solutionName: (m.solutionCode && index.solutionName.get(m.solutionCode)) ?? m.solutionCode ?? null,
      featureName: m.featureId ? index.feature.get(m.featureId)?.name ?? null : null,
    })),
  };
}

/** 프로젝트의 링크 목록(최신순). 소유자 화면용. */
export async function loadShareLinks(admin: SupabaseClient, projectId: string, origin: string): Promise<RfpShareLink[]> {
  const { data, error } = await admin.from("rfp_share_links").select(SHARE_COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ShareLinkDbRow[]).map((r) => mapShareLink(r, origin));
}

export type CreateShareResult = { ok: true; link: RfpShareLink } | { ok: false; status: number; message: string };

export async function createShareLink(
  admin: SupabaseClient,
  projectId: string,
  visibility: RfpShareVisibility,
  userId: string,
  origin: string,
): Promise<CreateShareResult> {
  const { count, error: countError } = await admin
    .from("rfp_share_links").select("id", { count: "exact", head: true }).eq("project_id", projectId);
  if (countError) return { ok: false, status: 500, message: countError.message };
  if ((count ?? 0) >= SHARE_LINKS_MAX) {
    return { ok: false, status: 400, message: `공유 링크는 프로젝트당 ${SHARE_LINKS_MAX}개까지입니다. 쓰지 않는 링크를 폐기하세요.` };
  }
  const { data, error } = await admin
    .from("rfp_share_links")
    .insert({ project_id: projectId, token: newShareToken(), visibility, created_by: userId })
    .select(SHARE_COLUMNS)
    .single();
  if (error || !data) return { ok: false, status: 500, message: error?.message ?? "공유 링크를 만들지 못했습니다." };
  return { ok: true, link: mapShareLink(data as ShareLinkDbRow, origin) };
}

/** 토큰 → 링크(없으면 null). 열람 카운트는 호출 쪽에서 `recordShareView`로 올린다. */
export async function resolveShareToken(admin: SupabaseClient, token: string): Promise<{ id: string; projectId: string; visibility: RfpShareVisibility } | null> {
  const { data, error } = await admin.from("rfp_share_links").select("id, project_id, visibility").eq("token", token).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as { id: string; project_id: string; visibility: RfpShareVisibility };
  return { id: r.id, projectId: r.project_id, visibility: r.visibility };
}

/** 열람 흔적(횟수·마지막 시각). 실패해도 열람을 막지 않는다. */
export async function recordShareView(admin: SupabaseClient, token: string): Promise<void> {
  const { error } = await admin.rpc("rfp_share_link_viewed", { p_token: token });
  if (error) console.error("[rfp] 공유 링크 열람 기록 실패", error.message);
}
