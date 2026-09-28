import type { SupabaseClient } from "@supabase/supabase-js";
import type { Freshness, FreshnessSource } from "@/types/work-metrics";

/** 소스별 마지막 수집 시각·실패·오래됨 — work_metrics_sync에서 만든다. 화면 "데이터 기준" 배지용 */
export const FRESHNESS_SOURCES: FreshnessSource[] = ["jira", "gitlab", "confluence"];
export const STALE_AFTER_MS = 48 * 3600_000;

export interface SyncLogRow { source: string; range_to: string; ok: boolean; error: string | null; created_at: string }

export function deriveFreshness(rows: SyncLogRow[], now: Date = new Date()): Freshness {
  const out = {} as Freshness;
  for (const src of FRESHNESS_SOURCES) {
    const mine = rows.filter((r) => r.source === src).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const latest = mine[0];
    const lastOk = mine.find((r) => r.ok);
    const stale = !lastOk || now.getTime() - new Date(lastOk.created_at).getTime() > STALE_AFTER_MS;
    out[src] = {
      lastOkAt: lastOk?.created_at ?? null,
      rangeTo: lastOk?.range_to ?? null,
      lastError: latest && !latest.ok ? (latest.error ?? "수집 실패") : null,
      stale,
    };
  }
  return out;
}

/** 최근 60행(소스별 하루 1~2행이라 2주 남짓)을 읽어 신선도를 만든다. 조회 실패는 전부 오래됨으로 */
export async function loadFreshness(admin: SupabaseClient, now: Date = new Date()): Promise<Freshness> {
  const { data, error } = await admin
    .from("work_metrics_sync")
    .select("source, range_to, ok, error, created_at")
    .in("source", FRESHNESS_SOURCES)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) {
    console.warn(`[work-metrics] 신선도 조회 실패: ${error.message}`);
    return deriveFreshness([], now);
  }
  return deriveFreshness((data ?? []) as SyncLogRow[], now);
}
