import { NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";

/** GET — 수집 상태(환경변수 구성 여부·최근 수신·오류·조직별 마지막 데이터 일자) */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const tokenConfigured = (process.env.CLAUDE_OTEL_INGEST_TOKEN ?? "").length >= 8;
  const serviceKeyConfigured = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const empty = { tokenConfigured, serviceKeyConfigured, lastReceivedAt: null, count24h: 0, errors24h: 0, lastError: null, orgLastDay: [] as { org_id: string; last_day: string }[] };
  const c = adminClientOr500();
  if (!c.ok) return NextResponse.json(empty);
  const admin = c.admin;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [last, recent, lastErr, lastDays] = await Promise.all([
    admin.from("claude_ingest_log").select("received_at").order("received_at", { ascending: false }).limit(1),
    admin.from("claude_ingest_log").select("ok").gte("received_at", since),
    admin.from("claude_ingest_log").select("error, received_at").eq("ok", false).order("received_at", { ascending: false }).limit(1),
    admin.from("claude_code_daily").select("org_id, day").order("day", { ascending: false }).limit(2000),
  ]);
  const err = last.error ?? recent.error ?? lastErr.error ?? lastDays.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  const orgLastDay = new Map<string, string>();
  for (const r of lastDays.data ?? []) if (!orgLastDay.has(r.org_id)) orgLastDay.set(r.org_id, r.day);
  return NextResponse.json({
    ...empty,
    lastReceivedAt: last.data?.[0]?.received_at ?? null,
    count24h: recent.data?.length ?? 0,
    errors24h: (recent.data ?? []).filter((r) => !r.ok).length,
    lastError: lastErr.data?.[0] ? `${lastErr.data[0].received_at} ${lastErr.data[0].error ?? ""}` : null,
    orgLastDay: [...orgLastDay].map(([org_id, last_day]) => ({ org_id, last_day })),
  });
}
