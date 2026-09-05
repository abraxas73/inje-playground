// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseEncKey, encryptSecret, decryptSecret } from "@/lib/ms/crypto";
import { OAuthError, type MsAppConfig } from "@/lib/ms/oauth";
import {
  getConnectionStatus, saveConnection, deleteConnection, getAccessTokenForUser, _resetMsTokenCache,
  NotConnectedError, ReconnectRequiredError, TOKEN_CACHE_MAX_MS,
} from "@/lib/ms/connections";

const key = parseEncKey("ab".repeat(32))!;
const app: MsAppConfig = { tenantId: "t", clientId: "c", clientSecret: "s" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** ms_connections 한 행을 메모리에 두고 select/upsert/update/delete 체인을 흉내 낸다 */
function fakeAdmin(initial: Record<string, unknown> | null) {
  const state = { row: initial, updates: [] as Record<string, unknown>[], upserts: [] as { row: Record<string, unknown>; opts: unknown }[], deletes: 0, selects: 0 };
  const from = (table: string) => {
    if (table !== "ms_connections") throw new Error(`unexpected table ${table}`);
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => { state.selects += 1; return { data: state.row, error: null }; } }) }),
      upsert: async (row: Record<string, unknown>, opts: unknown) => { state.upserts.push({ row, opts }); state.row = { ...(state.row ?? {}), ...row }; return { error: null }; },
      update: (patch: Record<string, unknown>) => ({ eq: async () => { state.updates.push(patch); if (state.row) state.row = { ...state.row, ...patch }; return { error: null }; } }),
      delete: () => ({ eq: async () => { state.deletes += 1; state.row = null; return { error: null }; } }),
    };
  };
  return { admin: { from } as unknown as SupabaseClient, state };
}

const connectedRow = (refreshToken = "RT-1") => ({
  user_id: "u-1", account_upn: "kang@innogrid.com", account_name: "강승욱", refresh_token_enc: encryptSecret(refreshToken, key),
  scopes: "offline_access User.Read Files.ReadWrite.All Sites.Read.All", connected_at: "2026-09-05T01:00:00.000Z", last_used_at: null, last_error: null, updated_at: "2026-09-05T01:00:00.000Z",
});

beforeEach(() => _resetMsTokenCache());

describe("getConnectionStatus", () => {
  it("행이 없으면 {connected:false}, 있으면 토큰 없이 상태만", async () => {
    expect(await getConnectionStatus(fakeAdmin(null).admin, "u-1")).toEqual({ connected: false });
    const s = await getConnectionStatus(fakeAdmin(connectedRow()).admin, "u-1");
    expect(s).toEqual({ connected: true, accountUpn: "kang@innogrid.com", accountName: "강승욱", connectedAt: "2026-09-05T01:00:00.000Z", lastUsedAt: null, lastError: null, scopes: ["offline_access", "User.Read", "Files.ReadWrite.All", "Sites.Read.All"] });
    expect(JSON.stringify(s)).not.toContain("refresh");
  });
});

describe("saveConnection / deleteConnection", () => {
  it("refresh 토큰을 암호화해 user_id 기준 upsert하고 last_error를 지운다", async () => {
    const { admin, state } = fakeAdmin(null);
    await saveConnection(admin, key, { userId: "u-1", refreshToken: "RT-new", accountUpn: "a@b.c", accountName: "A", scopes: "x y" });
    expect(state.upserts).toHaveLength(1);
    const { row, opts } = state.upserts[0];
    expect(opts).toEqual({ onConflict: "user_id" });
    expect(row).toMatchObject({ user_id: "u-1", account_upn: "a@b.c", account_name: "A", scopes: "x y", last_error: null, last_used_at: null });
    expect(typeof row.connected_at).toBe("string");
    expect(row.refresh_token_enc).not.toContain("RT-new");
    expect(decryptSecret(row.refresh_token_enc as string, key)).toBe("RT-new");
  });
  it("삭제 후에는 캐시도 비워져 다음 호출이 NotConnectedError", async () => {
    const { admin, state } = fakeAdmin(connectedRow());
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT", expires_in: 3600 }));
    expect(await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl })).toBe("AT");
    await deleteConnection(admin, "u-1");
    expect(state.deletes).toBe(1);
    await expect(getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl })).rejects.toBeInstanceOf(NotConnectedError);
  });
});

