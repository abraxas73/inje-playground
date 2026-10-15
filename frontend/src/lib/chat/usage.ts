import type { SupabaseClient } from "@supabase/supabase-js";

/** 주어진 순간의 KST 날짜(YYYY-MM-DD) — 하루 상한·사용량 행의 기준. */
export function kstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 오늘(KST) 비서 턴 수. 조회 오류는 null — 호출자는 닫힌 채로(503) 실패해야 한다. */
export async function turnsToday(admin: SupabaseClient, userId: string, now = new Date()): Promise<number | null> {
  const { data, error } = await admin.from("assistant_usage").select("turns").eq("user_id", userId).eq("day", kstDay(now)).maybeSingle();
  if (error) return null;
  return (data as { turns?: number } | null)?.turns ?? 0;
}

/** Claude 호출 1회를 사용량에 더한다(원자적 RPC). 실패해도 턴은 막지 않는다. */
export async function recordUsage(admin: SupabaseClient, u: { userId: string; model: string; inputTokens: number; outputTokens: number; masked: number }, now = new Date()): Promise<void> {
  const { error } = await admin.rpc("chat_usage_add", { p_user: u.userId, p_day: kstDay(now), p_model: u.model, p_in: u.inputTokens, p_out: u.outputTokens, p_masked: u.masked });
  if (error) console.error("[chat] 사용량 기록 실패:", error.message);
}
