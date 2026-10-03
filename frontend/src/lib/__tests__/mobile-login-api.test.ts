// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: true as boolean, role: "user" as string | null, permissions: null as unknown, marketing: false as boolean, login: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: m.user ? { id: "u1", email: "a@innogrid.com" } : null } }) },
  from: () => ({ select: () => ({ eq: () => ({
    single: async () => ({ data: m.role ? { role: m.role } : null, error: m.role ? null : { message: "no row" } }),
    maybeSingle: async () => ({ data: m.permissions ? { permissions: m.permissions } : null, error: null }),
  }) }) }),
  rpc: async (fn: string) => ({ data: fn === "has_page_access" ? m.marketing : null, error: null }),
}) }));
vi.mock("@/lib/audit", () => ({ logLogin: m.login }));
import { GET, POST } from "@/app/api/mobile/login/route";
import { NextRequest } from "next/server";
const req = (method = "POST") => new NextRequest("https://app.test/api/mobile/login", { method, headers: { "user-agent": "InnogridApp/1.0 (android)" } });
beforeEach(() => { m.user = true; m.role = "user"; m.permissions = null; m.marketing = false; m.login.mockReset(); });

it("POST — 로그인 사용자의 역할·권한을 돌려주고 login_history를 남긴다", async () => {
  m.permissions = { rfp: false };
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ email: "a@innogrid.com", role: "user", permissions: { rfp: false, marketing: false } });
  expect(m.login).toHaveBeenCalledTimes(1);
  expect(m.login.mock.calls[0][2]).toEqual({ userId: "u1", userEmail: "a@innogrid.com" });
});
it("마케팅 권한은 웹 /api/users/role처럼 has_page_access RPC로 합친다(지정 검수자 포함)", async () => {
  m.marketing = true;
  expect(await (await POST(req())).json()).toMatchObject({ permissions: { marketing: true } });
});
it("GET — 같은 응답이지만 login_history를 남기지 않는다(콜드 스타트·새로고침용)", async () => {
  m.marketing = true;
  const res = await GET(req("GET"));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ role: "user", permissions: { marketing: true } });
  expect(m.login).not.toHaveBeenCalled();
});
it("guest도 기록하고 역할을 돌려준다(차단은 앱이 한다)", async () => {
  m.role = "guest";
  expect(await (await POST(req())).json()).toMatchObject({ role: "guest", permissions: {} });
  expect(m.login).toHaveBeenCalledTimes(1);
});
it("프로필이 없으면 guest로 본다", async () => { m.role = null; expect(await (await POST(req())).json()).toMatchObject({ role: "guest" }); });
it("비로그인 401, 기록 없음", async () => { m.user = false; expect((await POST(req())).status).toBe(401); expect((await GET(req("GET"))).status).toBe(401); expect(m.login).not.toHaveBeenCalled(); });
