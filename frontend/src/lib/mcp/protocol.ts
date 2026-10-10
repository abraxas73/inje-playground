import tools from "./tools.json";

/** 원격 MCP 끝점(무상태 Streamable HTTP, JSON-RPC 2.0 단건) 프로토콜 처리. 스펙 docs/superpowers/specs/2026-10-10-desktop-mcp-connector-design.md §5·§6 */
export const MCP_RESOURCE = "https://innocrew.innogrid.com/api/mcp";
export const MCP_RESOURCE_METADATA_URL = "https://innocrew.innogrid.com/.well-known/oauth-protected-resource";
export const MCP_AUTH_SERVER = "https://avooqcxehfeurjhqqgui.supabase.co/auth/v1";
export const MCP_SERVER_INFO = { name: "innogrid-app", version: "1.0.0" };

export type JsonRpcId = string | number | null;
export type JsonRpcRequest = { jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: unknown };
type Tool = { name: string; description: string; inputSchema: object };

const TOOLS = tools as Tool[];
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseJsonRpc(body: unknown): JsonRpcRequest | { error: { code: number; message: string } } {
  if (Array.isArray(body)) return { error: { code: -32600, message: "배치 요청은 지원하지 않습니다." } };
  if (!isObject(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string" || !body.method) {
    return { error: { code: -32600, message: "잘못된 JSON-RPC 요청입니다." } };
  }
  return body as JsonRpcRequest;
}

export const rpcResult = (id: JsonRpcId, result: unknown): object => ({ jsonrpc: "2.0", id, result });
export const rpcError = (id: JsonRpcId, code: number, message: string): object => ({ jsonrpc: "2.0", id, error: { code, message } });

export function protectedResourceMetadata() {
  return { resource: MCP_RESOURCE, authorization_servers: [MCP_AUTH_SERVER], scopes_supported: ["email", "profile"], bearer_methods_supported: ["header"] };
}

export const wwwAuthenticate = () => `Bearer resource_metadata="${MCP_RESOURCE_METADATA_URL}"`;

export const listTools = (): Tool[] => TOOLS;

export function handleStateless(req: JsonRpcRequest):
  | { kind: "respond"; body: object }
  | { kind: "accepted" }
  | { kind: "call"; id: JsonRpcId; name: string; args: Record<string, unknown> }
  | { kind: "error"; body: object } {
  const id = req.id ?? null;
  const params = isObject(req.params) ? req.params : {};
  if (req.method.startsWith("notifications/")) return { kind: "accepted" };
  switch (req.method) {
    case "initialize":
      return { kind: "respond", body: rpcResult(id, { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: MCP_SERVER_INFO }) };
    case "ping":
      return { kind: "respond", body: rpcResult(id, {}) };
    case "tools/list":
      return { kind: "respond", body: rpcResult(id, { tools: TOOLS }) };
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || !TOOL_NAMES.has(name)) return { kind: "error", body: rpcError(id, -32602, `모르는 도구입니다: ${String(name)}`) };
      return { kind: "call", id, name, args: isObject(params.arguments) ? params.arguments : {} };
    }
    default:
      return { kind: "error", body: rpcError(id, -32601, `지원하지 않는 메서드입니다: ${req.method}`) };
  }
}
