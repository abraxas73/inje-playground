import { describe, expect, it } from "vitest";
import { avgOf, delta, totalsOf } from "@/lib/work-metrics/totals";
import type { UserPerf } from "@/types/work-metrics";

const user = (o: Partial<UserPerf>): UserPerf => ({
  email: "a@innogrid.com", name: null, team: null,
  claude_cost: 0, claude_sessions: 0, claude_days: 0, claude_commits: 0, claude_prompts: 0, active_hours: 0, loc_added: 0, loc_removed: 0,
  issues_created: 0, issues_resolved: 0, story_points: 0, cycle_hours_sum: 0, cycle_count: 0, lead_hours_sum: 0,
  commits: 0, gitlab_claude_commits: 0, mrs_opened: 0, mrs_merged: 0, mr_lead_hours_sum: 0, pages_created: 0, pages_updated: 0, ...o,
});

describe("totalsOf", () => {
  it("구성원 지표를 합산한다(빈 목록은 0)", () => {
    const t = totalsOf([
      user({ issues_resolved: 3, cycle_hours_sum: 30, cycle_count: 2, commits: 5, gitlab_claude_commits: 2, mrs_merged: 1, mr_lead_hours_sum: 4, claude_cost: 1.5 }),
      user({ email: "b@innogrid.com", issues_resolved: 1, cycle_hours_sum: 5, cycle_count: 1, commits: 1, claude_cost: 0.5 }),
    ]);
    expect(t).toMatchObject({ resolved: 4, cycleSum: 35, cycleN: 3, commits: 6, glClaude: 2, merged: 1, mrLead: 4, cost: 2 });
    expect(totalsOf([]).resolved).toBe(0);
  });
});

describe("delta", () => {
  it("직전 값이 0이면 null, 아니면 정수 %와 방향", () => {
    expect(delta(10, 0)).toBeNull();
    expect(delta(12, 10)).toEqual({ pct: 20, good: true });
    expect(delta(8, 10)).toEqual({ pct: -20, good: false });
  });
  it("소요 시간처럼 줄어야 좋은 지표는 방향이 반대다", () => {
    expect(delta(8, 10, true)).toEqual({ pct: -20, good: true });
    expect(delta(10, 10, true)).toEqual({ pct: 0, good: true });
  });
});

describe("avgOf", () => {
  it("건수 0이면 null", () => {
    expect(avgOf(10, 0)).toBeNull();
    expect(avgOf(10, 4)).toBe(2.5);
  });
});
