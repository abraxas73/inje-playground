import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import os from "node:os";

export const runtime = "nodejs";

/** PUT { logged_in, note?, host, version } — 관리자 Mac 실행기 하트비트(claude_seat_executor 행 1개, Bearer 수집 토큰) */
export async function PUT(request: NextRequest) {
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const b = (await request.json().catch(() => null)) as { logged_in?: unknown; note?: unknown; host?: unknown; version?: unknown } | null;
  const s = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const { error } = await c.admin.from("claude_seat_executor").upsert({
    id: "default", last_seen_at: new Date().toISOString(), logged_in: b?.logged_in === true,
    note: s(b?.note, 200), host: s(b?.host, 80) ?? os.hostname(), version: s(b?.version, 40),
  }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
