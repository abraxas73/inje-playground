// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: true, role: "admin", rpc: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: m.user ? { id: "admin", email: "admin@example.test" } : null } }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: m.role } }) }) }) }),
  rpc: m.rpc,
}) }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
import { PUT } from "@/app/api/admin/page-permissions/route";
const userId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const request = (body: unknown) => new Request("https://app.test/api/admin/page-permissions", { method: "PUT", body: JSON.stringify(body) });
beforeEach(() => { m.user = true; m.role = "admin"; m.rpc.mockReset().mockResolvedValue({ data: { user_id: userId, permissions: { food: false }, version: 2 } }); m.audit.mockReset(); });
it("writes only a validated target and page map through the guarded RPC", async () => {
  expect((await PUT(request({ userId, permissions: { food: false }, version: 1, role: "admin" }))).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("set_user_page_access", { p_user_id: userId, p_permissions: { food: false }, p_expected_version: 1 });
  expect(m.audit).toHaveBeenCalledTimes(1);
});
it.each(["guest", "user"])("rejects %s self-escalation", async (role) => {
  m.role = role;
  expect((await PUT(request({ userId, permissions: { food: true }, version: 1 }))).status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("requires login", async () => { m.user = false; expect((await PUT(request({}))).status).toBe(401); });
it.each([{ userId, permissions: { admin: true }, version: 0 }, { userId, permissions: { food: "false" }, version: 0 }, { userId, permissions: {}, version: -1 }, { userId: "wrong", permissions: {}, version: 0 }, null])("rejects malformed input %j", async (body) => {
  expect((await PUT(request(body))).status).toBe(400); expect(m.rpc).not.toHaveBeenCalled();
});
it("reports concurrent edits without a success audit", async () => {
  m.rpc.mockResolvedValue({ error: { code: "40001" } });
  expect((await PUT(request({ userId, permissions: {}, version: 0 }))).status).toBe(409);
  expect(m.audit).not.toHaveBeenCalled();
});
