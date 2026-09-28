import type { Totals, UserPerf } from "@/types/work-metrics";

/** 기간 총계 — 요약 카드(클라이언트)와 기간 비교(서버)가 같은 합산을 쓴다 */
export const EMPTY_TOTALS: Totals = {
  resolved: 0, created: 0, sp: 0, cycleSum: 0, cycleN: 0, leadSum: 0,
  commits: 0, glClaude: 0, claudeCommits: 0, opened: 0, merged: 0, mrLead: 0,
  pc: 0, pu: 0, locA: 0, locR: 0, cost: 0, sessions: 0, prompts: 0, hours: 0,
};

export function totalsOf(users: UserPerf[]): Totals {
  const t = { ...EMPTY_TOTALS };
  for (const u of users) {
    t.resolved += u.issues_resolved; t.created += u.issues_created; t.sp += u.story_points;
    t.cycleSum += u.cycle_hours_sum; t.cycleN += u.cycle_count; t.leadSum += u.lead_hours_sum;
    t.commits += u.commits; t.glClaude += u.gitlab_claude_commits; t.claudeCommits += u.claude_commits;
    t.opened += u.mrs_opened; t.merged += u.mrs_merged; t.mrLead += u.mr_lead_hours_sum;
    t.pc += u.pages_created; t.pu += u.pages_updated; t.locA += u.loc_added; t.locR += u.loc_removed;
    t.cost += u.claude_cost; t.sessions += u.claude_sessions; t.prompts += u.claude_prompts; t.hours += u.active_hours;
  }
  return t;
}

/** 직전 기간 대비 변화율(정수 %). prev가 0이면 null. lowerIsBetter면 감소(또는 동일)가 좋은 방향 */
export function delta(cur: number, prev: number, lowerIsBetter = false): { pct: number; good: boolean } | null {
  if (!(prev > 0)) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { pct, good: lowerIsBetter ? pct <= 0 : pct >= 0 };
}

/** 평균 = 합/건수. 건수 0이면 null */
export const avgOf = (sum: number, count: number): number | null => (count > 0 ? sum / count : null);
