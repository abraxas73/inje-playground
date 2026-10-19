// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { signState } from "@/lib/ms/crypto";
const m = vi.hoisted(() => ({ status: 200, exchange: vi.fn(), save: vi.fn(), admin: {} }));
const key = Buffer.alloc(32, 1);
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.status === 200
  ? { ok: true, userId: "u1", email: "user@innogrid.com", admin: {} }
  : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: m.status }) } }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({}) }));
vi.mock("@/lib/claude-usage/require-admin", () => ({ adminClientOr500: () => ({ ok: true, admin: m.admin }) }));
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

it("앱 연결 완료는 JavaScript 완료 화면을 거치지 않고 등록된 앱 스킴으로 직접 리다이렉트한다", async () => {
  const res = await GET(req("u1", Date.now() / 1000 + 600, true));
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("innogrid://login-callback?ms_connected=1");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.text()).toBe("");
  expect(m.save).toHaveBeenCalledTimes(1);
});
it("앱에서 발급한 서명 state는 브라우저 쿠키 없이도 state의 사용자에게 저장한다", async () => {
  m.status = 401;
  const res = await GET(req("u2", Date.now() / 1000 + 600, true));
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("innogrid://login-callback?ms_connected=1");
  expect(m.save).toHaveBeenCalledWith(m.admin, key, expect.objectContaining({ userId: "u2" }));
});
it("웹 사용자 불일치·앱 저장 실패는 성공으로 보내지 않는다", async () => {
  const mismatch = await GET(req("u2"));
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
    expect(url.searchParams.get("login_hint")).toBe("user@innogrid.com");
    expect(url.searchParams.has("prompt")).toBe(false);
    expect(verifyState(url.searchParams.get("state")!, key)?.a).toBe(expected);
  }
});
