import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { parseLogsPayload } from "@/lib/claude-usage/otlp";
import { logIngest, storeLogs } from "@/lib/claude-usage/ingest-store";

export const runtime = "nodejs";

/** OTLP/HTTP JSON 로그(이벤트) 수신 — api_request·user_prompt만 저장 */
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
  const parsed = parseLogsPayload(body);
  const orgIds = [...parsed.requests.map((r) => r.org_id), ...parsed.promptDaily.map((d) => d.org_id)];
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[claude-usage] admin client:", e);
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  try {
    const { rows } = await storeLogs(admin, parsed);
    await logIngest(admin, { signal: "logs", org_ids: orgIds, rows, dropped: parsed.dropped, bytes: raw.length, ok: true });
    return NextResponse.json({});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngest(admin, { signal: "logs", org_ids: orgIds, rows: 0, dropped: parsed.dropped, bytes: raw.length, ok: false, error: msg });
    return NextResponse.json({ error: "store failed" }, { status: 500 });
  }
}
