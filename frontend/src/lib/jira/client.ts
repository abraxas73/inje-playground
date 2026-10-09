import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/ms/crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptionKey, JiraError } from "./config";
import { refreshToken } from "./oauth";
export { JIRA_SITE, JiraError } from "./config";
export type JiraConnection = { account_id: string; account_name: string; email: string; api_base: string; token_enc: string; connected_at: string; auth_type: string; refresh_token_enc: string | null; expires_at: string | null; scopes?: string[] | null };
export const sealToken = (token: string) => encryptSecret(token, encryptionKey());
function allowedBase(base: string) {
  return /^https:\/\/api\.atlassian\.com\/ex\/jira\/[0-9a-f-]{36}$/.test(base);
}
export async function jiraRequest(base: string, token: string, path: string, init: RequestInit = {}) {
  if (!allowedBase(base) || !path.startsWith("/rest/api/3/")) throw new JiraError("Jira 연결 주소가 올바르지 않습니다.", 500);
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" } });
  } catch {
    throw new JiraError(init.method && init.method !== "GET" ? "Jira 응답을 확인하지 못했습니다. 실제 반영 여부를 새로고침으로 확인한 뒤 다시 시도하세요." : "Jira에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
  if (!res.ok) {
    if (res.status === 401) throw new JiraError("Jira 인증이 만료되었거나 토큰이 올바르지 않습니다. 다시 연결하세요.", 409, "reconnect");
    if (res.status === 403) throw new JiraError("Jira 권한을 확인하거나 Atlassian 계정을 다시 연결하세요.", 403, "forbidden");
    if (res.status === 404) throw new JiraError("이슈를 찾을 수 없거나 접근 권한이 없습니다.", 404);
    if (res.status === 429) throw new JiraError("Jira 요청이 많습니다. 잠시 후 다시 시도하세요.", 429);
    if (res.status === 400) throw new JiraError("Jira가 요청을 처리하지 못했습니다. 필수 입력값이 있는 작업은 Jira에서 처리하세요.", 400);
    throw new JiraError("Jira 요청에 실패했습니다. 잠시 후 다시 시도하세요.");
  }
  return res.status === 204 ? null : res.json();
}

const columns = "account_id,account_name,email,api_base,token_enc,connected_at,auth_type,refresh_token_enc,expires_at,scopes";
export async function loadConnection(admin: SupabaseClient, userId: string): Promise<JiraConnection | null> {
  const { data, error } = await admin.from("jira_connections").select(columns).eq("user_id", userId).maybeSingle();
  if (error) throw new JiraError("Jira 연결 정보를 불러오지 못했습니다.", 503);
  return data as JiraConnection | null;
}
function openToken(token: string) {
  try { return decryptSecret(token, encryptionKey()); }
  catch { throw new JiraError("Atlassian 계정을 다시 연결하세요.", 409, "reconnect"); }
}
function fresh(c: JiraConnection) { return c.expires_at && Date.parse(c.expires_at) > Date.now() + 60_000; }
export async function accessTokenFor(connection: JiraConnection, admin: SupabaseClient, userId: string): Promise<string> {
  if (connection.auth_type !== "oauth" || !connection.refresh_token_enc) throw new JiraError("Atlassian 로그인으로 다시 연결하세요.", 409, "reconnect");
  let token: string;
  if (fresh(connection)) token = openToken(connection.token_enc);
  else {
    // 회전형 refresh token은 한 인스턴스만 갱신한다. 재연결·해제와 경합해도 연결을 되살리지 않는다.
    const lock = randomUUID();
    const now = new Date();
    const { data: claimed, error } = await admin.from("jira_connections").update({ refresh_lock: lock, refresh_lock_until: new Date(now.getTime() + 30_000).toISOString() }).eq("user_id", userId).eq("connected_at", connection.connected_at).eq("token_enc", connection.token_enc).or(`refresh_lock_until.is.null,refresh_lock_until.lt.${now.toISOString()}`).select("user_id").maybeSingle();
    if (error) throw new JiraError("Jira 로그인 갱신을 준비하지 못했습니다.", 503);
    if (!claimed) {
      const latest = await loadConnection(admin, userId);
      if (!latest || latest.auth_type !== "oauth") throw new JiraError("Atlassian 계정을 다시 연결하세요.", 409, "reconnect");
      if (!fresh(latest)) throw new JiraError("Jira 로그인을 갱신 중입니다. 잠시 후 새로고침하세요.", 503);
      if (latest.account_id !== connection.account_id || latest.connected_at !== connection.connected_at) throw new JiraError("Jira 연결이 변경되었습니다. 새로고침하세요.", 409);
      token = openToken(latest.token_enc);
    } else {
      try {
        const result = await refreshToken(openToken(connection.refresh_token_enc));
        const { data: saved, error: saveError } = await admin.from("jira_connections").update({ token_enc: sealToken(result.accessToken), refresh_token_enc: sealToken(result.refreshToken), expires_at: new Date(Date.now() + result.expiresIn * 1000).toISOString(), refresh_lock: null, refresh_lock_until: null }).eq("user_id", userId).eq("refresh_lock", lock).eq("connected_at", connection.connected_at).select("user_id").maybeSingle();
        if (saveError || !saved) throw new JiraError("Jira 로그인 갱신을 저장하지 못했습니다. 다시 연결하세요.", 409, "reconnect");
        token = result.accessToken;
      } catch (e) {
        if (e instanceof JiraError && e.code === "reconnect") await admin.from("jira_connections").delete().eq("user_id", userId).eq("refresh_lock", lock).eq("connected_at", connection.connected_at);
        throw e;
      } finally {
        await admin.from("jira_connections").update({ refresh_lock: null, refresh_lock_until: null }).eq("user_id", userId).eq("refresh_lock", lock);
      }
    }
  }
  return token;
}
export async function connectionClient(connection: JiraConnection, admin: SupabaseClient, userId: string): Promise<JiraClient> {
  const token = await accessTokenFor(connection, admin, userId);
  return (path, init) => jiraRequest(connection.api_base, token, path, init);
}
export type JiraClient = (path: string, init?: RequestInit) => ReturnType<typeof jiraRequest>;
