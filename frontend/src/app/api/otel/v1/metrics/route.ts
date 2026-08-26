import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { parseMetricsPayload } from "@/lib/claude-usage/otlp";
import { logIngest, storeMetrics } from "@/lib/claude-usage/ingest-store";

export const runtime = "nodejs";

/** OTLP/HTTP JSON 메트릭 수신 — Claude Code 관리형 설정의 OTEL_EXPORTER_OTLP_ENDPOINT + /v1/metrics */
export async function POST(req: Request) {
  if (!verifyIngestToken(req.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "use OTEL_EXPORTER_OTLP_PROTOCOL=http/json" }, { status: 415 });
  }
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parseMetricsPayload(body);
  const orgIds = parsed.daily.map((d) => d.org_id);
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[claude-usage] admin client:", e);
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  try {
    const { rows } = await storeMetrics(admin, parsed);
    await logIngest(admin, { signal: "metrics", org_ids: orgIds, rows, dropped: parsed.dropped, bytes: raw.length, ok: true });
    return NextResponse.json({});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngest(admin, { signal: "metrics", org_ids: orgIds, rows: 0, dropped: parsed.dropped, bytes: raw.length, ok: false, error: msg });
    return NextResponse.json({ error: "store failed" }, { status: 500 });
  }
}
