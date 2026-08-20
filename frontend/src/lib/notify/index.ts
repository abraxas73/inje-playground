import { resolveProvider, type ProviderAxis } from "@/lib/providers";
import { loadSettings, type ServerSupabase } from "@/lib/settings-server";
import { createDoorayNotifier } from "./dooray";
import { createTeamsNotifier } from "./teams";
import type { Notifier } from "./types";

export type { Notifier, ChannelMessage, DirectRecipient, SendResult } from "./types";

/** 알림 축: A 채널(notify) / C 개인 DM(dm) */
export type NotifyAxis = Extract<ProviderAxis, "notify" | "dm">;

/** Notifier 구성에 필요한 settings 키 */
export const NOTIFIER_SETTING_KEYS = [
  "notify_provider",
  "dm_provider",
  "dooray_hook_url",
  "dooray_token",
  "teams_notify_webhook_url",
  "teams_dm_webhook_url",
] as const;

/** settings 맵 → Notifier (순수; 테스트 용이) */
export function createNotifier(axis: NotifyAxis, settings: Record<string, string | undefined>): Notifier {
  if (resolveProvider(settings, axis) === "teams") {
    return createTeamsNotifier({
      notifyWebhookUrl: settings.teams_notify_webhook_url,
      dmWebhookUrl: settings.teams_dm_webhook_url,
    });
  }
  return createDoorayNotifier({ hookUrl: settings.dooray_hook_url, token: settings.dooray_token });
}

/**
 * 서버 전용: settings 테이블을 읽어 Notifier 생성.
 * overrides의 truthy 값만 시스템 값을 덮어쓴다(예: user_settings.dooray_token 우선).
 */
export async function getNotifier(
  supabase: ServerSupabase,
  axis: NotifyAxis,
  overrides: Record<string, string | undefined> = {}
): Promise<Notifier> {
  const settings = await loadSettings(supabase, NOTIFIER_SETTING_KEYS);
  for (const [k, v] of Object.entries(overrides)) {
    if (v) settings[k] = v;
  }
  return createNotifier(axis, settings);
}
