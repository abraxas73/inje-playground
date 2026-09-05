import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { verifyState } from "@/lib/ms/crypto";
import { exchangeCode, fetchMe, MS_SCOPES, OAuthError, oauthErrorMessage } from "@/lib/ms/oauth";
import { appendQuery, requestOrigin, resolveRedirectOrigin, sanitizeReturnTo } from "@/lib/ms/origin";
import { saveConnection } from "@/lib/ms/connections";

export const runtime = "nodejs";

const EXPIRED = "연결 요청이 만료되었습니다. 다시 시도하세요.";

/**
 * GET /api/ms/callback?code&state[&error&error_description] — Azure에서 돌아오는 곳(스펙 §3.1).
 * 성공: returnTo?ms_connected=1 / 실패: returnTo?ms_error=<한국어 문구>. 토큰·error_description은 응답에 싣지 않는다.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const origin = resolveRedirectOrigin(requestOrigin(request));
  if (!origin) return NextResponse.json({ error: "허용되지 않은 오리진입니다." }, { status: 400 });

  const cfg = await loadMsConfig(await createServerSupabase());
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }
  const { app, encKey } = cfg.config;
  const q = request.nextUrl.searchParams;
  const back = (path: string, key: "ms_connected" | "ms_error", value: string) => NextResponse.redirect(`${origin}${appendQuery(path, key, value)}`, 302);

  // state: 서명·만기·세션 사용자 일치. 어긋나면 returnTo를 믿을 수 없으니 기본(/settings)으로 보낸다.
  const state = verifyState(q.get("state") ?? "", encKey);
  if (!state || state.u !== auth.userId) return back(sanitizeReturnTo(null), "ms_error", EXPIRED);
  const returnTo = sanitizeReturnTo(state.r);

  const azureError = q.get("error");
  if (azureError) {
    console.warn(`[ms] authorize 거부 ${azureError}: ${q.get("error_description") ?? ""}`);
    return back(returnTo, "ms_error", oauthErrorMessage(azureError));
  }
  const code = q.get("code");
  if (!code) return back(returnTo, "ms_error", "인증 코드가 없습니다. 다시 시도하세요.");

  try {
    const tok = await exchangeCode(app, { code, redirectUri: `${origin}/api/ms/callback` });
    if (!tok.refreshToken) return back(returnTo, "ms_error", "오프라인 접근 권한이 필요합니다. 동의 화면에서 모든 권한을 허용하세요.");
    const me = await fetchMe(tok.accessToken);
    await saveConnection(auth.admin, encKey, {
      userId: auth.userId,
      refreshToken: tok.refreshToken,
      accountUpn: me.userPrincipalName || me.mail,
      accountName: me.displayName || null,
      scopes: tok.scope || MS_SCOPES.join(" "),
    });
    return back(returnTo, "ms_connected", "1");
  } catch (e) {
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 교환 실패 ${e.code} (${e.status}): ${e.description}`);
      return back(returnTo, "ms_error", oauthErrorMessage(e.code));
    }
    console.error("[ms] 연결 저장 실패:", e instanceof Error ? e.message : e);
    return back(returnTo, "ms_error", "연결 정보를 저장하지 못했습니다. 다시 시도하세요.");
  }
}
