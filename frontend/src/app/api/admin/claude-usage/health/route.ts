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
  const [last, recent, lastErr, orgsRes] = await Promise.all([
    admin.from("claude_ingest_log").select("received_at").order("received_at", { ascending: false }).limit(1),
    admin.from("claude_ingest_log").select("ok").gte("received_at", since),
    admin.from("claude_ingest_log").select("error, received_at").eq("ok", false).order("received_at", { ascending: false }).limit(1),
    admin.from("claude_orgs").select("id"),
  ]);
  const err = last.error ?? recent.error ?? lastErr.error ?? orgsRes.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  const orgIds = (orgsRes.data ?? []).map((o) => o.id as string);
  const lastDayByOrg = await Promise.all(
    orgIds.map((id) => admin.from("claude_code_daily").select("day").eq("org_id", id).order("day", { ascending: false }).limit(1))
  );
  const lastDayErr = lastDayByOrg.find((r) => r.error)?.error;
  if (lastDayErr) return NextResponse.json({ error: lastDayErr.message }, { status: 500 });
  const orgLastDay: { org_id: string; last_day: string }[] = [];
  orgIds.forEach((id, i) => {
    const day = lastDayByOrg[i].data?.[0]?.day;
    if (day) orgLastDay.push({ org_id: id, last_day: day });
  });

  return NextResponse.json({
    ...empty,
    lastReceivedAt: last.data?.[0]?.received_at ?? null,
    count24h: recent.data?.length ?? 0,
    errors24h: (recent.data ?? []).filter((r) => !r.ok).length,
    lastError: lastErr.data?.[0] ? `${lastErr.data[0].received_at} ${lastErr.data[0].error ?? ""}` : null,
    orgLastDay,
  });
}
