import type { SupabaseClient } from "@supabase/supabase-js";

/** 성과 측정 수집기 공통 — 이메일 정규화·KST 날짜·upsert. 설계: docs/superpowers/specs/2026-08-31-claude-roi-integrations-design.md */

const COMPANY_DOMAIN = "innogrid.com";

/** 계정 표기가 이메일 또는 로컬파트(@ 앞부분)로 섞여 있어 회사 이메일로 정규화한다 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) return s;
  if (!/^[\w.+-]+$/.test(s)) return null;
  return `${s}@${COMPANY_DOMAIN}`;
}

/** ISO/timestamp → KST YYYY-MM-DD */
export function kstDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** KST 하루의 UTC 경계 [00:00, 다음날 00:00) */
export function kstDayBoundsUtc(day: string): { fromIso: string; toIso: string } {
  const from = new Date(`${day}T00:00:00+09:00`);
  const to = new Date(from.getTime() + 24 * 3600_000);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/** KST 어제 */
export function kstYesterday(): string {
  return new Date(Date.now() + 9 * 3600_000 - 24 * 3600_000).toISOString().slice(0, 10);
}

/** from~to(포함)의 날짜 나열 */
export function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 24 * 3600_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function hoursBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return ms > 0 ? ms / 3600_000 : 0;
}

/** 500행씩 나눠 upsert. 실패 시 즉시 throw */
export async function upsertChunked(admin: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string): Promise<number> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table} upsert 실패: ${error.message}`);
  }
  return rows.length;
}

/** 수집 이력 기록(실패해도 무시) */
export async function logSync(admin: SupabaseClient, source: string, from: string, to: string, rows: number, ok: boolean, error?: string): Promise<void> {
  const { error: e } = await admin.from("work_metrics_sync").insert({ source, range_from: from, range_to: to, rows, ok, error: error?.slice(0, 500) ?? null });
  if (e) console.warn(`[work-metrics] sync 로그 기록 실패: ${e.message}`);
}

export interface CollectResult {
  source: string;
  rows: number;
  notes?: string;
}
