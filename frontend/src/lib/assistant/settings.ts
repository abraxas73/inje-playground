import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_DAILY_TURNS_KEY, ASSISTANT_ENABLED_KEY, DEFAULT_ASSISTANT_MODEL, assistantEnabled, dailyTurnLimit } from "./tools";

export const ASSISTANT_MODELS_KEY = "assistant_models";
export const ASSISTANT_RETENTION_KEY = "assistant_retention_days";
export const ALLOWED_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"] as const;
export const DEFAULT_RETENTION_DAYS = 90;

/** settings 값(쉼표 목록) → 허용 모델. 모르는 이름은 버리고, 비면 전부. */
export function parseModels(s: string | null | undefined): string[] {
  const picked = (s ?? "").split(",").map((x) => x.trim()).filter((x) => (ALLOWED_MODELS as readonly string[]).includes(x));
  return picked.length ? picked : [...ALLOWED_MODELS];
}
export function retentionDays(s: string | null | undefined): number {
  const n = Number((s ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_RETENTION_DAYS;
}
/** 요청 모델이 허용 목록에 없으면 기본(Sonnet), 기본도 없으면 목록 첫 번째. */
export function pickModel(requested: unknown, models: string[]): string {
  if (typeof requested === "string" && models.includes(requested)) return requested;
  return models.includes(DEFAULT_ASSISTANT_MODEL) ? DEFAULT_ASSISTANT_MODEL : models[0];
}

/** 관리자 설정 읽기. DB 오류는 ok:false — 호출자는 닫힌 채로(503) 실패해야 한다. */
export async function loadAssistantSettings(admin: SupabaseClient): Promise<{ ok: false } | { ok: true; enabled: boolean; dailyLimit: number; models: string[]; retentionDays: number }> {
  const { data, error } = await admin.from("settings").select("key,value").in("key", [ASSISTANT_ENABLED_KEY, ASSISTANT_DAILY_TURNS_KEY, ASSISTANT_MODELS_KEY, ASSISTANT_RETENTION_KEY]);
  if (error) return { ok: false };
  const get = (k: string) => ((data ?? []) as Array<{ key: string; value: string }>).find((x) => x.key === k)?.value;
  return {
    ok: true,
    enabled: assistantEnabled(get(ASSISTANT_ENABLED_KEY), process.env.ANTHROPIC_API_KEY),
    dailyLimit: dailyTurnLimit(get(ASSISTANT_DAILY_TURNS_KEY)),
    models: parseModels(get(ASSISTANT_MODELS_KEY)),
    retentionDays: retentionDays(get(ASSISTANT_RETENTION_KEY)),
  };
}
