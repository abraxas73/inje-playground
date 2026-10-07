import { JIRA_SCOPES, JIRA_SITE, JiraError, oauthConfig } from "./config";
export type OAuthTokens = { accessToken: string; refreshToken: string; expiresIn: number };
export function authorizeUrl(state: string, origin?: string) {
  const cfg = oauthConfig(origin);
  return "https://auth.atlassian.com/authorize?" + new URLSearchParams({ audience: "api.atlassian.com", client_id: cfg.clientId, scope: JIRA_SCOPES.join(" "), redirect_uri: cfg.redirectUri, state, response_type: "code", prompt: "consent" });
}
export async function tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
  const cfg = oauthConfig();
  let res: Response;
  try { res = await fetch("https://auth.atlassian.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) }); }
  catch { throw new JiraError("Atlassian 로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요."); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (j.error === "invalid_grant") throw new JiraError("Atlassian 로그인이 만료되었습니다. 다시 연결하세요.", 409, "reconnect");
    throw new JiraError("Atlassian 로그인을 완료하지 못했습니다. 관리자 설정을 확인하거나 다시 시도하세요.");
  }
  if (typeof j.access_token !== "string" || !j.access_token || typeof j.refresh_token !== "string" || !j.refresh_token || !Number.isFinite(j.expires_in) || j.expires_in <= 60) throw new JiraError("Atlassian 자동 갱신 권한이 필요합니다. 다시 연결하세요.", 409, "reconnect");
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresIn: j.expires_in };
}
export const exchangeCode = (code: string, origin?: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: oauthConfig(origin).redirectUri });
export const refreshToken = (refresh: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
export async function companyResource(accessToken: string) {
  const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new JiraError("Jira 사이트 접근 권한을 확인하지 못했습니다.");
  const resources = await res.json();
  const resource = Array.isArray(resources) && resources.find(r => r.url?.replace(/\/$/, "") === JIRA_SITE && /^[0-9a-f-]{36}$/.test(r.id) && JIRA_SCOPES.filter(s => s.endsWith(":jira-work") || s === "read:jira-user").every(s => r.scopes?.includes(s)));
  if (!resource) throw new JiraError("회사 Jira 사이트(pms-innogrid.atlassian.net)를 선택하고 업무 조회·변경 권한에 동의하세요.", 403);
  return `https://api.atlassian.com/ex/jira/${resource.id}`;
}
