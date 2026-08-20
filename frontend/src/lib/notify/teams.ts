import type { ChannelMessage, DirectRecipient, FetchLike, Notifier, SendResult } from "./types";

export interface TeamsNotifierConfig {
  /** A. 채널 게시 — Teams "웹후크 요청을 받은 경우" 트리거 URL (settings.teams_notify_webhook_url) */
  notifyWebhookUrl?: string;
  /** C. 개인 DM — Teams 웹후크 트리거 + "적응형 카드 게시(Chat with Flow bot)" 흐름 URL (settings.teams_dm_webhook_url) */
  dmWebhookUrl?: string;
}

/**
 * Dooray식 본문(마크다운 **굵게**, \n 줄바꿈)을 Adaptive Card TextBlock용으로 변환.
 * TextBlock 마크다운은 **굵게**를 지원하지만 단일 \n은 무시되므로 단락(\n\n)으로 바꾼다.
 */
export function toAdaptiveText(text: string): string {
  return text.replace(/\n{2,}/g, "\n").replace(/\n/g, "\n\n");
}

interface AdaptiveTextBlock {
  type: "TextBlock";
  text: string;
  wrap?: boolean;
  weight?: "Bolder";
  size?: "Medium";
  id?: string;
  isVisible?: boolean;
}

export interface TeamsCardPayload {
  type: "message";
  attachments: {
    contentType: "application/vnd.microsoft.card.adaptive";
    contentUrl: null;
    content: {
      $schema: string;
      type: "AdaptiveCard";
      version: "1.4";
      msteams: { width: "Full" };
      body: AdaptiveTextBlock[];
    };
  }[];
}

/**
 * Teams 웹후크 트리거("When a Teams webhook request is received", 표준 라이선스)가 요구하는 봉투:
 * { type: "message", attachments: [adaptive card] }.
 * - 채널: body = [제목(굵게), 본문]
 * - DM:   body = [숨김 수신자 이메일(id=recipientEmail), 본문] — 흐름은
 *         triggerBody()?['attachments'][0]['content']['body'][0]['text'] 로 수신자를 읽는다(고정 위치).
 */
export function buildTeamsCardPayload(opts: { title?: string; text: string; recipientEmail?: string }): TeamsCardPayload {
  const body: AdaptiveTextBlock[] = [];
  if (opts.recipientEmail) {
    body.push({ type: "TextBlock", id: "recipientEmail", text: opts.recipientEmail, isVisible: false });
  }
  if (opts.title) {
    body.push({ type: "TextBlock", text: opts.title, weight: "Bolder", size: "Medium", wrap: true });
  }
  body.push({ type: "TextBlock", text: toAdaptiveText(opts.text), wrap: true });

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body,
        },
      },
    ],
  };
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
        const res = await postJson(fetchImpl, notifyUrl, buildTeamsCardPayload({ title: msg.title, text: msg.text }));
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
        const res = await postJson(fetchImpl, dmUrl, buildTeamsCardPayload({ recipientEmail: email, text: msg.text }));
        if (res.ok) return { ok: true };
        return { ok: false, error: `dm(${email}): ${res.status} ${await res.text()}` };
      } catch (e) {
        return { ok: false, error: `exception(${email}): ${errMsg(e)}` };
      }
    },
  };
}
