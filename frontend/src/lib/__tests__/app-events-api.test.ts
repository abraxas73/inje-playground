// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { gwAlertText, parseAppEvents } from "@/lib/app-events";

type Row = { user_id: string | null; detail: { code?: string } | null };
const m = vi.hoisted(() => ({
  user: true as boolean,
  audit: vi.fn(),
  recent: 0,
  rows: [] as { user_id: string | null; detail: { code?: string } | null }[],
  setting: null as string | null,
  upserts: [] as unknown[],
  sent: [] as unknown[],
  configured: true,
}));

/** action_history count·select와 settings 읽기·쓰기만 흉내 내는 체인 */
function fakeAdmin() {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      let head = false;
      q.select = (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return q; };
      q.eq = () => q;
      q.gte = () => q;
      q.maybeSingle = async () => ({ data: m.setting === null ? null : { value: m.setting } });
      q.upsert = async (v: unknown) => { m.upserts.push(v); m.setting = (v as { value: string }).value; return {}; };
      q.then = (res: (v: unknown) => unknown) => res(table === "action_history" ? (head ? { count: m.recent } : { data: m.rows }) : { data: null });
      return q;
    },
  };
}
vi.mock("@/lib/rfp/require-user", () => ({
  requireUser: async () => m.user ? { ok: true, userId: "u1", role: "user", admin: fakeAdmin() } : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) },
}));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
vi.mock("@/lib/notify", () => ({
  getNotifier: async () => ({ channelConfigured: m.configured, sendChannel: async (msg: unknown) => { m.sent.push(msg); return { ok: true }; } }),
}));
import { POST } from "@/app/api/app/events/route";

const post = (body: unknown) => POST(new NextRequest("https://app.test/api/app/events", { method: "POST", body: JSON.stringify(body) }));
const ev = (kind: string, code: string, extra: Record<string, unknown> = {}) => ({ kind, code, version: "1.7.59", platform: "iOS", ...extra });
beforeEach(() => {
  Object.assign(m, { user: true, recent: 0, rows: [], setting: null, upserts: [], sent: [], configured: true });
  m.audit.mockReset();
});

it("정해진 kind·code·버전·플랫폼만 감사 로그(category app)에 남긴다", async () => {
  const res = await post({ events: [ev("gw_unauthorized", "session_expired"), ev("app_error", "_TypeError", { at: "2026-10-23T01:02:03.000Z" })] });
  expect(res.status).toBe(200);
  expect(m.audit).toHaveBeenCalledTimes(2);
  expect(m.audit.mock.calls[1][2]).toEqual({
    userId: "u1", action: "앱 오류", category: "app",
    detail: { kind: "app_error", code: "_TypeError", version: "1.7.59", platform: "iOS", at: "2026-10-23T01:02:03.000Z" },
  });
  expect(m.sent).toEqual([]); // gw_login_failed가 없으면 알림 판단도 안 한다
});

it("모르는 kind·code, 메시지 같은 값, 잘못된 버전·플랫폼·시각, 21개 이상, 비로그인은 거절", async () => {
  const bad = [
    { events: [ev("crash", "x")] },
    { events: [ev("gw_login_failed", "wrong password for hong")] },
    { events: [ev("app_error", "Exception: token=abc/def")] },
    { events: [ev("app_error", "x".repeat(81))] },
    { events: [ev("gw_unauthorized", "session_expired", { version: "1.7; drop" })] },
    { events: [ev("gw_unauthorized", "session_expired", { platform: "web" })] },
    { events: [ev("gw_unauthorized", "session_expired", { at: "어제" })] },
    { events: Array.from({ length: 21 }, () => ev("gw_unauthorized", "session_expired")) },
    { events: [] },
    null,
  ];
  for (const b of bad) expect((await post(b)).status).toBe(400);
  m.user = false;
  expect((await post({ events: [ev("app_error", "StateError")] })).status).toBe(401);
  expect(m.audit).not.toHaveBeenCalled();
});

it("사용자당 10분 30건을 넘기면 남는 만큼만 남긴다", async () => {
  m.recent = 27;
  const res = await post({ events: Array.from({ length: 5 }, () => ev("app_error", "StateError")) });
  expect(await res.json()).toEqual({ ok: true, kept: 3 });
  expect(m.audit).toHaveBeenCalledTimes(3);
  m.audit.mockReset();
  m.recent = 30;
  await post({ events: [ev("app_error", "StateError")] });
  expect(m.audit).not.toHaveBeenCalled();
});

it("gw_login_failed: 1시간 안 서로 다른 사용자 2명 이상이면 관리자 채널로 한 번, 6시간 안에는 다시 안 보낸다", async () => {
  m.rows = [{ user_id: "u1", detail: { code: "no_button" } }];
  await post({ events: [ev("gw_login_failed", "no_button")] });
  expect(m.sent).toEqual([]); // 한 사람뿐
  m.rows.push({ user_id: "u2", detail: { code: "watchdog" } }, { user_id: "u2", detail: { code: "no_button" } });
  await post({ events: [ev("gw_login_failed", "no_button")] });
  expect(m.sent).toHaveLength(1);
  expect((m.sent[0] as { text: string }).text).toContain("로그인 페이지 변경 가능성");
  expect((m.sent[0] as { text: string }).text).toContain("no_button 2 · watchdog 1");
  expect(JSON.parse(m.setting!).gw_login_failed).toBeTruthy();
  await post({ events: [ev("gw_login_failed", "no_button")] });
  expect(m.sent).toHaveLength(1); // 쿨다운
});

it("알림 판단: 비밀번호 오류·OTP는 세지 않고, 6시간 지나면 다시 보낸다", () => {
  const rows: Row[] = [{ user_id: "a", detail: { code: "reveal_error" } }, { user_id: "b", detail: { code: "otp" } }, { user_id: "c", detail: { code: "watchdog" } }];
  expect(gwAlertText(rows, undefined, Date.now())).toBeNull();
  rows.push({ user_id: "d", detail: { code: "verify_failed" } });
  const now = Date.parse("2026-10-23T10:00:00Z");
  expect(gwAlertText(rows, "2026-10-23T05:00:00Z", now)).toBeNull();
  expect(gwAlertText(rows, "2026-10-23T03:59:00Z", now)).toContain("사용자 2명");
  expect(parseAppEvents({ events: [{ kind: "toString", code: "x", version: "dev", platform: "iOS" }] })).toBeNull();
});
