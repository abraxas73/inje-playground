import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { verifyState } from "@/lib/ms/crypto";
import { oauthConfig, JiraError } from "@/lib/jira/config";
import { exchangeCode, companyResourceInfo } from "@/lib/jira/oauth";
import { jiraRequest, sealToken } from "@/lib/jira/client";
import { jiraFailure } from "@/lib/jira/route";
import { jiraMobileComplete } from "@/lib/jira/mobile-return";
import { logAudit } from "@/lib/audit";
export const runtime = "nodejs";
const COOKIE = "jira_oauth_state";
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return new NextResponse('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jira 연결 안내</title><body><h1>로그인 상태를 확인할 수 없습니다</h1><p>앱을 업데이트하거나 이 브라우저에서 로그인한 뒤 Jira를 다시 연결하세요.</p><a href="/settings#jira">설정으로 이동</a></body></html>', { status: auth.response.status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  try {
    const cfg = oauthConfig(request.nextUrl.origin);
    const finish = (response: NextResponse) => { response.cookies.set(COOKIE, "", { httpOnly: true, secure: cfg.origin.startsWith("https:"), sameSite: "lax", path: "/api/jira", maxAge: 0 }); response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer"); return response; };
    const back = (error?: string) => { const url = new URL("/settings", cfg.origin); url.searchParams.set(error ? "jira_error" : "jira_connected", error || "1"); url.hash = "jira"; return finish(NextResponse.redirect(url, 302)); };
    const state = verifyState(request.nextUrl.searchParams.get("state") || "", cfg.encKey);
    if (request.nextUrl.origin !== cfg.origin || !state || state.u !== auth.userId || state.n !== request.cookies.get(COOKIE)?.value) return back("연결 요청이 만료되었거나 유효하지 않습니다. 다시 연결하세요.");
    if (request.nextUrl.searchParams.has("error")) return back("Atlassian 연결이 취소되었거나 허용되지 않았습니다.");
    const code = request.nextUrl.searchParams.get("code");
    if (!code || code.length > 4096) return back("인증 코드가 없습니다. 다시 연결하세요.");
    try {
      const tokens = await exchangeCode(code, cfg.origin);
      const { base, scopes } = await companyResourceInfo(tokens.accessToken);
      const me = await jiraRequest(base, tokens.accessToken, "/rest/api/3/myself");
      const user = await auth.admin.auth.admin.getUserById(auth.userId);
      const email = user.data.user?.email;
      if (user.error || !email) throw new JiraError("회사 로그인 이메일을 확인하지 못했습니다.", 503);
      if (!me?.accountId || me.active === false || typeof me.emailAddress !== "string" || me.emailAddress.toLowerCase() !== email.toLowerCase()) throw new JiraError("앱에 로그인한 회사 이메일과 같은 Atlassian 계정으로 연결하세요.", 400);
      const { error } = await auth.admin.from("jira_connections").upsert({ user_id: auth.userId, account_id: me.accountId, account_name: me.displayName || email, email, api_base: base, scopes, auth_type: "oauth", token_enc: sealToken(tokens.accessToken), refresh_token_enc: sealToken(tokens.refreshToken), expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(), connected_at: new Date().toISOString(), refresh_lock: null, refresh_lock_until: null, privacy_next_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw new JiraError("Jira 연결을 저장하지 못했습니다.", 503);
      await logAudit(auth.admin, request, { userId: auth.userId, action: "Jira Atlassian 로그인 연결", category: "auth" });
      return state.a ? finish(jiraMobileComplete()) : back();
    } catch (e) { return back(e instanceof JiraError ? e.message : "Atlassian 연결을 완료하지 못했습니다. 다시 시도하세요."); }
  } catch (e) { return jiraFailure(e); }
}
