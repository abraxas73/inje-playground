// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { MS_SCOPES, OAuthError, oauthErrorMessage, buildAuthorizeUrl, exchangeCode, refreshAccessToken, fetchMe, type MsAppConfig } from "@/lib/ms/oauth";
import { resolveMsConfig, missingConfigMessage, MS_SETTING_KEYS } from "@/lib/ms/config";

const cfg: MsAppConfig = { tenantId: "tenant-1", clientId: "client-1", clientSecret: "s3cret" };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("buildAuthorizeUrl", () => {
  it("v2.0 authorize 엔드포인트에 스코프 4개·state·redirect_uri·prompt=select_account", () => {
    const u = new URL(buildAuthorizeUrl({ tenantId: "tenant-1", clientId: "client-1", redirectUri: "http://localhost:3003/api/ms/callback", state: "abc.def" }));
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize");
    expect(u.searchParams.get("client_id")).toBe("client-1");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("response_mode")).toBe("query");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3003/api/ms/callback");
    expect(u.searchParams.get("scope")).toBe("offline_access User.Read Files.ReadWrite.All Sites.Read.All");
    expect(u.searchParams.get("state")).toBe("abc.def");
    expect(u.searchParams.get("prompt")).toBe("select_account");
    expect([...MS_SCOPES]).toEqual(["offline_access", "User.Read", "Files.ReadWrite.All", "Sites.Read.All"]);
  });
});

describe("exchangeCode", () => {
  it("authorization_code 본문을 x-www-form-urlencoded로 보내고 토큰을 파싱한다", async () => {
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT", refresh_token: "RT", expires_in: 3599, scope: "Files.ReadWrite.All Sites.Read.All User.Read" }));
    const r = await exchangeCode(cfg, { code: "CODE", redirectUri: "http://localhost:3003/api/ms/callback" }, fetchImpl);
    expect(r).toEqual({ accessToken: "AT", refreshToken: "RT", expiresIn: 3599, scope: "Files.ReadWrite.All Sites.Read.All User.Read" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const p = new URLSearchParams(init.body as string);
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(p.get("code")).toBe("CODE");
    expect(p.get("redirect_uri")).toBe("http://localhost:3003/api/ms/callback");
    expect(p.get("client_id")).toBe("client-1");
    expect(p.get("client_secret")).toBe("s3cret");
    expect(p.get("scope")).toBe("offline_access User.Read Files.ReadWrite.All Sites.Read.All");
  });
  it("오류 응답은 OAuthError(code, description, status)", async () => {
    const fetchImpl = vi.fn(async () => json(400, { error: "invalid_grant", error_description: "AADSTS70000: The provided value for the 'code' parameter is not valid." }));
    const err = await exchangeCode(cfg, { code: "x", redirectUri: "http://localhost:3003/api/ms/callback" }, fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err).toMatchObject({ code: "invalid_grant", status: 400 });
    expect((err as OAuthError).description).toContain("AADSTS70000");
  });
  it("JSON이 아닌 오류 본문은 http_{status} 코드", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>gateway</html>", { status: 502 }));
    await expect(exchangeCode(cfg, { code: "x", redirectUri: "r" }, fetchImpl)).rejects.toMatchObject({ code: "http_502", status: 502 });
  });
  it("access_token이 없는 200 응답은 invalid_response", async () => {
    const fetchImpl = vi.fn(async () => json(200, { token_type: "Bearer" }));
    await expect(exchangeCode(cfg, { code: "x", redirectUri: "r" }, fetchImpl)).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("refreshAccessToken", () => {
  it("refresh_token 본문을 보내고, 응답에 refresh_token이 없으면 null", async () => {
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT2", expires_in: "3600" }));
    const r = await refreshAccessToken(cfg, "RT-old", fetchImpl);
    expect(r).toEqual({ accessToken: "AT2", refreshToken: null, expiresIn: 3600, scope: "" });
    const p = new URLSearchParams((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(p.get("grant_type")).toBe("refresh_token");
    expect(p.get("refresh_token")).toBe("RT-old");
    expect(p.get("scope")).toBe("offline_access User.Read Files.ReadWrite.All Sites.Read.All");
  });
});

describe("fetchMe", () => {
  it("GET /me?$select=… 에 Bearer를 붙이고 UPN·이름·mail을 돌려준다", async () => {
    const fetchImpl = vi.fn(async () => json(200, { id: "oid-1", userPrincipalName: "kang@innogrid.com", displayName: "강승욱", mail: null }));
    expect(await fetchMe("AT", fetchImpl)).toEqual({ id: "oid-1", userPrincipalName: "kang@innogrid.com", displayName: "강승욱", mail: null });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,displayName,mail");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
  });
  it("실패는 OAuthError(me_failed)", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: { code: "InvalidAuthenticationToken" } }));
    await expect(fetchMe("AT", fetchImpl)).rejects.toMatchObject({ code: "me_failed", status: 401 });
  });
});

describe("oauthErrorMessage", () => {
  it("코드별 한국어 문구, 모르는 코드는 코드를 그대로 보여준다", () => {
    expect(oauthErrorMessage("access_denied")).toBe("연결이 취소되었습니다.");
    expect(oauthErrorMessage("invalid_grant")).toBe("연결이 만료되었습니다. 다시 연결하세요.");
    expect(oauthErrorMessage("interaction_required")).toBe("연결이 만료되었습니다. 다시 연결하세요.");
    expect(oauthErrorMessage("invalid_client")).toContain("클라이언트 ID·시크릿");
    expect(oauthErrorMessage("temporarily_unavailable")).toBe("Microsoft 로그인 오류(temporarily_unavailable)");
  });
});

describe("resolveMsConfig", () => {
  const settings = { teams_tenant_id: "tenant-1", teams_graph_client_id: "client-1" };
  const env = { TEAMS_GRAPH_CLIENT_SECRET: "s3cret", MS_TOKEN_ENC_KEY: "ab".repeat(32) };
  it("settings 2개 + env 2개가 모두 있으면 app·encKey", () => {
    const r = resolveMsConfig(settings, env);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.app).toEqual({ tenantId: "tenant-1", clientId: "client-1", clientSecret: "s3cret" });
      expect(r.config.encKey).toHaveLength(32);
    }
    expect([...MS_SETTING_KEYS]).toEqual(["teams_tenant_id", "teams_graph_client_id"]);
  });
  it("누락 항목명을 순서대로 모으고, 형식이 틀린 키도 누락으로 본다", () => {
    expect(resolveMsConfig({}, {})).toEqual({ ok: false, missing: ["teams_tenant_id", "teams_graph_client_id", "env TEAMS_GRAPH_CLIENT_SECRET", "env MS_TOKEN_ENC_KEY"] });
    expect(resolveMsConfig(settings, { ...env, MS_TOKEN_ENC_KEY: "short" })).toEqual({ ok: false, missing: ["env MS_TOKEN_ENC_KEY"] });
    expect(resolveMsConfig({ ...settings, teams_tenant_id: "  " }, env)).toEqual({ ok: false, missing: ["teams_tenant_id"] });
    expect(missingConfigMessage(["env MS_TOKEN_ENC_KEY"])).toBe("Microsoft 연동 설정이 누락되었습니다: env MS_TOKEN_ENC_KEY");
  });
});
