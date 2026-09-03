import type { SupabaseClient } from "@supabase/supabase-js";

/** user_id → 표시 이름(user_profiles.display_name, 없으면 email) */
export async function creatorNames(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!userIds.length) return map;
  const { data } = await admin.from("user_profiles").select("user_id, display_name, email").in("user_id", [...new Set(userIds)]);
  for (const p of data ?? []) map.set(p.user_id as string, (p.display_name as string | null) ?? (p.email as string | null) ?? null);
  return map;
}
