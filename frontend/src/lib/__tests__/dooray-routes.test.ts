// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET as overviewGet } from "@/app/api/dooray/overview/route";
import { PUT, DELETE } from "@/app/api/dooray/connection/route";
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), loadConnection: vi.fn(), saveConnection: vi.fn(), connectionStatus: vi.fn(), overview: vi.fn(), logAudit: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/dooray/connection", () => ({ loadConnection: mocks.loadConnection, saveConnection: mocks.saveConnection, connectionStatus: mocks.connectionStatus }));
vi.mock("@/lib/dooray/client", async original => ({ ...await original<typeof import("@/lib/dooray/client")>(), overview: mocks.overview }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
beforeEach(() => { vi.resetAllMocks(); mocks.requireUser.mockResolvedValue({ ok: true, userId: "actual-user", role: "user", admin: {} }); });
it("rejects anonymous callers before accessing data or credentials", async () => {
  mocks.requireUser.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) });
  const req = new NextRequest("https://example.test/api/dooray/overview");
  expect((await overviewGet(req)).status).toBe(401);
  expect((await PUT(req)).status).toBe(401);
  expect(mocks.loadConnection).not.toHaveBeenCalled(); expect(mocks.saveConnection).not.toHaveBeenCalled();
});
it("uses session owner instead of a supplied userId and excludes token from audit", async () => {
  mocks.connectionStatus.mockResolvedValue({ connected: true });
  const res = await PUT(new NextRequest("https://example.test/api/dooray/connection", { method: "PUT", body: JSON.stringify({ token: "sensitive-token", userId: "victim" }) }));
  expect(res.status).toBe(200);
  expect(mocks.saveConnection).toHaveBeenCalledWith({}, "actual-user", "sensitive-token");
  expect(JSON.stringify(mocks.logAudit.mock.calls[0][2])).not.toContain("sensitive-token");
});
it.each(["{", JSON.stringify({ token: "bad\nheader" }), JSON.stringify({ token: "x".repeat(5000) })])("rejects malformed connection input", async body => {
  const res = await PUT(new NextRequest("https://example.test/api/dooray/connection", { method: "PUT", body }));
  expect(res.status).toBe(400); expect(mocks.saveConnection).not.toHaveBeenCalled();
});
it("deletes only the caller's connection", async () => {
  const eq = vi.fn().mockResolvedValue({ error: null }); const from = vi.fn(() => ({ delete: () => ({ eq }) }));
  mocks.requireUser.mockResolvedValue({ ok: true, userId: "actual-user", admin: { from } });
  expect((await DELETE(new NextRequest("https://example.test/api/dooray/connection?userId=victim", { method: "DELETE" }))).status).toBe(200);
  expect(eq).toHaveBeenCalledWith("user_id", "actual-user");
});
it("discards an overview completed after concurrent disconnect", async () => {
  mocks.loadConnection.mockResolvedValueOnce({ token: "secret", site: "https://example.dooray.com", connectedAt: "v1" }).mockResolvedValueOnce(null);
  mocks.overview.mockResolvedValue({ events: { items: [{ subject: "private subject" }] } });
  const res = await overviewGet(new NextRequest("https://example.test/api/dooray/overview?date=2026-10-11&briefing=1"));
  expect(await res.json()).toMatchObject({ connected: false, events: { items: [] } });
  expect(res.headers.get("cache-control")).toBe("private, no-store");
});
it("returns disconnected without an upstream call when no connection exists", async () => {
  mocks.loadConnection.mockResolvedValue(null);
  const res = await overviewGet(new NextRequest("https://example.test/api/dooray/overview"));
  expect(await res.json()).toMatchObject({ connected: false }); expect(mocks.overview).not.toHaveBeenCalled();
});
