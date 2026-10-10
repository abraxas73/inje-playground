// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ authed: true, status: 401 }));
vi.mock("@/lib/rfp/require-user", () => ({
  requireUser: async () => m.authed
    ? { ok: true, userId: "u1", role: "user", admin: {} }
    : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: m.status }) },
}));
const relay = vi.hoisted(() => ({ fn: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/mcp/relay", () => ({ relayToolCall: relay.fn }));
vi.mock("@/lib/audit", () => ({ logAudit: relay.audit }));
import { DELETE, GET, POST } from "@/app/api/mcp/route";
import { GET as metadata } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as metadataMcp } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new NextRequest("https://test/api/mcp", { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));
beforeEach(() => { m.authed = true; m.status = 401; });

it("401s unauthenticated calls with the resource metadata challenge", async () => {
  m.authed = false;
  const r = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
  expect(r.status).toBe(401);
  expect(r.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://innocrew.innogrid.com/.well-known/oauth-protected-resource"');
  expect(await r.json()).toEqual({ error: expect.any(String) });
});

it("does not challenge a forbidden (guest) caller", async () => {
  m.authed = false; m.status = 403;
  const r = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }));
  expect(r.status).toBe(403);
  expect(r.headers.get("www-authenticate")).toBeNull();
});

it("answers initialize as JSON", async () => {
  const r = await post(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: "2025-06-18" } }));
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("application/json");
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(await r.json()).toMatchObject({ jsonrpc: "2.0", id: 7, result: { protocolVersion: "2025-06-18", serverInfo: { name: "innogrid-app" } } });
});

it("returns 202 with an empty body for notifications", async () => {
  const r = await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  expect(r.status).toBe(202);
  expect(await r.text()).toBe("");
});

it("relays tools/call and returns tool errors as results, auditing only tool/ms/ok", async () => {
  relay.fn.mockResolvedValueOnce({ content: [{ type: "text", text: "앱 꺼짐" }], isError: true });
  const r = await post(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "approval_counts", arguments: { a: 1 } } }));
  expect(await r.json()).toEqual({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "앱 꺼짐" }], isError: true } });
  expect(relay.fn).toHaveBeenCalledWith({ admin: {} }, "u1", "approval_counts", { a: 1 });
  expect(relay.audit).toHaveBeenCalledWith({}, expect.anything(), {
    userId: "u1", action: "mcp.tool", category: "mcp", detail: { tool: "approval_counts", ms: expect.any(Number), ok: false },
  });
});

it("405s GET and 200s DELETE", async () => {
  expect((await GET()).status).toBe(405);
  expect((await DELETE()).status).toBe(200);
});

it("413s bodies over 1MB", async () => {
  expect((await post("{}", { "content-length": String(1024 * 1024 + 1) })).status).toBe(413);
});

it("answers -32700 for unparsable JSON", async () => {
  const r = await post("{not json");
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
});

it("answers -32600 for batches", async () => {
  expect(await (await post("[]")).json()).toMatchObject({ error: { code: -32600 } });
});

it("serves protected resource metadata on both paths", async () => {
  for (const get of [metadata, metadataMcp]) {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await r.json()).toMatchObject({ resource: "https://innocrew.innogrid.com/api/mcp" });
  }
});
