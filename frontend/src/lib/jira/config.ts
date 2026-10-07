import { createHash } from "node:crypto";
import { parseEncKey } from "@/lib/ms/crypto";
export const JIRA_SITE = "https://pms-innogrid.atlassian.net";
export const JIRA_SCOPES = ["read:jira-user", "read:jira-work", "write:jira-work", "report:personal-data", "offline_access"];
export class JiraError extends Error {
  constructor(message: string, public status = 502, public code = "jira_error") { super(message); }
}
export function encryptionKey() {
  const key = parseEncKey(process.env.JIRA_TOKEN_ENC_KEY ?? process.env.MS_TOKEN_ENC_KEY);
  if (!key) throw new JiraError("Jira 암호화 설정이 필요합니다. 관리자에게 문의하세요.", 503);
  return createHash("sha256").update("jira-oauth:").update(key).digest();
}
export function oauthConfig(requestOrigin?: string) {
  const clientId = process.env.JIRA_CLIENT_ID?.trim();
  const clientSecret = process.env.JIRA_CLIENT_SECRET?.trim();
  const redirectUri = process.env.JIRA_REDIRECT_URI?.trim() || "https://inje-playground.vercel.app/api/jira/callback";
  if (!clientId || !clientSecret) throw new JiraError("회사 Jira 로그인 설정을 준비 중입니다. 관리자에게 문의하세요.", 503, "not_configured");
  const url = new URL(redirectUri);
  if (url.pathname !== "/api/jira/callback" || url.search || url.hash || (url.protocol !== "https:" && url.hostname !== "localhost")) throw new JiraError("Jira 콜백 주소 설정을 확인하세요.", 503);
  if (requestOrigin && ![url.origin, "https://innocrew.innogrid.com"].includes(requestOrigin)) throw new JiraError("허용되지 않은 Jira 연결 주소입니다.", 400);
  if (requestOrigin) { const allowed = new URL(requestOrigin); url.host = allowed.host; url.protocol = allowed.protocol; }
  return { clientId, clientSecret, redirectUri: url.toString(), origin: url.origin, encKey: encryptionKey() };
}
export function oauthConfigured() { try { oauthConfig(); return true; } catch { return false; } }
