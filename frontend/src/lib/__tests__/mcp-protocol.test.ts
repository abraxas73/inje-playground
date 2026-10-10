import { expect, it } from "vitest";
import { handleStateless, listTools, parseJsonRpc, protectedResourceMetadata, wwwAuthenticate, type JsonRpcRequest } from "@/lib/mcp/protocol";

const req = (method: string, params?: unknown, id: number | undefined = 1): JsonRpcRequest => ({ jsonrpc: "2.0", id, method, params });

it("echoes the client protocol version on initialize", () => {
  expect(handleStateless(req("initialize", { protocolVersion: "2025-03-26" }))).toEqual({
    kind: "respond",
    body: { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "innogrid-app", version: "1.0.0" } } },
  });
  const r = handleStateless(req("initialize", {}));
  expect(r.kind === "respond" && (r.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
});

it("rejects batches and malformed envelopes with -32600", () => {
  expect(parseJsonRpc([req("ping")])).toEqual({ error: { code: -32600, message: expect.any(String) } });
  expect(parseJsonRpc({ jsonrpc: "1.0", id: 1, method: "ping" })).toHaveProperty("error.code", -32600);
  expect(parseJsonRpc({ jsonrpc: "2.0", id: 1 })).toHaveProperty("error.code", -32600);
  expect(parseJsonRpc(null)).toHaveProperty("error.code", -32600);
  expect(parseJsonRpc({ jsonrpc: "2.0", id: 1, method: "ping" })).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
});

it("answers ping, accepts notifications and rejects unknown methods", () => {
  expect(handleStateless(req("ping"))).toEqual({ kind: "respond", body: { jsonrpc: "2.0", id: 1, result: {} } });
  expect(handleStateless(req("notifications/initialized", undefined, undefined))).toEqual({ kind: "accepted" });
  expect(handleStateless(req("notifications/cancelled"))).toEqual({ kind: "accepted" });
  expect(handleStateless(req("resources/list"))).toEqual({ kind: "error", body: { jsonrpc: "2.0", id: 1, error: { code: -32601, message: expect.any(String) } } });
});

it("lists the 57 tools in order", () => {
  expect(listTools()).toHaveLength(57);
  expect(listTools()[0].name).toBe("approval_counts");
  const r = handleStateless(req("tools/list"));
  expect(r.kind === "respond" && (r.body as { result: { tools: unknown[] } }).result.tools).toHaveLength(57);
  expect(JSON.stringify(listTools())).not.toContain("~/.config/inno-creed");
});

it("routes tools/call and rejects unknown tools", () => {
  expect(handleStateless(req("tools/call", { name: "approval_counts", arguments: { a: 1 } }))).toEqual({ kind: "call", id: 1, name: "approval_counts", args: { a: 1 } });
  expect(handleStateless(req("tools/call", { name: "approval_counts" }))).toEqual({ kind: "call", id: 1, name: "approval_counts", args: {} });
  expect(handleStateless(req("tools/call", { name: "rm_rf" }))).toEqual({ kind: "error", body: { jsonrpc: "2.0", id: 1, error: { code: -32602, message: expect.stringContaining("모르는 도구") } } });
});

it("describes the protected resource", () => {
  expect(protectedResourceMetadata()).toEqual({
    resource: "https://innocrew.innogrid.com/api/mcp",
    authorization_servers: ["https://avooqcxehfeurjhqqgui.supabase.co/auth/v1"],
    scopes_supported: ["email", "profile"],
    bearer_methods_supported: ["header"],
  });
  expect(wwwAuthenticate()).toBe('Bearer resource_metadata="https://innocrew.innogrid.com/.well-known/oauth-protected-resource"');
});
