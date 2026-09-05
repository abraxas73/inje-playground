/**
 * 사용자별 Microsoft 계정 연결(ms_connections)과 access 토큰 발급(스펙 §3.2).
 * refresh 토큰은 암호문으로만 저장·조회하고, access 토큰은 서버 메모리에 최대 5분 캐시한다.
 * 이 모듈은 토큰을 반환만 하며 로그에 쓰지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FetchLike } from "@/lib/notify/types";
import type { MsConnectionStatus } from "@/types/ms";
import { decryptSecret, encryptSecret } from "./crypto";
import { OAuthError, refreshAccessToken, type MsAppConfig } from "./oauth";

export class NotConnectedError extends Error {
  constructor() {
    super("Microsoft 계정이 연결되지 않았습니다.");
    this.name = "NotConnectedError";
  }
}

/** refresh 토큰이 더는 유효하지 않아(또는 복호화 불가) 사용자가 다시 연결해야 한다 */
export class ReconnectRequiredError extends Error {
  constructor(public readonly reason: string) {
    super("연결이 만료되었습니다. 다시 연결하세요.");
    this.name = "ReconnectRequiredError";
  }
}

/** 이 코드들은 refresh 토큰 자체가 죽은 것이라 재연결 안내로 바꾼다. 그 외(네트워크·5xx)는 그대로 던진다 */
export const RECONNECT_CODES = new Set(["invalid_grant", "interaction_required", "consent_required"]);

export const TOKEN_CACHE_MAX_MS = 5 * 60_000;
const TOKEN_SKEW_MS = 60_000;
const TABLE = "ms_connections";
const STATUS_COLUMNS = "user_id, account_upn, account_name, scopes, connected_at, last_used_at, last_error";

interface StatusRow {
  user_id: string;
  account_upn: string | null;
  account_name: string | null;
  scopes: string;
  connected_at: string;
  last_used_at: string | null;
  last_error: string | null;
}

const tokenCache = new Map<string, { token: string; exp: number }>();

/** 테스트용 */
export function _resetMsTokenCache() {
  tokenCache.clear();
}

export async function getConnectionStatus(admin: SupabaseClient, userId: string): Promise<MsConnectionStatus> {
  const { data, error } = await admin.from(TABLE).select(STATUS_COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`ms_connections 조회 실패: ${error.message}`);
  if (!data) return { connected: false };
  const r = data as StatusRow;
  return {
    connected: true,
    accountUpn: r.account_upn,
    accountName: r.account_name,
    connectedAt: r.connected_at,
    lastUsedAt: r.last_used_at,
    lastError: r.last_error,
    scopes: r.scopes.split(" ").filter(Boolean),
  };
}

export async function saveConnection(
  admin: SupabaseClient,
  encKey: Buffer,
  c: { userId: string; refreshToken: string; accountUpn: string | null; accountName: string | null; scopes: string },
): Promise<void> {
  const { error } = await admin.from(TABLE).upsert(
    {
      user_id: c.userId,
      refresh_token_enc: encryptSecret(c.refreshToken, encKey),
      account_upn: c.accountUpn,
      account_name: c.accountName,
      scopes: c.scopes,
      connected_at: new Date().toISOString(),
      last_used_at: null,
      last_error: null,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`ms_connections 저장 실패: ${error.message}`);
  tokenCache.delete(c.userId);
}

export async function deleteConnection(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from(TABLE).delete().eq("user_id", userId);
  if (error) throw new Error(`ms_connections 삭제 실패: ${error.message}`);
  tokenCache.delete(userId);
}

export interface TokenDeps {
  app: MsAppConfig;
  encKey: Buffer;
  fetchImpl?: FetchLike;
  now?: () => number;
}

async function markError(admin: SupabaseClient, userId: string, code: string): Promise<void> {
  const { error } = await admin.from(TABLE).update({ last_error: code }).eq("user_id", userId);
  if (error) console.error("[ms] ms_connections last_error 기록 실패:", error.message);
}

/**
 * 사용자 위임 access 토큰. 순서: 행 없음 → NotConnectedError / 캐시 히트 → 반환 / refresh 발급 → 캐시·last_used_at·(새 refresh면 교체).
 * invalid_grant 계열·복호화 실패는 last_error를 남기고 ReconnectRequiredError.
 */
export async function getAccessTokenForUser(admin: SupabaseClient, userId: string, deps: TokenDeps): Promise<string> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const { data, error } = await admin.from(TABLE).select("refresh_token_enc").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`ms_connections 조회 실패: ${error.message}`);
  if (!data) throw new NotConnectedError();

  const cached = tokenCache.get(userId);
  if (cached && cached.exp > now()) return cached.token;

  let refreshToken: string;
  try {
    refreshToken = decryptSecret((data as { refresh_token_enc: string }).refresh_token_enc, deps.encKey);
  } catch {
    await markError(admin, userId, "decrypt");
    throw new ReconnectRequiredError("decrypt");
  }

  let tok;
  try {
    tok = await refreshAccessToken(deps.app, refreshToken, fetchImpl);
  } catch (e) {
    if (e instanceof OAuthError && RECONNECT_CODES.has(e.code)) {
      await markError(admin, userId, e.code);
      throw new ReconnectRequiredError(e.code);
    }
    throw e;
  }

  const ttl = Math.max(0, Math.min(tok.expiresIn * 1000 - TOKEN_SKEW_MS, TOKEN_CACHE_MAX_MS));
  tokenCache.set(userId, { token: tok.accessToken, exp: now() + ttl });

  const patch: Record<string, unknown> = { last_used_at: new Date(now()).toISOString(), last_error: null };
  if (tok.refreshToken && tok.refreshToken !== refreshToken) patch.refresh_token_enc = encryptSecret(tok.refreshToken, deps.encKey);
  const { error: upErr } = await admin.from(TABLE).update(patch).eq("user_id", userId);
  if (upErr) console.error("[ms] ms_connections 갱신 실패:", upErr.message); // 토큰은 이미 받았으니 진행

  return tok.accessToken;
}
