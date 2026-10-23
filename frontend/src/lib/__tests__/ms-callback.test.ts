// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { signState } from "@/lib/ms/crypto";
const m = vi.hoisted(() => ({
  status: 200,
  exchange: vi.fn(),
  save: vi.fn(),
  getUserById: vi.fn(),
  me: { mail: "test@example.com", userPrincipalName: "test@example.com", displayName: "Test" },
  admin: {} as Record<string, unknown>,
}));
const key = Buffer.alloc(32, 1);
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.status === 200
  ? { ok: true, userId: "u1", email: "user@innogrid.com", admin: {} }
  : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: m.status }) } }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({}) }));
vi.mock("@/lib/claude-usage/require-admin", () => ({ adminClientOr500: () => ({ ok: true, admin: m.admin }) }));
vi.mock("@/lib/ms/config", () => ({ loadMsConfig: async () => ({ ok: true, config: { app: {}, encKey: Buffer.alloc(32, 1) } }), missingConfigMessage: () => "설정 누락" }));
vi.mock("@/lib/ms/connections", () => ({ saveConnection: m.save }));
vi.mock("@/lib/ms/oauth", async (orig) => ({ ...(await orig<typeof import("@/lib/ms/oauth")>()), exchangeCode: m.exchange, fetchMe: async () => m.me }));
import { GET } from "@/app/api/ms/callback/route";
const req = (user = "u1", expiry = Date.now() / 1000 + 600, appReturn = false) => new NextRequest(`https://inje-playground.vercel.app/api/ms/callback?code=secret-code&state=${signState({ u: user, n: "nonce", r: "/settings", e: expiry, ...(appReturn ? { a: true as const } : {}) }, key)}`);
/** 앱 흐름 실패: 웹으로 리디렉션하지 않고 이유 + 앱 복귀 링크(자동 이동 없음) */
async function expectAppFailure(res: Response, reason: string) {
  expect(res.headers.get("location")).toBeNull();
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  const html = await res.text();
  expect(html).toContain(reason);
  expect(html).toContain('href="innogrid://login-callback"');
  expect(html).not.toContain("window.location.replace");
  expect(html).not.toContain("/settings");
  return html;
}
beforeEach(() => {
  m.status = 200;
  m.exchange.mockReset().mockResolvedValue({ accessToken: "at", refreshToken: "rt", scope: "User.Read" });
  m.save.mockReset();
  m.me = { mail: "test@example.com", userPrincipalName: "test@example.com", displayName: "Test" };
  m.getUserById.mockReset().mockResolvedValue({ data: { user: { email: "test@example.com" } }, error: null });
  m.admin = { auth: { admin: { getUserById: m.getUserById } } };
});
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
  expect(m.save).toHaveBeenCalledWith(m.admin, key, expect.objectContaining({ userId: "u1", refreshToken: "rt" }));
});

