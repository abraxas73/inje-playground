export function logAction(
  action: string,
  category: string,
  detail?: Record<string, unknown>
) {
  fetch("/api/action-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, category, detail }),
  }).catch(() => {});
}

/**
 * 로그인 전(익명) 감사 이벤트 — `/api/action-history`는 로그인 사용자만 남기므로 전용 경로로 보낸다.
 * OAuth 리다이렉트 직전에 호출되므로 `keepalive`로 보내 페이지가 떠나도 요청이 끊기지 않게 한다.
 */
export async function logAuthEvent(
  event: "attempt" | "failure",
  provider: "google" | "azure" | "gw",
  reason?: string
): Promise<void> {
  try {
    await fetch("/api/auth/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, provider, reason }),
      keepalive: true,
    });
  } catch {
    // 감사 기록이 로그인 흐름을 막지 않는다
  }
}
