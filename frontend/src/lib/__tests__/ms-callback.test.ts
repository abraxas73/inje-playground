// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { signState } from "@/lib/ms/crypto";
const m = vi.hoisted(() => ({ status: 200, exchange: vi.fn(), save: vi.fn() }));
const key = Buffer.alloc(32, 1);
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.status === 200
  ? { ok: true, userId: "u1", admin: {} }
  : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: m.status }) } }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({}) }));
vi.mock("@/lib/ms/config", () => ({ loadMsConfig: async () => ({ ok: true, config: { app: {}, encKey: Buffer.alloc(32, 1) } }), missingConfigMessage: () => "설정 누락" }));
vi.mock("@/lib/ms/connections", () => ({ saveConnection: m.save }));
vi.mock("@/lib/ms/oauth", async (orig) => ({ ...(await orig<typeof import("@/lib/ms/oauth")>()), exchangeCode: m.exchange, fetchMe: async () => ({ mail: "test@example.com", displayName: "Test" }) }));
import { GET } from "@/app/api/ms/callback/route";
const req = (user = "u1", expiry = Date.now() / 1000 + 600, appReturn = false) => new NextRequest(`https://inje-playground.vercel.app/api/ms/callback?code=secret-code&state=${signState({ u: user, n: "nonce", r: "/settings", e: expiry, ...(appReturn ? { a: true as const } : {}) }, key)}`);
beforeEach(() => { m.status = 200; m.exchange.mockReset().mockResolvedValue({ accessToken: "at", refreshToken: "rt", scope: "User.Read" }); m.save.mockReset(); });
it.each([401, 403])("인증 실패 %s는 UTF-8 안내 화면이며 코드 교환·저장을 하지 않는다", async (status) => {
  m.status = status;
  const res = await GET(req());
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(res.headers.get("cache-control")).toBe("no-store");
  const html = await res.text();
  expect(html).toContain("설정으로 이동");
  expect(html).not.toContain("secret-code");
  expect(m.exchange).not.toHaveBeenCalled();
  expect(m.save).not.toHaveBeenCalled();
});
it("다른 사용자와 만료된 state는 저장하지 않는다", async () => {
  for (const r of [req("u2"), req("u1", 1)]) {
    const res = await GET(r);
    expect(res.headers.get("location")).toContain("ms_error=");
  }
  expect(m.exchange).not.toHaveBeenCalled();
  expect(m.save).not.toHaveBeenCalled();
});
it("일치하는 세션과 state만 연결을 저장한다", async () => {
  const res = await GET(req());
  expect(res.headers.get("location")).toBe("https://inje-playground.vercel.app/settings?ms_connected=1");
  expect(m.save).toHaveBeenCalledWith({}, key, expect.objectContaining({ userId: "u1", refreshToken: "rt" }));
});

it("앱 연결 완료만 토큰 없는 앱 복귀 페이지를 표시한다", async () => {
  const res = await GET(req("u1", Date.now() / 1000 + 600, true));
  const html = await res.text();
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(html).toContain('window.location.replace("innogrid://login-callback?ms_connected=1")');
  expect(html).toContain('href="innogrid://login-callback?ms_connected=1"');
  expect(html).not.toContain("secret-code");
  expect(html).not.toContain("refreshToken");
  expect(m.save).toHaveBeenCalledTimes(1);
});
it("앱 복귀 표시가 있어도 사용자 불일치·저장 실패는 앱 성공으로 보내지 않는다", async () => {
  const mismatch = await GET(req("u2", Date.now() / 1000 + 600, true));
  expect(mismatch.headers.get("location")).toContain("ms_error=");
  expect(m.save).not.toHaveBeenCalled();
  m.save.mockRejectedValueOnce(new Error("save failed"));
  const failed = await GET(req("u1", Date.now() / 1000 + 600, true));
  expect(failed.headers.get("location")).toContain("ms_error=");
});
it("connect는 앱 복귀 플래그를 서명하며 일반 웹 요청은 표시하지 않는다", async () => {
  const { GET: connect } = await import("@/app/api/ms/connect/route");
  const { verifyState } = await import("@/lib/ms/crypto");
  for (const [q, expected] of [["?app_return=1", true], ["", undefined], ["?app_return=https://evil.test", undefined]] as const) {
    const res = await connect(new NextRequest(`https://inje-playground.vercel.app/api/ms/connect${q}`));
    const url = new URL(res.headers.get("location")!);
    expect(verifyState(url.searchParams.get("state")!, key)?.a).toBe(expected);
  }
});
