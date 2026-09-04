import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { parseTracesPayload } from "@/lib/claude-usage/otlp-traces";

export const runtime = "nodejs";

/**
 * POST /api/otel/v1/traces — Claude for M365 추가 기능의 커스텀 OpenTelemetry 수집기 엔드포인트(스파이크).
 * 추가 기능은 사용자 브라우저(Office WebView, origin https://pivot.claude.ai)에서 직접 POST하므로 CORS preflight를 처리해야 한다.
 * 인증은 조직 설정 otlp_headers의 `Authorization=Bearer <CLAUDE_OFFICE_OTEL_TOKEN>` — Claude Code 수집 토큰과 분리(모든 사용자 브라우저에 배포되는 값).
 * 스팬의 프롬프트·도구 입출력·문서 URL은 파서가 읽지 않으며, 집계 속성만 claude_office_trace_log에 남긴다.
 */

const ALLOWED_ORIGIN = "https://pivot.claude.ai";

function corsHeaders(origin: string | null): Record<string, string> {
  // 허용 origin만 반사. 그 외 origin은 헤더를 내려주지 않아 브라우저가 차단한다.
  const allow = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

  if (!verifyIngestToken(req.headers.get("authorization"), process.env.CLAUDE_OFFICE_OTEL_TOKEN)) {
    return json({ error: "unauthorized" }, 401);
  }
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  const raw = await req.arrayBuffer();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[office-otel] admin client:", e);
    return json({ error: "server not configured" }, 500);
  }

  // protobuf(otlp_protocol=http/protobuf)로 오면 수신 사실만 남기고 415 — 조직 설정은 기본 http/json
  if (!ct.includes("application/json")) {
    await admin.from("claude_office_trace_log").insert({ span_name: `unparsed:${ct || "no-content-type"}`, bytes: raw.byteLength, attr_keys: [] });
    return json({ error: "use http/json" }, 415);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const parsed = parseTracesPayload(body);
  const rows = parsed.rows.map((r) => ({ ...r, bytes: null as number | null }));
  if (rows.length === 0) {
    await admin.from("claude_office_trace_log").insert({ span_name: "empty", bytes: raw.byteLength, attr_keys: parsed.serviceNames });
    return json({});
  }
  const ins = await admin.from("claude_office_trace_log").insert(rows);
  if (ins.error) {
    console.error("[office-otel] insert:", ins.error.message);
    return json({ error: "store failed" }, 503);
  }
  return json({});
}
