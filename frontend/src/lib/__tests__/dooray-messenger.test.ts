// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, POST } from "@/app/api/dooray/messenger/route";
import { doorayRequest } from "@/lib/dooray/client";
import { messageSchema, searchMembers, sendMessage } from "@/lib/dooray/messenger";
import { pagesForPath } from "@/lib/page-access";
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), loadConnection: vi.fn(), logAudit: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/dooray/connection", () => ({ loadConnection: mocks.loadConnection }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
beforeEach(() => { vi.restoreAllMocks(); mocks.requireUser.mockReset().mockResolvedValue({ ok: true, userId: "caller", admin: {} }); mocks.loadConnection.mockReset().mockResolvedValue({ token: "personal-token" }); mocks.logAudit.mockReset().mockResolvedValue(undefined); });
const req = (body: unknown) => new NextRequest("https://app.test/api/dooray/messenger", { method: "POST", body: JSON.stringify(body) });
it("protects messenger API with the Dooray page permission", () => { expect(pagesForPath("/api/dooray/messenger")).toEqual(["dooray"]); });
it("requires authentication before accessing credentials", async () => {
  mocks.requireUser.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 401 }) });
  expect((await POST(req({}))).status).toBe(401); expect(mocks.loadConnection).not.toHaveBeenCalled();
});
it.each([{ kind: "channel", id: "../x", text: "hi" }, { kind: "member", id: "1", text: " " }, { kind: "member", id: "1", text: "a".repeat(4001) }])("rejects invalid message input", async input => {
  expect(messageSchema.safeParse(input).success).toBe(false);
  expect((await POST(req(input))).status).toBe(400); expect(mocks.loadConnection).not.toHaveBeenCalled();
});
it("sends as the authenticated user's Dooray account and excludes body from audit", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ header: { isSuccessful: true }, result: null }));
  expect((await POST(req({ kind: "member", id: "123", text: " private message ", userId: "victim" }))).status).toBe(200);
  expect(mocks.loadConnection).toHaveBeenCalledWith({}, "caller");
  expect(fetcher).toHaveBeenCalledWith("https://api.dooray.com/messenger/v1/channels/direct-send", expect.objectContaining({ method: "POST", redirect: "error", headers: { Authorization: "dooray-api personal-token", "Content-Type": "application/json" }, body: JSON.stringify({ text: "private message", organizationMemberId: "123" }) }));
  expect(JSON.stringify(mocks.logAudit.mock.calls)).not.toContain("private message");
});
it("uses channel logs for channel messages", async () => {
  const request = vi.fn().mockResolvedValue({ header: { isSuccessful: true }, result: { id: "5" } });
  await sendMessage(request, { kind: "channel", id: "456", text: "hello" });
  expect(request).toHaveBeenCalledWith("/messenger/v1/channels/456/logs", { text: "hello" });
});
it("does not retry an ambiguous delivery or report it as success", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("network"));
  await expect(sendMessage(doorayRequest("token", undefined, fetcher), { kind: "member", id: "1", text: "hello" })).rejects.toMatchObject({ code: "delivery_unknown" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("preserves successful send if auditing fails", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ header: { isSuccessful: true }, result: null }));
  mocks.logAudit.mockRejectedValue(new Error("db"));
  expect(await (await POST(req({ kind: "member", id: "1", text: "hi" }))).json()).toEqual({ sent: true });
});
it("searches by email without returning extra personal fields", async () => {
  const request = vi.fn().mockResolvedValue({ header: { isSuccessful: true }, result: [{ id: "1", name: "이름", externalEmailAddress: "one@example.com", phone: "private" }] });
  expect(await searchMembers(request, "one@example.com")).toEqual([{ id: "1", name: "이름", email: "one@example.com" }]);
  expect(request.mock.calls[0][0]).toContain("externalEmailAddresses=one%40example.com");
});
it("discards search results after a disconnect", async () => {
  mocks.loadConnection.mockResolvedValueOnce({ token: "token" }).mockResolvedValueOnce(null);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ header: { isSuccessful: true }, result: [] }));
  expect((await GET(new NextRequest("https://app.test/api/dooray/messenger?q=test"))).status).toBe(409);
});
