import { NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";

/** GET — 수집 상태(환경변수 구성 여부·최근 수신·오류·조직별 마지막 데이터 일자) */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const tokenConfigured = (process.env.CLAUDE_OTEL_INGEST_TOKEN ?? "").length >= 8;
  const serviceKeyConfigured = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const empty = {
    tokenConfigured,
    serviceKeyConfigured,
    lastReceivedAt: null,
    count24h: 0,
    errors24h: 0,
    lastError: null,
    orgLastDay: [] as { org_id: string; last_day: string }[],
    /** 멤버 활동 CSV 마지막 수집(업로드) 시각 — 전체 최신 */
    lastCsvImportAt: null as string | null,
    /** 조직별 최신 CSV import(기간 끝·업로드 시각) */
    csvLatestByOrg: [] as { org_id: string; period_end: string; created_at: string }[],
  };
  const c = adminClientOr500();
  if (!c.ok) return NextResponse.json(empty);
  const admin = c.admin;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [last, count24h, errors24h, lastErr, orgsRes, csvImports] = await Promise.all([
    admin.from("claude_ingest_log").select("received_at").order("received_at", { ascending: false }).limit(1),
    admin.from("claude_ingest_log").select("*", { count: "exact", head: true }).gte("received_at", since),
    admin.from("claude_ingest_log").select("*", { count: "exact", head: true }).gte("received_at", since).eq("ok", false),
    admin.from("claude_ingest_log").select("error, received_at").eq("ok", false).order("received_at", { ascending: false }).limit(1),
    admin.from("claude_orgs").select("id"),
    admin.from("claude_csv_imports").select("org_id, period_end, created_at").order("created_at", { ascending: false }),
  ]);
  const err = last.error ?? count24h.error ?? errors24h.error ?? lastErr.error ?? orgsRes.error ?? csvImports.error;
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

  // 조직별 최신 CSV import(created_at 내림차순이므로 조직당 첫 행) + 전체 최신 업로드 시각
  const csvLatestByOrg: { org_id: string; period_end: string; created_at: string }[] = [];
  const seenCsvOrg = new Set<string>();
  for (const i of csvImports.data ?? []) {
    if (seenCsvOrg.has(i.org_id)) continue;
    seenCsvOrg.add(i.org_id);
    csvLatestByOrg.push({ org_id: i.org_id, period_end: i.period_end, created_at: i.created_at });
  }

  return NextResponse.json({
    ...empty,
    lastCsvImportAt: csvImports.data?.[0]?.created_at ?? null,
    csvLatestByOrg,
    lastReceivedAt: last.data?.[0]?.received_at ?? null,
    count24h: count24h.count ?? 0,
    errors24h: errors24h.count ?? 0,
    lastError: lastErr.data?.[0] ? `${lastErr.data[0].received_at} ${lastErr.data[0].error ?? ""}` : null,
    orgLastDay,
  });
}
