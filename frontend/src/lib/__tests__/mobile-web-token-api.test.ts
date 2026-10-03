// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true as boolean, generate: vi.fn(), getUserById: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok
  ? { ok: true, userId: "u1", role: "user", admin: { auth: { admin: { getUserById: m.getUserById, generateLink: m.generate } } } }
  : { ok: false, response: NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 }) } }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
import { POST } from "@/app/api/mobile/web-token/route";
const req = () => new NextRequest("https://app.test/api/mobile/web-token", { method: "POST" });
beforeEach(() => {
  m.ok = true; m.audit.mockReset();
  m.getUserById.mockReset().mockResolvedValue({ data: { user: { id: "u1", email: "a@innogrid.com" } }, error: null });
  m.generate.mockReset().mockResolvedValue({ data: { properties: { hashed_token: "hash-1", action_link: "https://should-not-leak" } }, error: null });
});

it("magiclink hashed_token만 돌려주고 메일은 보내지 않는다", async () => {
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ tokenHash: "hash-1" });
  expect(m.generate).toHaveBeenCalledWith({ type: "magiclink", email: "a@innogrid.com" });
  expect(m.audit).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(m.audit.mock.calls[0][2])).not.toContain("hash-1");
});
it("guest·비로그인은 requireUser 응답 그대로(403)", async () => { m.ok = false; expect((await POST(req())).status).toBe(403); expect(m.generate).not.toHaveBeenCalled(); });
it("발급 실패는 502", async () => { m.generate.mockResolvedValue({ data: null, error: { message: "boom" } }); expect((await POST(req())).status).toBe(502); });
