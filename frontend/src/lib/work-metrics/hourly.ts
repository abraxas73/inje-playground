import type { SupabaseClient } from "@supabase/supabase-js";
import type { HourlyCell, HourlyKind } from "@/types/work-metrics";

/**
 * 활동 시간대 — work_items_hourly RPC. 공개 범위: 팀·조직 합계만, 개인별은 본인 화면(self)에서만.
 * 대상(구성원)이나 실제 활동한 사람(기여자)이 3명 미만이면 숨긴다(k-익명성). RPC에 사용자 차원이 없어 개인을 되짚을 수 없다.
 */
export const HOURLY_KINDS: HourlyKind[] = ["commit", "issue", "mr"];
export const MIN_HOURLY_PEOPLE = 3;

export function parseKinds(raw: string | null): HourlyKind[] {
  const picked = new Set<HourlyKind>();
  for (const k of (raw ?? "").split(",").map((s) => s.trim())) if ((HOURLY_KINDS as string[]).includes(k)) picked.add(k as HourlyKind);
  return picked.size ? HOURLY_KINDS.filter((k) => picked.has(k)) : ["commit"];
}

/** 대상 이메일. self면 그대로, 아니면 3명 미만은 숨김(emails null) */
export function hourlyTargets(members: { email: string }[], opts: { self: boolean }): { emails: string[] | null; suppressed: boolean } {
  const emails = members.map((m) => m.email.toLowerCase());
  if (!opts.self && emails.length < MIN_HOURLY_PEOPLE) return { emails: null, suppressed: true };
  return { emails, suppressed: false };
}

/** 기여자 기준 k-익명성: 본인 화면이 아니면 실제 활동한 사람이 3명 미만일 때 숨긴다 */
export function contributorsSuppressed(contributors: number, self: boolean): boolean {
  return !self && contributors < MIN_HOURLY_PEOPLE;
}

/** 기간·종류·대상 안에서 실제 활동한 사람 수 — RPC work_items_contributors */
export async function loadContributors(
  admin: SupabaseClient, opts: { from: string; to: string; emails: string[] | null; kinds: HourlyKind[] }
): Promise<{ contributors: number; notReady: boolean } | { error: string }> {
  const res = await admin.rpc("work_items_contributors", { p_from: opts.from, p_to: opts.to, p_emails: opts.emails, p_kinds: opts.kinds });
  if (res.error) {
    if (/could not find|does not exist|schema cache/i.test(res.error.message)) return { contributors: 0, notReady: true };
    return { error: res.error.message };
  }
  return { contributors: Number(res.data ?? 0), notReady: false };
}

export async function loadHourly(
  admin: SupabaseClient, opts: { from: string; to: string; emails: string[] | null; kinds: HourlyKind[] }
): Promise<{ cells: HourlyCell[]; notReady: boolean } | { error: string }> {
  const res = await admin.rpc("work_items_hourly", { p_from: opts.from, p_to: opts.to, p_emails: opts.emails, p_kinds: opts.kinds });
  if (res.error) {
    if (/could not find|does not exist|schema cache/i.test(res.error.message)) return { cells: [], notReady: true };
    return { error: res.error.message };
  }
  const cells = ((res.data ?? []) as { kind: HourlyKind; dow: number | string; hour: number | string; n: number | string }[])
    .map((c) => ({ kind: c.kind, dow: Number(c.dow), hour: Number(c.hour), n: Number(c.n) }));
  return { cells, notReady: false };
}

/** 업무시간 외 비중. 업무시간 = 평일(isodow 1~5) 09:00~17:59 KST */
export function offHoursShare(cells: HourlyCell[]): { total: number; offHours: number; weekend: number; offShare: number | null; weekendShare: number | null } {
  let total = 0, offHours = 0, weekend = 0;
  for (const c of cells) {
    total += c.n;
    const isWeekend = c.dow >= 6;
    if (isWeekend) weekend += c.n;
    if (isWeekend || c.hour < 9 || c.hour >= 18) offHours += c.n;
  }
  return { total, offHours, weekend, offShare: total ? offHours / total : null, weekendShare: total ? weekend / total : null };
}
