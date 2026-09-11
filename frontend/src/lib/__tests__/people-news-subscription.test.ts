// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  user: { id: "self-user", email: "self@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" } as { id: string; email: string; email_confirmed_at: string | null } | null,
  role: "user",
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: mock.user } }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: mock.role } }) }) }) }),
  rpc: mock.rpc,
}) }));
import { PUT } from "@/app/api/people-news/subscription/route";

function request(body: unknown) {
  return new NextRequest("https://app.test/api/people-news/subscription", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  mock.user = { id: "self-user", email: "self@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" };
  mock.role = "user";
  mock.rpc.mockReset().mockResolvedValue({ data: { enabled: true, send_time: "08:30:00", next_send_at: "2026-09-12T23:30:00Z" }, error: null });
});

describe("personal email subscription", () => {
  it("saves only the caller's schedule, ignoring client-supplied recipients or user IDs", async () => {
    const response = await PUT(request({ enabled: true, sendTime: "08:30", userId: "other-user", email: "other@example.test", next_send_at: "2000-01-01" }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("set_yonhap_notice_subscription", { p_enabled: true, p_send_time: "08:30" });
  });
  it("allows opting out even if the email has become unverified", async () => {
    mock.user!.email_confirmed_at = null;
    expect((await PUT(request({ enabled: false, sendTime: "08:30" }))).status).toBe(200);
  });
  it("does not subscribe an unverified address", async () => {
    mock.user!.email_confirmed_at = null;
    expect((await PUT(request({ enabled: true, sendTime: "08:30" }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated requests and guest accounts", async () => {
    mock.role = "guest";
    expect((await PUT(request({ enabled: true, sendTime: "08:30" }))).status).toBe(403);
    mock.user = null;
    expect((await PUT(request({ enabled: true, sendTime: "08:30" }))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, { enabled: "true", sendTime: "08:30" }, { enabled: true, sendTime: "24:00" }, { enabled: true, sendTime: "7:00" }, { enabled: true, sendTime: "07:00:30" }])("rejects malformed settings %j", async (body) => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
