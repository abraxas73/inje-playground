import type { ChannelMessage, DirectRecipient, FetchLike, Notifier, SendResult } from "./types";

export interface TeamsNotifierConfig {
  /** A. 채널 게시 Power Automate 워크플로 HTTP 트리거 URL (settings.teams_notify_webhook_url) */
  notifyWebhookUrl?: string;
  /** C. 개인 DM Power Automate 워크플로 HTTP 트리거 URL (settings.teams_dm_webhook_url) */
  dmWebhookUrl?: string;
}

/**
 * Dooray식 마크다운 본문을 Teams "Post message" 커넥터(HTML 본문)용으로 변환.
 * 워크플로가 Adaptive Card(마크다운 지원)를 쓰면 `text`를, 단순 메시지면 `html`을 쓰면 된다.
 */
export function toTeamsHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function postJson(fetchImpl: FetchLike, url: string, payload: unknown): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function createTeamsNotifier(cfg: TeamsNotifierConfig, fetchImpl: FetchLike = fetch): Notifier {
  const notifyUrl = cfg.notifyWebhookUrl?.trim() ?? "";
  const dmUrl = cfg.dmWebhookUrl?.trim() ?? "";

  return {
    provider: "teams",
    channelConfigured: notifyUrl.length > 0,
    directConfigured: dmUrl.length > 0,

    async sendChannel(msg: ChannelMessage): Promise<SendResult> {
      if (!notifyUrl) return { ok: false, error: "not_configured" };
      try {
        const res = await postJson(fetchImpl, notifyUrl, { title: msg.title, text: msg.text, html: toTeamsHtml(msg.text) });
        if (res.ok) return { ok: true };
        return { ok: false, error: `teams hook: ${res.status} ${await res.text()}` };
      } catch (e) {
        return { ok: false, error: `teams hook exception: ${errMsg(e)}` };
      }
    },

    async sendDirect(recipient: DirectRecipient, msg: { text: string }): Promise<SendResult> {
      if (!dmUrl) return { ok: false, error: "not_configured" };
      const email = recipient.email?.trim();
      if (!email) {
        return { ok: false, error: `dm(${recipient.name ?? recipient.memberId ?? "?"}): 이메일 없음 — Teams DM은 이메일 기준` };
      }
      try {
        const res = await postJson(fetchImpl, dmUrl, { recipientEmail: email, text: msg.text, html: toTeamsHtml(msg.text) });
        if (res.ok) return { ok: true };
        return { ok: false, error: `dm(${email}): ${res.status} ${await res.text()}` };
      } catch (e) {
        return { ok: false, error: `exception(${email}): ${errMsg(e)}` };
      }
    },
  };
}
