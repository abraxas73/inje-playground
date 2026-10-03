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

beforeEach(() => { m.auth = ""; m.created.length = 0; });

describe("bearerToken", () => {
  it("Bearer 헤더에서 토큰만 꺼내고, 없거나 형식이 다르면 null", () => {
    expect(bearerToken(new Headers({ authorization: "Bearer abc.def" }))).toBe("abc.def");
    expect(bearerToken(new Headers({ authorization: "bearer x" }))).toBe("x");
    expect(bearerToken(new Headers({ authorization: "Basic x" }))).toBeNull();
    expect(bearerToken(new Headers())).toBeNull();
  });
});

describe("createServerSupabase", () => {
  it("Bearer가 없으면 쿠키 클라이언트", async () => {
    expect(await createServerSupabase()).toEqual({ kind: "cookie" });
    expect(m.created).toHaveLength(0);
  });
  it("Bearer가 있으면 그 토큰을 전역 헤더로 쓰고, 인자 없는 getUser()도 그 토큰으로 검증한다", async () => {
    m.auth = "Bearer tok1";
    const client = await createServerSupabase();
    const { data } = await client.auth.getUser();
    expect(data.user).toEqual({ id: "user-of:tok1" });
    expect(m.created[0].getUser).toHaveBeenCalledWith("tok1");
    expect((m.created[0].opts as { global: { headers: Record<string, string> } }).global.headers.Authorization).toBe("Bearer tok1");
  });
});