describe("getAccessTokenForUser", () => {
  it("미연결이면 NotConnectedError, fetch는 부르지 않는다", async () => {
    const fetchImpl = vi.fn();
    await expect(getAccessTokenForUser(fakeAdmin(null).admin, "u-1", { app, encKey: key, fetchImpl })).rejects.toBeInstanceOf(NotConnectedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refresh로 access 토큰을 받고 last_used_at을 기록하며, 두 번째 호출은 캐시(fetch 1회)", async () => {
    const { admin, state } = fakeAdmin(connectedRow());
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT-1", expires_in: 3600 }));
    let t = 1_800_000_000_000;
    const now = () => t;
    expect(await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now })).toBe("AT-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.get("refresh_token")).toBe("RT-1");
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toEqual({ last_used_at: new Date(t).toISOString(), last_error: null });
    t += TOKEN_CACHE_MAX_MS - 1;
    expect(await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now })).toBe("AT-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(state.updates).toHaveLength(1);
    // 5분이 지나면 다시 발급
    t += 2;
    fetchImpl.mockResolvedValueOnce(json(200, { access_token: "AT-2", expires_in: 3600 }));
    expect(await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now })).toBe("AT-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("짧은 expires_in은 만기 60초 전까지만 캐시한다", async () => {
    const { admin } = fakeAdmin(connectedRow());
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT-1", expires_in: 120 }));
    let t = 1_800_000_000_000;
    const now = () => t;
    await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now });
    t += 59_000;
    await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 2_000;
    await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("응답에 새 refresh_token이 있으면 재암호화해 교체 저장한다", async () => {
    const { admin, state } = fakeAdmin(connectedRow("RT-1"));
    const fetchImpl = vi.fn(async () => json(200, { access_token: "AT", refresh_token: "RT-2", expires_in: 3600 }));
    await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl });
    const patch = state.updates[0];
    expect(typeof patch.refresh_token_enc).toBe("string");
    expect(decryptSecret(patch.refresh_token_enc as string, key)).toBe("RT-2");
    expect(patch.refresh_token_enc).not.toContain("RT-2");
  });
  it("invalid_grant·interaction_required·consent_required는 last_error 기록 후 ReconnectRequiredError", async () => {
    for (const code of ["invalid_grant", "interaction_required", "consent_required"]) {
      _resetMsTokenCache();
      const { admin, state } = fakeAdmin(connectedRow());
      const fetchImpl = vi.fn(async () => json(400, { error: code, error_description: "AADSTS50173" }));
      const err = await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl }).catch((e) => e);
      expect(err).toBeInstanceOf(ReconnectRequiredError);
      expect((err as ReconnectRequiredError).reason).toBe(code);
      expect(state.updates).toEqual([{ last_error: code }]);
    }
  });
  it("그 외 OAuthError는 그대로 던지고 last_error를 건드리지 않는다", async () => {
    const { admin, state } = fakeAdmin(connectedRow());
    const fetchImpl = vi.fn(async () => json(503, { error: "temporarily_unavailable", error_description: "retry" }));
    await expect(getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl })).rejects.toBeInstanceOf(OAuthError);
    expect(state.updates).toEqual([]);
  });
  it("복호화 실패(키 교체 등)는 last_error=decrypt + ReconnectRequiredError, fetch는 부르지 않는다", async () => {
    const { admin, state } = fakeAdmin({ ...connectedRow(), refresh_token_enc: encryptSecret("RT", parseEncKey("cd".repeat(32))!) });
    const fetchImpl = vi.fn();
    const err = await getAccessTokenForUser(admin, "u-1", { app, encKey: key, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ReconnectRequiredError);
    expect((err as ReconnectRequiredError).reason).toBe("decrypt");
    expect(state.updates).toEqual([{ last_error: "decrypt" }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
