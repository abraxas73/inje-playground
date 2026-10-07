// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const m = vi.hoisted(() => ({ authorized: true, token: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.authorized ? { ok: true, admin: {}, userId: "current-user" } : { ok: false, response: NextResponse.json({}, { status: 401 }) } }));
vi.mock("@/lib/ms/route-token", () => ({ graphTokenForRoute: m.token }));
import { GET } from "@/app/api/users/profile/photo/route";
beforeEach(() => { m.authorized = true; m.token.mockReset().mockResolvedValue({ ok: true, token: "private-token" }); m.fetch.mockReset(); vi.stubGlobal("fetch", m.fetch); });
afterEach(() => vi.unstubAllGlobals());
it("인증되지 않은 요청은 사진·토큰 조회 없이 거부", async () => {
  m.authorized = false;
  expect((await GET()).status).toBe(401);
  expect(m.token).not.toHaveBeenCalled();
  expect(m.fetch).not.toHaveBeenCalled();
});
it("현재 사용자의 사진만 반환하고 공유 캐시를 금지", async () => {
  m.fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
  const res = await GET();
  expect(m.token).toHaveBeenCalledWith({}, "current-user");
  expect(m.fetch.mock.calls[0][0]).toBe("https://graph.microsoft.com/v1.0/me/photos/96x96/$value");
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ photo: "AQID" });
});
it("미연결이면 Graph 조회 없이 기본 아바타", async () => {
  m.token.mockResolvedValue({ ok: false });
  expect(await (await GET()).json()).toEqual({ photo: null });
  expect(m.fetch).not.toHaveBeenCalled();
});
it("사진 없음·잘못된 형식·과대 응답·통신 실패는 기본 아바타", async () => {
  for (const response of [new Response(null, { status: 404 }), new Response('<html>', { headers: { 'content-type': 'text/html' } }), new Response(new Uint8Array(256001), { headers: { 'content-type': 'image/png' } })]) {
    m.fetch.mockResolvedValue(response);
    expect(await (await GET()).json()).toEqual({ photo: null });
  }
  m.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await GET()).json()).toEqual({ photo: null });
});
