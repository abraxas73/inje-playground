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

/** 개인 설정(user_settings)에서 알림에 쓰는 키 — 채널 알림을 자기 워크플로우로 보내는 사람용 */
export const USER_NOTIFIER_SETTING_KEYS = ["teams_notify_webhook_url", "dooray_token"] as const;

/**
 * 개인 설정 → getNotifier overrides.
 * 개인 워크플로우 URL이 있으면 그 사람의 채널 알림은 **Teams 웹후크로 보낸다**(전역 provider가
 * Dooray라도). 개인 값이 없으면 빈 객체라 전역 설정이 그대로 쓰인다.
 */
export function personalNotifyOverrides(userSettings: Record<string, string | undefined>): Record<string, string | undefined> {
  const webhook = userSettings.teams_notify_webhook_url?.trim();
  return {
    dooray_token: userSettings.dooray_token,
    ...(webhook ? { teams_notify_webhook_url: webhook, notify_provider: "teams" } : {}),
  };
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
