import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { handleStateless, parseJsonRpc, rpcError, wwwAuthenticate } from "@/lib/mcp/protocol";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BODY = 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** 원격 MCP 끝점(무상태 Streamable HTTP). claude.ai 커넥터가 Supabase OAuth 액세스 토큰(Bearer)으로 부른다. */
export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY) return json({ error: "요청 본문이 너무 큽니다(최대 1MB)." }, 413);
  const auth = await requireUser();
  if (!auth.ok) {
    // 401에서만 — 403(guest)·500에 붙이면 Claude가 사인인을 되풀이한다.
    if (auth.response.status === 401) auth.response.headers.set("WWW-Authenticate", wwwAuthenticate());
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY) return json({ error: "요청 본문이 너무 큽니다(최대 1MB)." }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json(rpcError(null, -32700, "JSON을 해석하지 못했습니다.")); }
  const req = parseJsonRpc(body);
  if ("error" in req) return json(rpcError(null, req.error.code, req.error.message));
  const out = handleStateless(req);
  if (out.kind === "accepted") return new NextResponse(null, { status: 202, headers: NO_STORE });
  // Task 3에서 mcp_calls 중계로 바꾼다.
  if (out.kind === "call") return json(rpcError(out.id, -32603, "중계 미구현"));
  return json(out.body);
}

export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST, DELETE", ...NO_STORE } });
}

/** 세션을 발급하지 않으므로 종료할 것도 없다. */
export async function DELETE() {
  return new NextResponse(null, { status: 200, headers: NO_STORE });
}
