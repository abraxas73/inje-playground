/** 즐겨찾기 — user_settings `sharepoint_favorites`(JSON, 최대 30). 링크만 저장하고 본문은 두지 않는다. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { FAVORITES_KEY, parseFavorites, type Favorite } from "./core";

export async function loadFavorites(admin: SupabaseClient, userId: string): Promise<Favorite[]> {
  const { data, error } = await admin.from("user_settings").select("value").eq("user_id", userId).eq("key", FAVORITES_KEY).maybeSingle();
  if (error) throw new Error(`즐겨찾기 조회 실패: ${error.message}`);
  return parseFavorites((data as { value?: string } | null)?.value);
}
export async function saveFavorites(admin: SupabaseClient, userId: string, list: Favorite[]): Promise<void> {
  const { error } = await admin.from("user_settings").upsert({ user_id: userId, key: FAVORITES_KEY, value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  if (error) throw new Error(`즐겨찾기 저장 실패: ${error.message}`);
}
