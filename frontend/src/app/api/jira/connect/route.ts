import { isInnogridAppUA } from "@/lib/mobile/app-ua";
import { oauthNotice } from "@/lib/mobile/oauth-notice";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { newNonce, signState, STATE_TTL_S } from "@/lib/ms/crypto";
import { oauthConfig } from "@/lib/jira/config";
import { authorizeUrl } from "@/lib/jira/oauth";
import { jiraFailure } from "@/lib/jira/route";
export const runtime = "nodejs";
export const STATE_COOKIE = "jira_oauth_state";
export async function GET(request: NextRequest) {
  // 최신 앱은 이 요청을 가로채 Safari/Chrome에 별도 세션을 먼저 만든다.
  // 여기까지 WebView UA로 도달했다면 쿠키가 분리되는 구버전 경로다.
  if (isInnogridAppUA(request.headers.get("user-agent") || "")) {
    return oauthNotice("현재 앱에서는 안전한 계정 연결을 시작할 수 없습니다. 최신 앱이 필요합니다.", 426);
  }
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const cfg = oauthConfig(request.nextUrl.origin);
    // 등록된 운영 오리진만 허용하며 시작 브라우저와 콜백의 쿠키를 일치시킨다.
    const nonce = newNonce();
    const state = signState({ u: auth.userId, n: nonce, r: "/settings", e: Math.floor(Date.now() / 1000) + STATE_TTL_S, ...(request.nextUrl.searchParams.get("app_return") === "1" ? { a: true as const } : {}) }, cfg.encKey);
    const response = NextResponse.redirect(authorizeUrl(state, cfg.origin), 302);
    response.cookies.set(STATE_COOKIE, nonce, { httpOnly: true, secure: cfg.origin.startsWith("https:"), sameSite: "lax", path: "/api/jira", maxAge: STATE_TTL_S });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (e) { return jiraFailure(e); }
}
