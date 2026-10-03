// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: "" as string, created: [] as { opts: unknown; getUser: ReturnType<typeof vi.fn> }[] }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(m.auth ? { authorization: m.auth } : {}),
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, _k: string, opts: unknown) => {
    const getUser = vi.fn(async (jwt?: string) => ({ data: { user: jwt ? { id: `user-of:${jwt}` } : null }, error: null }));
    m.created.push({ opts, getUser });
    return { auth: { getUser } };
  },
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ kind: "cookie" }) }));
import { bearerToken, createServerSupabase } from "@/lib/supabase-server";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln-Nature_x";
beforeEach(() => { m.auth = ""; m.created.length = 0; });

describe("bearerToken", () => {
  it("JWT 형태(세 조각)의 Bearer만 토큰으로 본다 — OTel·cron·실행기의 불투명 토큰은 GoTrue에 보내지 않는다", () => {
    expect(bearerToken(new Headers({ authorization: `Bearer ${JWT}` }))).toBe(JWT);
    expect(bearerToken(new Headers({ authorization: `bearer ${JWT}` }))).toBe(JWT);
    expect(bearerToken(new Headers({ authorization: "Bearer abc.def" }))).toBeNull();
    expect(bearerToken(new Headers({ authorization: "Bearer d568d28f29e41631641ce21a1fe3f704" }))).toBeNull();
    expect(bearerToken(new Headers({ authorization: "Basic x" }))).toBeNull();
    expect(bearerToken(new Headers())).toBeNull();
  });
});

describe("createServerSupabase", () => {
  it("Bearer가 없으면 쿠키 클라이언트", async () => {
    expect(await createServerSupabase()).toEqual({ kind: "cookie" });
    expect(m.created).toHaveLength(0);
  });
  it("불투명 Bearer(JWT 아님)도 쿠키 클라이언트 — 네트워크 호출 없음", async () => {
    m.auth = "Bearer d568d28f29e41631641ce21a1fe3f704";
    expect(await createServerSupabase()).toEqual({ kind: "cookie" });
    expect(m.created).toHaveLength(0);
  });
  it("JWT Bearer가 있으면 그 토큰을 전역 헤더로 쓰고, 인자 없는 getUser()도 그 토큰으로 검증한다", async () => {
    m.auth = `Bearer ${JWT}`;
    const client = await createServerSupabase();
    const { data } = await client.auth.getUser();
    expect(data.user).toEqual({ id: `user-of:${JWT}` });
    expect(m.created[0].getUser).toHaveBeenCalledWith(JWT);
    expect((m.created[0].opts as { global: { headers: Record<string, string> } }).global.headers.Authorization).toBe(`Bearer ${JWT}`);
  });
});
