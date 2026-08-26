import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { logIngest } from "@/lib/claude-usage/ingest-store";

export interface IngestSpec<P> {
  signal: "metrics" | "logs";
  parse: (body: unknown) => P;
  orgIds: (parsed: P) => string[];
  dropped: (parsed: P) => number;
  store: (admin: SupabaseClient, parsed: P) => Promise<{ rows: number }>;
}

/** OTLP/HTTP JSON 수신 공통 처리 — 두 라우트(/v1/metrics, /v1/logs)가 공유 */
export async function handleOtlpIngest<P>(req: Request, spec: IngestSpec<P>): Promise<NextResponse> {
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
  const parsed = spec.parse(body);
  const orgIds = spec.orgIds(parsed);
  const dropped = spec.dropped(parsed);
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[claude-usage] admin client:", e);
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  try {
    const { rows } = await spec.store(admin, parsed);
    await logIngest(admin, { signal: spec.signal, org_ids: orgIds, rows, dropped, bytes: raw.length, ok: true });
    return NextResponse.json({});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngest(admin, { signal: spec.signal, org_ids: orgIds, rows: 0, dropped, bytes: raw.length, ok: false, error: msg });
    // 저장 실패는 DB/RPC의 일시적 오류일 수 있으므로 503으로 응답해 OTel 익스포터가 재시도하도록 한다(500은 재시도 안 함).
    return NextResponse.json({ error: "store failed" }, { status: 503, headers: { "Retry-After": "30" } });
  }
}
