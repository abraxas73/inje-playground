/** Confluence 문서 즐겨찾기 — user_settings `confluence_favorites`(JSON, 최대 30). 링크·제목만 저장하고 본문은 두지 않는다(SharePoint 즐겨찾기와 같은 방식). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { JiraError } from "@/lib/jira/config";
import { ConfluenceUrlError, parseConfluencePageId } from "@/lib/rfp/catalog/confluence";
import { cqlSearch, type ConfluenceFetch } from "./client";
import { CONFLUENCE_SITE } from "./core";

export const CONFLUENCE_FAVORITES_KEY = "confluence_favorites";
export const CONFLUENCE_FAVORITES_MAX = 30;
export interface ConfluenceFavorite { id: string; type: string; title: string; spaceName: string; url: string; addedAt: string }

export function parseConfluenceFavorites(raw: string | null | undefined): ConfluenceFavorite[] {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.filter((f): f is ConfluenceFavorite => !!f && typeof f === "object" && typeof f.id === "string" && typeof f.title === "string" && typeof f.url === "string").slice(0, CONFLUENCE_FAVORITES_MAX);
  } catch { return []; }
}
/** 맨 앞에 넣는다(이미 있으면 앞으로). 꽉 찼으면 400 */
export function addConfluenceFavorite(list: ConfluenceFavorite[], f: ConfluenceFavorite): ConfluenceFavorite[] {
  const rest = list.filter((x) => x.id !== f.id);
  if (rest.length >= CONFLUENCE_FAVORITES_MAX) throw new JiraError(`즐겨찾기는 ${CONFLUENCE_FAVORITES_MAX}개까지 둘 수 있습니다.`, 400);
  return [f, ...rest];
}
export const removeConfluenceFavorite = (list: ConfluenceFavorite[], id: string) => list.filter((x) => x.id !== id);

/** {id} 또는 회사 Confluence 페이지 링크 → 내용 번호. 형식이 틀리면 400 */
export function favoriteIdFrom(body: Record<string, unknown>): string {
  if (typeof body.id === "string" && /^\d{1,20}$/.test(body.id)) return body.id;
  if (typeof body.url === "string" && body.url.trim()) {
    try { return parseConfluencePageId(body.url, new URL(CONFLUENCE_SITE).host); } catch (e) { if (e instanceof ConfluenceUrlError) throw new JiraError(e.message, 400); throw e; }
  }
  throw new JiraError("Confluence 문서 링크를 붙여 주세요.", 400);
}

/** 본인 권한으로 찾아 제목·공간·주소를 채운다(CQL id — 페이지·블로그·댓글). 못 보면 404 */
export async function resolveConfluenceFavorite(request: ConfluenceFetch, id: string, now = new Date()): Promise<ConfluenceFavorite> {
  const [item] = await cqlSearch(request, `id = ${id}`, 1);
  if (!item) throw new JiraError("문서를 찾지 못했습니다. 지워졌거나 볼 권한이 없습니다.", 404);
  return { id: item.id, type: item.type, title: item.title, spaceName: item.spaceName, url: item.url, addedAt: now.toISOString() };
}

export async function loadConfluenceFavorites(admin: SupabaseClient, userId: string): Promise<ConfluenceFavorite[]> {
  const { data, error } = await admin.from("user_settings").select("value").eq("user_id", userId).eq("key", CONFLUENCE_FAVORITES_KEY).maybeSingle();
  if (error) throw new JiraError(`즐겨찾기 조회 실패: ${error.message}`, 500);
  return parseConfluenceFavorites((data as { value?: string } | null)?.value);
}
export async function saveConfluenceFavorites(admin: SupabaseClient, userId: string, list: ConfluenceFavorite[]): Promise<void> {
  const { error } = await admin.from("user_settings").upsert({ user_id: userId, key: CONFLUENCE_FAVORITES_KEY, value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  if (error) throw new JiraError(`즐겨찾기 저장 실패: ${error.message}`, 500);
}