it("앱 연결 완료는 자동 복귀와 사용자가 누를 수 있는 앱 복귀 링크를 함께 제공한다", async () => {
  const res = await GET(req("u1", Date.now() / 1000 + 600, true));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(res.headers.get("cache-control")).toBe("no-store");
  const html = await res.text();
  expect(html).toContain('href="innogrid://login-callback?ms_connected=1"');
  expect(html).toContain("window.location.replace");
  expect(html).not.toContain("/settings");
  expect(m.save).toHaveBeenCalledTimes(1);
});
it("앱에서 발급한 서명 state는 브라우저 쿠키 없이도 state의 사용자에게 저장한다", async () => {
  m.status = 401;
  const res = await GET(req("u2", Date.now() / 1000 + 600, true));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("innogrid://login-callback?ms_connected=1");
  expect(m.save).toHaveBeenCalledWith(m.admin, key, expect.objectContaining({ userId: "u2" }));
});
it("앱 state의 사용자 이메일과 동의한 Microsoft 계정이 다르면 토큰을 저장하지 않는다", async () => {
  m.getUserById.mockResolvedValueOnce({ data: { user: { email: "owner@innogrid.com" } }, error: null });
  m.me = { mail: "colleague@innogrid.com", userPrincipalName: "colleague@innogrid.com", displayName: "Colleague" };
  const res = await GET(req("u1", Date.now() / 1000 + 600, true));
  await expectAppFailure(res, "일치하지 않습니다");
  expect(m.save).not.toHaveBeenCalled();
});
it("앱 계정 비교는 대소문자를 무시하고 Microsoft mail이 없으면 UPN을 쓴다", async () => {
  m.getUserById.mockResolvedValueOnce({ data: { user: { email: "Owner@INNOGRID.com" } }, error: null });
  m.me = { mail: "", userPrincipalName: "owner@innogrid.COM", displayName: "Owner" };
  await GET(req("u1", Date.now() / 1000 + 600, true));
  expect(m.save).toHaveBeenCalledTimes(1);
});
it.each([
  ["앱 사용자 조회 실패", { data: { user: null }, error: new Error("lookup failed") }, { mail: "owner@innogrid.com", userPrincipalName: "owner@innogrid.com", displayName: "Owner" }],
  ["앱 사용자 이메일 누락", { data: { user: { email: null } }, error: null }, { mail: "owner@innogrid.com", userPrincipalName: "owner@innogrid.com", displayName: "Owner" }],
  ["Microsoft 이메일 누락", { data: { user: { email: "owner@innogrid.com" } }, error: null }, { mail: "", userPrincipalName: "", displayName: "Owner" }],
])("%s이면 앱 연결을 실패 처리한다", async (_name, lookup, me) => {
  m.getUserById.mockResolvedValueOnce(lookup);
  m.me = me;
  const res = await GET(req("u1", Date.now() / 1000 + 600, true));
  await expectAppFailure(res, "일치하지 않습니다");
  expect(m.save).not.toHaveBeenCalled();
});
it("웹 사용자 불일치·앱 저장 실패는 성공으로 보내지 않는다", async () => {
  const mismatch = await GET(req("u2"));
  expect(mismatch.headers.get("location")).toContain("ms_error=");
  expect(m.save).not.toHaveBeenCalled();
  m.save.mockRejectedValueOnce(new Error("save failed"));
  const failed = await GET(req("u1", Date.now() / 1000 + 600, true));
  await expectAppFailure(failed, "저장하지 못했습니다");
});
it("앱 흐름의 Azure 거부는 웹 /settings로 보내지 않고, 문구에 섞인 error 값은 이스케이프한다", async () => {
  const state = signState({ u: "u1", n: "nonce", r: "/settings", e: Date.now() / 1000 + 600, a: true }, key);
  const res = await GET(new NextRequest(`https://inje-playground.vercel.app/api/ms/callback?error=${encodeURIComponent("<script>x</script>")}&state=${state}`));
  const html = await expectAppFailure(res, "Microsoft 로그인 오류");
  expect(html).not.toContain("<script>x</script>");
  expect(html).toContain("&#60;script&#62;");
  expect(m.exchange).not.toHaveBeenCalled();
});
it("웹 흐름의 Azure 거부는 returnTo?ms_error로 돌려보낸다(관리자 승인 필요 안내)", async () => {
  const state = signState({ u: "u1", n: "nonce", r: "/teams/chat", e: Date.now() / 1000 + 600 }, key);
  const res = await GET(new NextRequest(`https://inje-playground.vercel.app/api/ms/callback?error=consent_required&state=${state}`));
  const loc = new URL(res.headers.get("location")!);
  expect(loc.pathname).toBe("/teams/chat");
  expect(loc.searchParams.get("ms_error")).toContain("관리자 승인");
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
it("Windows WebView가 연결 이동을 가로채지 못해도 앱 User-Agent면 앱 복귀 state를 서명한다", async () => {
  const { GET: connect } = await import("@/app/api/ms/connect/route");
  const { verifyState } = await import("@/lib/ms/crypto");
  const res = await connect(new NextRequest("https://inje-playground.vercel.app/api/ms/connect?returnTo=%2Fsettings", {
    headers: { "user-agent": "Mozilla/5.0 InnogridApp/1.7.4 (windows) InnogridBuild/55" },
  }));
  expect(res.status).toBe(302);
  const url = new URL(res.headers.get("location")!);
  expect(url.origin).toBe("https://login.microsoftonline.com");
  expect(verifyState(url.searchParams.get("state")!, key)).toMatchObject({ u: "u1", r: "/settings", a: true });
});
