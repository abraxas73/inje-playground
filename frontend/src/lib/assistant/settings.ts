import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_DAILY_TURNS_KEY, ASSISTANT_ENABLED_KEY, assistantEnabled, dailyTurnLimit } from "./tools";

/** 관리자 설정(켜기/끄기·하루 상한) 읽기. DB 오류는 ok:false — 호출자는 닫힌 채로(503) 실패해야 한다. */
export async function loadAssistantSettings(admin: SupabaseClient): Promise<{ ok: false } | { ok: true; enabled: boolean; dailyLimit: number }> {
  const { data, error } = await admin.from("settings").select("key,value").in("key", [ASSISTANT_ENABLED_KEY, ASSISTANT_DAILY_TURNS_KEY]);
  if (error) return { ok: false };
  const get = (k: string) => ((data ?? []) as Array<{ key: string; value: string }>).find((x) => x.key === k)?.value;
  return { ok: true, enabled: assistantEnabled(get(ASSISTANT_ENABLED_KEY), process.env.ANTHROPIC_API_KEY), dailyLimit: dailyTurnLimit(get(ASSISTANT_DAILY_TURNS_KEY)) };
}
