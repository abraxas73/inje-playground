import type { createServerSupabase } from "@/lib/supabase-server";

/** 라우트 핸들러에서 만든 서버 Supabase 클라이언트 타입(코드베이스 관례) */
export type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/** settings(전역) 테이블에서 요청한 키만 {key: value}로 읽는다. 누락 키는 맵에 없다. */
export async function loadSettings(
  supabase: ServerSupabase,
  keys: readonly string[]
): Promise<Record<string, string>> {
  const { data } = await supabase.from("settings").select("key, value").in("key", [...keys]);
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[row.key] = row.value;
  return out;
}

/** user_settings(개인) 테이블에서 특정 사용자의 요청 키만 읽는다. */
export async function loadUserSettings(
  supabase: ServerSupabase,
  userId: string,
  keys: readonly string[]
): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", [...keys]);
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[row.key] = row.value;
  return out;
}
