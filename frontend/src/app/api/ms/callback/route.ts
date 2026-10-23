import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { verifyState } from "@/lib/ms/crypto";
import { exchangeCode, fetchMe, MS_SCOPES, OAuthError, oauthErrorMessage } from "@/lib/ms/oauth";
import { appendQuery, requestOrigin, resolveRedirectOrigin, sanitizeReturnTo } from "@/lib/ms/origin";
import { saveConnection } from "@/lib/ms/connections";
import { mobileConnectionComplete, mobileConnectionFailed } from "@/lib/ms/mobile-return";

export const runtime = "nodejs";

const EXPIRED = "연결 요청이 만료되었습니다. 다시 시도하세요.";
const ACCOUNT_MISMATCH = "앱 로그인 계정과 Microsoft 계정이 일치하지 않습니다. 같은 계정으로 다시 연결해 주세요.";

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

/**
 * GET /api/ms/callback?code&state[&error&error_description] — Azure에서 돌아오는 곳(스펙 §3.1).
 * 성공: returnTo?ms_connected=1 / 실패: returnTo?ms_error=<한국어 문구>. 토큰·error_description은 응답에 싣지 않는다.
 */
export async function GET(request: NextRequest) {
  const origin = resolveRedirectOrigin(requestOrigin(request));
  if (!origin) return NextResponse.json({ error: "허용되지 않은 오리진입니다." }, { status: 400 });

  const service = adminClientOr500();
  if (!service.ok) return service.response;
  const cfg = await loadMsConfig(service.admin);
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }
  const { app, encKey } = cfg.config;
  const q = request.nextUrl.searchParams;
  const back = (path: string, key: "ms_connected" | "ms_error", value: string) => NextResponse.redirect(`${origin}${appendQuery(path, key, value)}`, 302);

  // 앱 state는 인증된 Bearer 전용 API가 서명해 브라우저 쿠키 없이 복귀한다. 웹 state는 현재 쿠키 사용자까지 일치해야 한다.
  const state = verifyState(q.get("state") ?? "", encKey);
  if (!state) return back(sanitizeReturnTo(null), "ms_error", EXPIRED);
  if (!state.a) {
    const auth = await requireUser();
    if (!auth.ok) {
      if (auth.response.status !== 401 && auth.response.status !== 403) return auth.response;
      return new NextResponse(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Microsoft 연결 안내</title></head><body style="font-family:system-ui;padding:24px;max-width:480px;margin:40px auto;line-height:1.7"><h1>Microsoft 연결을 완료하지 못했습니다</h1><p>이 브라우저에서 앱 로그인 상태를 확인할 수 없습니다. 앱을 최신 버전으로 업데이트한 뒤 설정에서 다시 연결해 주세요.</p><p>웹에서는 아래 설정 화면에 로그인한 뒤 Microsoft 계정을 다시 연결할 수 있습니다.</p><a href="/settings">설정으로 이동</a></body></html>`, {
        status: auth.response.status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
    }
    if (state.u !== auth.userId) return back(sanitizeReturnTo(null), "ms_error", EXPIRED);
  }
  const returnTo = sanitizeReturnTo(state.r);
  // 앱 흐름은 외부 브라우저라 웹으로 보내지 않고 이유를 보여 준 뒤 앱으로(mobileConnectionFailed)
  const fail = (message: string) => (state.a ? mobileConnectionFailed(message) : back(returnTo, "ms_error", message));

  const azureError = q.get("error");
  if (azureError) {
    console.warn(`[ms] authorize 거부 ${azureError}: ${q.get("error_description") ?? ""}`);
    return fail(oauthErrorMessage(azureError));
  }
  const code = q.get("code");
  if (!code) return fail("인증 코드가 없습니다. 다시 시도하세요.");

  try {
    const tok = await exchangeCode(app, { code, redirectUri: `${origin}/api/ms/callback` });
    if (!tok.refreshToken) return fail("오프라인 접근 권한이 필요합니다. 동의 화면에서 모든 권한을 허용하세요.");
    const me = await fetchMe(tok.accessToken);
    if (state.a) {
      const { data, error } = await service.admin.auth.admin.getUserById(state.u);
      const appEmail = normalizedEmail(data.user?.email);
      const microsoftEmails = [normalizedEmail(me.mail), normalizedEmail(me.userPrincipalName)].filter(
        (email): email is string => Boolean(email),
      );
      if (error || !appEmail || !microsoftEmails.includes(appEmail)) {
        console.warn("[ms] 앱 사용자와 Microsoft 계정이 일치하지 않아 연결을 거부했습니다.");
        return fail(ACCOUNT_MISMATCH);
      }
    }
    await saveConnection(service.admin, encKey, {
      userId: state.u,
      refreshToken: tok.refreshToken,
      accountUpn: me.mail || me.userPrincipalName,
      accountName: me.displayName || null,
      scopes: tok.scope || MS_SCOPES.join(" "),
    });
    if (state.a) return mobileConnectionComplete();
    return back(returnTo, "ms_connected", "1");
  } catch (e) {
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 교환 실패 ${e.code} (${e.status}): ${e.description}`);
      return fail(oauthErrorMessage(e.code));
    }
    console.error("[ms] 연결 저장 실패:", e instanceof Error ? e.message : e);
    return fail("연결 정보를 저장하지 못했습니다. 다시 시도하세요.");
  }
}
