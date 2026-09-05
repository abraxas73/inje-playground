/**
 * Microsoft Identity Platform v2.0 — 위임(authorization code) 흐름(스펙 §3.1). 서버 전용.
 * 토큰·시크릿은 절대 로그에 남기지 않는다. 오류는 OAuthError(code)로 정규화하고 클라이언트에는 oauthErrorMessage(code)만 준다.
 */
import type { FetchLike } from "@/lib/notify/types";
import { GRAPH_BASE } from "@/lib/teams-graph";

export const MS_SCOPES = ["offline_access", "User.Read", "Files.ReadWrite.All", "Sites.Read.All"] as const;
const SCOPE = MS_SCOPES.join(" ");
const LOGIN_BASE = "https://login.microsoftonline.com";

export interface MsAppConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** OAuth 오류를 code로 정규화한다. message는 code만 담고, description(Azure error_description)은 서버 로그 전용이다. */
export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    /** Azure error_description — 서버 로그 전용 */
    public readonly description: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "OAuthError";
  }
}

/** 클라이언트에 보여줄 한국어 문구(스펙 §9) */
export function oauthErrorMessage(code: string): string {
  switch (code) {
    case "access_denied":
      return "연결이 취소되었습니다.";
    case "invalid_grant":
    case "interaction_required":
    case "consent_required":
      return "연결이 만료되었습니다. 다시 연결하세요.";
    case "invalid_client":
    case "unauthorized_client":
      return "앱 등록 설정이 잘못되었습니다(클라이언트 ID·시크릿). 관리자에게 문의하세요.";
    default:
      return `Microsoft 로그인 오류(${code})`;
  }
}

export function buildAuthorizeUrl(p: { tenantId: string; clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    response_type: "code",
    redirect_uri: p.redirectUri,
    response_mode: "query",
    scope: SCOPE,
    state: p.state,
    prompt: "select_account",
  });
  return `${LOGIN_BASE}/${encodeURIComponent(p.tenantId)}/oauth2/v2.0/authorize?${q.toString()}`;
}

export interface TokenResult {
  accessToken: string;
  /** offline_access 미동의 등으로 없을 수 있다 */
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}

async function postToken(cfg: MsAppConfig, params: Record<string, string>, fetchImpl: FetchLike): Promise<TokenResult> {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params });
  const res = await fetchImpl(`${LOGIN_BASE}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // 게이트웨이 오류 등 JSON이 아닌 본문 — 빈 객체로 두고 아래에서 http_{status}로 처리
  }
  if (!res.ok) {
    const code = typeof j.error === "string" ? j.error : `http_${res.status}`;
    const description = typeof j.error_description === "string" ? j.error_description : text.slice(0, 500);
    throw new OAuthError(code, description, res.status);
  }
  if (typeof j.access_token !== "string") throw new OAuthError("invalid_response", "토큰 응답에 access_token이 없습니다.", res.status);
  const expiresRaw = Number(j.expires_in);
  return {
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : null,
    expiresIn: Number.isFinite(expiresRaw) && expiresRaw > 0 ? expiresRaw : 3600,
    scope: typeof j.scope === "string" ? j.scope : "",
  };
}

export function exchangeCode(cfg: MsAppConfig, p: { code: string; redirectUri: string }, fetchImpl: FetchLike = fetch): Promise<TokenResult> {
  return postToken(cfg, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, scope: SCOPE }, fetchImpl);
}

export function refreshAccessToken(cfg: MsAppConfig, refreshToken: string, fetchImpl: FetchLike = fetch): Promise<TokenResult> {
  return postToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPE }, fetchImpl);
}

export interface MsMe {
  id: string;
  userPrincipalName: string;
  displayName: string;
  mail: string | null;
}

export async function fetchMe(accessToken: string, fetchImpl: FetchLike = fetch): Promise<MsMe> {
  const res = await fetchImpl(`${GRAPH_BASE}/me?$select=id,userPrincipalName,displayName,mail`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new OAuthError("me_failed", `GET /me ${res.status}`, res.status);
  const j = (await res.json()) as Record<string, unknown>;
  return {
    id: String(j.id ?? ""),
    userPrincipalName: String(j.userPrincipalName ?? ""),
    displayName: String(j.displayName ?? ""),
    mail: typeof j.mail === "string" && j.mail ? j.mail : null,
  };
}
