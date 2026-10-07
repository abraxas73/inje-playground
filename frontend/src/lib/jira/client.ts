import { createHash } from "node:crypto";
import { decryptSecret, encryptSecret, parseEncKey } from "@/lib/ms/crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const JIRA_SITE = "https://pms-innogrid.atlassian.net";
export class JiraError extends Error {
  constructor(message: string, public status = 502, public code = "jira_error") { super(message); }
}
export type JiraConnection = { account_id: string; account_name: string; email: string; api_base: string; token_enc: string; connected_at: string };
function encryptionKey() {
  const key = parseEncKey(process.env.JIRA_TOKEN_ENC_KEY ?? process.env.MS_TOKEN_ENC_KEY);
  if (!key) throw new JiraError("Jira 토큰 암호화 설정이 필요합니다. 관리자에게 문의하세요.", 503);
  return createHash("sha256").update("jira-api-token:").update(key).digest();
}
export const sealToken = (token: string) => encryptSecret(token, encryptionKey());
function allowedBase(base: string) {
  return base === JIRA_SITE || /^https:\/\/api\.atlassian\.com\/ex\/jira\/[0-9a-f-]{36}$/.test(base);
}
export async function jiraRequest(base: string, email: string, token: string, path: string, init: RequestInit = {}) {
  if (!allowedBase(base) || !path.startsWith("/rest/api/3/")) throw new JiraError("Jira 연결 주소가 올바르지 않습니다.", 500);
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`, Accept: "application/json", "Content-Type": "application/json" } });
  } catch {
    throw new JiraError(init.method && init.method !== "GET" ? "Jira 응답을 확인하지 못했습니다. 실제 반영 여부를 새로고침으로 확인한 뒤 다시 시도하세요." : "Jira에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
  if (!res.ok) {
    if (res.status === 401) throw new JiraError("Jira 인증이 만료되었거나 토큰이 올바르지 않습니다. 다시 연결하세요.", 409, "reconnect");
    if (res.status === 403) throw new JiraError("Jira 권한 또는 API 토큰 범위를 확인하세요.", 403, "forbidden");
    if (res.status === 404) throw new JiraError("이슈를 찾을 수 없거나 접근 권한이 없습니다.", 404);
    if (res.status === 429) throw new JiraError("Jira 요청이 많습니다. 잠시 후 다시 시도하세요.", 429);
    if (res.status === 400) throw new JiraError("Jira가 요청을 처리하지 못했습니다. 필수 입력값이 있는 작업은 Jira에서 처리하세요.", 400);
    throw new JiraError("Jira 요청에 실패했습니다. 잠시 후 다시 시도하세요.");
  }
  return res.status === 204 ? null : res.json();
}
export async function validateToken(email: string, token: string) {
  let base = JIRA_SITE;
  let me;
  try { me = await jiraRequest(base, email, token, "/rest/api/3/myself"); }
  catch (e) {
    if (!(e instanceof JiraError) || ![403, 409].includes(e.status)) throw e;
    // 범위가 지정된 개인 API 토큰은 Atlassian API 게이트웨이를 사용한다.
    const tenant = await fetch(`${JIRA_SITE}/_edge/tenant_info`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!tenant.ok) throw e;
    const { cloudId } = await tenant.json();
    if (typeof cloudId !== "string" || !/^[0-9a-f-]{36}$/.test(cloudId)) throw e;
    base = `https://api.atlassian.com/ex/jira/${cloudId}`;
    me = await jiraRequest(base, email, token, "/rest/api/3/myself");
  }
  if (!me?.accountId || me.active === false || typeof me.emailAddress !== "string" || me.emailAddress.toLowerCase() !== email.toLowerCase()) {
    throw new JiraError("로그인한 회사 이메일과 일치하는 본인의 Jira API 토큰을 입력하세요.", 400);
  }
  return { account_id: String(me.accountId), account_name: String(me.displayName || email), email, api_base: base };
}
export async function loadConnection(admin: SupabaseClient, userId: string): Promise<JiraConnection | null> {
  const { data, error } = await admin.from("jira_connections").select("account_id,account_name,email,api_base,token_enc,connected_at").eq("user_id", userId).maybeSingle();
  if (error) throw new JiraError("Jira 연결 정보를 불러오지 못했습니다.", 503);
  return data as JiraConnection | null;
}
export function connectionClient(connection: JiraConnection) {
  let token: string;
  try { token = decryptSecret(connection.token_enc, encryptionKey()); }
  catch { throw new JiraError("Jira 계정을 다시 연결해 주세요.", 409, "reconnect"); }
  return (path: string, init?: RequestInit) => jiraRequest(connection.api_base, connection.email, token, path, init);
}
export type JiraClient = ReturnType<typeof connectionClient>;
