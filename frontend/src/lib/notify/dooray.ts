import type { ChannelMessage, DirectRecipient, FetchLike, Notifier, SendResult } from "./types";

export const DOORAY_API_BASE = "https://api.dooray.com";
export const DOORAY_BOT_ICON = "https://static.dooray.com/static_images/dooray-bot.png";

export interface DoorayNotifierConfig {
  /** 메신저 Incoming Hook URL (settings.dooray_hook_url) */
  hookUrl?: string;
  /** 개인 API 토큰 (user_settings.dooray_token > settings.dooray_token) */
  token?: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createDoorayNotifier(cfg: DoorayNotifierConfig, fetchImpl: FetchLike = fetch): Notifier {
  const hookUrl = cfg.hookUrl?.trim() ?? "";
  const token = cfg.token?.trim() ?? "";

  return {
    provider: "dooray",
    channelConfigured: hookUrl.length > 0,
    directConfigured: token.length > 0,

    async sendChannel(msg: ChannelMessage): Promise<SendResult> {
      if (!hookUrl) return { ok: false, error: "not_configured" };
      try {
        const res = await fetchImpl(hookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            botName: msg.botName ?? msg.title,
            botIconImage: DOORAY_BOT_ICON,
            text: msg.text,
          }),
        });
        return res.ok ? { ok: true } : { ok: false, error: `hook: ${res.status}` };
      } catch (e) {
        return { ok: false, error: `hook exception: ${errMsg(e)}` };
      }
    },

    async sendDirect(recipient: DirectRecipient, msg: { text: string }): Promise<SendResult> {
      if (!token) return { ok: false, error: "not_configured" };
      const memberId = recipient.memberId;
      if (!memberId) {
        return { ok: false, error: `dm(${recipient.name ?? recipient.email ?? "?"}): Dooray 멤버 ID 없음` };
      }
      try {
        const res = await fetchImpl(`${DOORAY_API_BASE}/messenger/v1/channels/direct-send`, {
          method: "POST",
          headers: { Authorization: `dooray-api ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text: msg.text, organizationMemberId: memberId }),
        });
        if (res.ok) return { ok: true };
        const errText = await res.text();
        return { ok: false, error: `dm(${memberId}): ${res.status} ${errText}` };
      } catch (e) {
        return { ok: false, error: `exception(${memberId}): ${errMsg(e)}` };
      }
    },
  };
}
