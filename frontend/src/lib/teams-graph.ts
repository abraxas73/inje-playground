/**
 * Microsoft Graph app-only(client credentials) 클라이언트 — 서버 전용.
 * 시크릿은 호출자가 env(TEAMS_GRAPH_CLIENT_SECRET)에서 읽어 넘긴다.
 */
import type { Member } from "@/lib/members/types";
import type { FetchLike } from "@/lib/notify/types";

export interface GraphAppConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_SKEW_MS = 60_000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** 테스트용: 토큰 캐시 비우기 */
export function _resetGraphTokenCache() {
  tokenCache.clear();
}

export async function getGraphAppToken(
  cfg: GraphAppConfig,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now
): Promise<string> {
  const key = `${cfg.tenantId}:${cfg.clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - TOKEN_SKEW_MS > now()) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetchImpl(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Graph 토큰 발급 실패 (${res.status}): ${text}`);

  const data = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Graph 토큰 응답에 access_token이 없습니다.");

  tokenCache.set(key, { token: data.access_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

interface GraphPage {
  value?: unknown[];
  "@odata.nextLink"?: string;
}

/** 주어진 키 순서대로 첫 번째 "비어 있지 않은 문자열" 값을 돌려준다(공백만 있는 값은 건너뜀). */
function firstString(u: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = u[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

const ID_KEYS = ["id", "Id"] as const;
const NAME_KEYS = ["displayName", "DisplayName", "name", "Name"] as const;
const EMAIL_KEYS = ["mail", "Mail", "userPrincipalName", "UserPrincipalName", "email", "Email"] as const;

/**
 * Graph/커넥터 사용자 객체 목록 → Member[].
 * 키는 camelCase(displayName/mail/userPrincipalName), PascalCase(DisplayName/Mail/…), 정규화(name/email) 모두 허용.
 * id 또는 이름이 없는 항목은 제외. 이메일은 EMAIL_KEYS 순서의 평탄한 폴백(빈 문자열·null 건너뜀). 이름순(ko) 정렬.
 */
export function normalizeGraphUsers(users: unknown[]): Member[] {
  const members: Member[] = [];
  for (const raw of users) {
    if (!raw || typeof raw !== "object") continue;
    const u = raw as Record<string, unknown>;
    const id = firstString(u, ID_KEYS);
    const name = firstString(u, NAME_KEYS);
    if (!id || !name) continue;
    members.push({ id, name, email: firstString(u, EMAIL_KEYS) });
  }
  return members.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 그룹(팀)의 사용자 멤버 전체 — 페이지네이션, mail→UPN 폴백, 이름순 */
export async function listGroupMembers(
  cfg: GraphAppConfig,
  groupId: string,
  fetchImpl: FetchLike = fetch
): Promise<Member[]> {
  const token = await getGraphAppToken(cfg, fetchImpl);
  const users: unknown[] = [];

  let url: string | undefined =
    `${GRAPH_BASE}/groups/${encodeURIComponent(groupId)}/members/microsoft.graph.user` +
    `?$select=id,displayName,mail,userPrincipalName&$top=999`;

  while (url) {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Graph API 오류 (${res.status}): ${text}`);

    const page = JSON.parse(text) as GraphPage;
    users.push(...(page.value ?? []));
    url = page["@odata.nextLink"];
  }

  return normalizeGraphUsers(users);
}
