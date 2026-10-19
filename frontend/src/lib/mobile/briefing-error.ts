import Anthropic from "@anthropic-ai/sdk";

/** Only allowlisted diagnostics leave the server; never return provider messages. */
export function briefingFailure(error: unknown) {
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { message?: unknown } } | undefined;
    const message = typeof body?.error?.message === "string" ? body.error.message : "";
    if (error.status === 400 || error.status === 429) {
      if (/specified API usage limits/i.test(message)) {
        return { status: 502, code: "briefing_usage_limit", error: "AI 브리핑 서비스의 사용 한도에 도달했습니다. 관리자에게 API 사용 한도 확인을 요청해 주세요. 새로고침으로는 해결되지 않습니다." };
      }
      if (/credit balance is too low/i.test(message)) {
        return { status: 502, code: "briefing_credit_balance", error: "AI 브리핑 서비스의 API 잔액이 부족합니다. 관리자에게 결제 상태 확인을 요청해 주세요. 새로고침으로는 해결되지 않습니다." };
      }
    }
    if (error.status === 401 || error.status === 403) {
      return { status: 503, code: "briefing_configuration", error: "AI 브리핑 서비스 연결 설정을 확인해야 합니다. 관리자에게 문의해 주세요." };
    }
    if (error.status === 429) {
      return { status: 429, code: "briefing_rate_limit", error: "AI 브리핑 요청이 몰려 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
  }
  return { status: 502, code: "briefing_unavailable", error: "AI 브리핑을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." };
}
