/** 앱 페이지 즐겨찾기 — user_settings `app_favorites`(JSON, 최대 30). 앱 안 경로와 제목만 저장한다. */
import type { SupabaseClient } from "@supabase/supabase-js";

export const APP_FAVORITES_KEY = "app_favorites";
export const APP_FAVORITES_MAX = 30;
export type AppFavorite = { path: string; title: string };

/** 앱 안 경로만(/web?path=/…, /gw/…, /dooray/calendar, 탭 화면). 다른 오리진·스킴·제어 문자는 거절 */
export function validPath(v: unknown): v is string {
  return typeof v === "string" && v.length <= 500 && /^\/(?!\/)[\x21-\x7e]*$/.test(v) && !v.includes("\\");
}
const validTitle = (v: unknown): v is string => typeof v === "string" && v.trim().length >= 1 && v.length <= 80;

export function parseAppFavorites(raw: string | null | undefined): AppFavorite[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.filter((f): f is AppFavorite => validPath(f?.path) && validTitle(f?.title)).slice(0, APP_FAVORITES_MAX);
  } catch {
    return [];
  }
}

/** on이면 맨 앞에 넣고(같은 경로는 제목 갱신), off면 뺀다 */
export function toggleAppFavorite(list: AppFavorite[], f: AppFavorite, on: boolean): AppFavorite[] {
  const rest = list.filter(x => x.path !== f.path);
  return on ? [{ path: f.path, title: f.title.trim() }, ...rest].slice(0, APP_FAVORITES_MAX) : rest;
}

export async function loadAppFavorites(admin: SupabaseClient, userId: string): Promise<AppFavorite[]> {
  const { data, error } = await admin.from("user_settings").select("value").eq("user_id", userId).eq("key", APP_FAVORITES_KEY).maybeSingle();
  if (error) throw new Error(`즐겨찾기 조회 실패: ${error.message}`);
  return parseAppFavorites((data as { value?: string } | null)?.value);
}
export async function saveAppFavorites(admin: SupabaseClient, userId: string, list: AppFavorite[]): Promise<void> {
  const { error } = await admin.from("user_settings").upsert({ user_id: userId, key: APP_FAVORITES_KEY, value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  if (error) throw new Error(`즐겨찾기 저장 실패: ${error.message}`);
}
