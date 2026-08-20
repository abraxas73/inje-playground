import type { Provider } from "@/lib/providers";

export interface ChannelMessage {
  /** Teams 카드 제목 / Dooray botName 폴백 */
  title: string;
  text: string;
  /** Dooray Incoming Hook의 botName (없으면 title) */
  botName?: string;
}

export interface DirectRecipient {
  /** Teams DM 기준 식별자 */
  email?: string;
  /** Dooray direct-send 기준 식별자(organizationMemberId) */
  memberId?: string;
  /** 오류 메시지 표시용 */
  name?: string;
}

export interface SendResult {
  ok: boolean;
  /** ok=false일 때 사람이 읽는 사유. "not_configured"는 설정 누락(호출 안 함) */
  error?: string;
}

export interface Notifier {
  readonly provider: Provider;
  /** 채널 발송에 필요한 설정이 존재하는가 */
  readonly channelConfigured: boolean;
  /** DM 발송에 필요한 설정이 존재하는가 */
  readonly directConfigured: boolean;
  sendChannel(msg: ChannelMessage): Promise<SendResult>;
  sendDirect(recipient: DirectRecipient, msg: { text: string }): Promise<SendResult>;
}

/** 테스트 주입용 fetch 시그니처 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
