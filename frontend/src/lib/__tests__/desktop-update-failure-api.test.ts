// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ user: true as boolean, audit: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.user ? { ok: true, userId: "u1", role: "user", admin: {} } : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) } }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
import { POST } from "@/app/api/desktop/update-failure/route";

const post = (body: unknown) => POST(new NextRequest("https://app.test/api/desktop/update-failure", { method: "POST", body: JSON.stringify(body) }));
const ok = { platform: "windows", version: "1.7.13", reason: "launch", winError: 32, attempts: 3 };
beforeEach(() => { m.user = true; m.audit.mockReset(); });

it("정해진 단계·정수 코드만 감사 로그(category desktop)에 남긴다", async () => {
  expect((await post(ok)).status).toBe(200);
  expect(m.audit).toHaveBeenCalledTimes(1);
  expect(m.audit.mock.calls[0][2]).toEqual({ userId: "u1", action: "데스크톱 업데이트 실패", category: "desktop", detail: ok });
});
it("모르는 단계·문자열 코드·범위 밖 값·비로그인은 거절", async () => {
  for (const bad of [{ ...ok, reason: "C:\\Users\\x" }, { ...ok, winError: "32" }, { ...ok, attempts: 0 }, { ...ok, version: "1.7.13; drop" }, { ...ok, platform: "freebsd" }, { ...ok, platform: "linux", reason: "name", winError: 1 }, { ...ok, platform: "linux", reason: "signature", winError: 1000 }, null]) {
    expect((await post(bad)).status).toBe(400);
  }
  m.user = false;
  expect((await post(ok)).status).toBe(401);
  expect(m.audit).not.toHaveBeenCalled();
});
it("linux는 자기 단계 집합과 종료 코드·HTTP 상태 0~999만 받는다", async () => {
  const linux = { platform: "linux", version: "1.8.0", reason: "signature", winError: 1, attempts: 1 };
  expect((await post(linux)).status).toBe(200);
  expect(m.audit.mock.calls[0][2].detail).toEqual(linux);
  const http = { ...linux, reason: "download", winError: 404 };
  expect((await post(http)).status).toBe(200);
});
