import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/claude-usage/aggregate";
import type { CompareBlock, DateRange, Totals } from "@/types/work-metrics";
import { ADOPTION_DATE } from "./adoption";
import { buildPerfReport, type PerfMember } from "./perf-report";
import { totalsOf } from "./totals";

/** 기간 비교 — 직전 같은 길이 기간, 도입 전후 4주. 총계만 만든다(사용자·주별 목록은 없음) */

const spanDays = (r: DateRange) =>
  Math.round((new Date(`${r.to}T00:00:00Z`).getTime() - new Date(`${r.from}T00:00:00Z`).getTime()) / 86400_000) + 1;

/** 같은 길이의 직전 기간: to' = from − 1일 */
export function prevRange(range: DateRange): DateRange {
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(spanDays(range) - 1)), to };
}

/** 도입일 전 4주(도입 전날까지)·후 4주(도입일부터) */
export function adoptionWindows(date: string = ADOPTION_DATE): { date: string; before: DateRange; after: DateRange } {
  return { date, before: { from: addDays(date, -28), to: addDays(date, -1) }, after: { from: date, to: addDays(date, 27) } };
}

type Block = { range: DateRange; totals: Totals };

export async function loadCompare(
  admin: SupabaseClient,
  opts: { from: string; to: string; members: PerfMember[]; filterEmails: string[] | null }
): Promise<CompareBlock | { error: string }> {
  const win = adoptionWindows();
  const run = async (range: DateRange): Promise<Block | { error: string }> => {
    const res = await buildPerfReport(admin, { from: range.from, to: range.to, members: opts.members, filterEmails: opts.filterEmails });
    return res.ok ? { range, totals: totalsOf(res.report.users) } : { error: res.error };
  };
  const [previous, before, after] = await Promise.all([run(prevRange({ from: opts.from, to: opts.to })), run(win.before), run(win.after)]);
  for (const b of [previous, before, after]) if ("error" in b) return { error: b.error };
  return {
    previous: previous as Block,
    adoption: { date: win.date, before: before as Block, after: after as Block },
  };
}
