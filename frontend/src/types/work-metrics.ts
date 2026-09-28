/**
 * 성과 지표 API 응답 타입 — 라우트(/api/admin/work-metrics/perf, /api/usage/perf, …/perf/hourly)와
 * PerfDashboard가 공유한다. 집계는 lib/work-metrics/perf-report.ts. 설계: docs/superpowers/specs/2026-09-28-perf-time-metrics-design.md
 */

export interface UserPerf {
  email: string;
  name: string | null;
  team: string | null;
  claude_cost: number;
  claude_sessions: number;
  claude_days: number;
  claude_commits: number;
  /** 사람이 친 Claude Code 프롬프트(자동화 제외) */
  claude_prompts: number;
  active_hours: number;
  loc_added: number;
  loc_removed: number;
  issues_created: number;
  issues_resolved: number;
  story_points: number;
  cycle_hours_sum: number;
  cycle_count: number;
  lead_hours_sum: number;
  /** GitLab 커밋(authored 기준, 리베이스 중복 제거) */
  commits: number;
  /** GitLab 커밋 중 Co-Authored-By: Claude 트레일러가 있는 커밋 — commits의 부분집합(하한값) */
  gitlab_claude_commits: number;
  mrs_opened: number;
  mrs_merged: number;
  mr_lead_hours_sum: number;
  pages_created: number;
  pages_updated: number;
}

export interface Weekly {
  week: string;
  claude_sessions: number;
  claude_cost: number;
  claude_commits: number;
  claude_prompts: number;
  issues_created: number;
  issues_resolved: number;
  story_points: number;
  cycle_hours_sum: number;
  cycle_count: number;
  commits: number;
  gitlab_claude_commits: number;
  mrs_opened: number;
  mrs_merged: number;
  mr_lead_hours_sum: number;
  pages_created: number;
  pages_updated: number;
}

export interface JiraProjectPerf { key: string; issues_created: number; issues_resolved: number; story_points: number; cycle_hours_sum: number; cycle_count: number }
export interface RepoPerf { key: string; commits: number; gitlab_claude_commits: number; mrs_opened: number; mrs_merged: number; mr_lead_hours_sum: number }
export interface SpacePerf { key: string; pages_created: number; pages_updated: number }

/** 기간 총계 — 요약 카드·기간 비교·도입 전후가 같은 계산을 쓴다(lib/work-metrics/totals.ts) */
export interface Totals {
  resolved: number; created: number; sp: number;
  cycleSum: number; cycleN: number; leadSum: number;
  commits: number; glClaude: number; claudeCommits: number;
  opened: number; merged: number; mrLead: number;
  pc: number; pu: number; locA: number; locR: number;
  cost: number; sessions: number; prompts: number; hours: number;
}

export interface DateRange { from: string; to: string }

export type FreshnessSource = "jira" | "gitlab" | "confluence";
export interface SourceFreshness {
  /** 마지막 성공 수집 시각(ISO). 없으면 null */
  lastOkAt: string | null;
  /** 마지막 성공 수집의 범위 끝 날짜(YYYY-MM-DD) */
  rangeTo: string | null;
  /** 최신 기록이 실패면 그 오류, 아니면 null */
  lastError: string | null;
  /** 성공 기록이 없거나 48시간보다 오래됨 */
  stale: boolean;
}
export type Freshness = Record<FreshnessSource, SourceFreshness>;

export interface CompareBlock {
  previous: { range: DateRange; totals: Totals };
  adoption: { date: string; before: { range: DateRange; totals: Totals }; after: { range: DateRange; totals: Totals } };
}

/** 소요 시간 RPC(work_items_time_stats) 한 행. grp = "all" | "week:YYYY-MM-DD" | "user:<email>" | "scope:<key>" */
export type TimeMetric = "lead" | "cycle" | "wait";
export interface TimeStatRow {
  grp: string;
  kind: "issue" | "mr";
  metric: TimeMetric;
  n: number;
  p50: number;
  p90: number;
  avg: number;
  /** 분포: ≤4h, ≤1일, ≤3일, ≤1주, >1주 */
  b1: number; b2: number; b3: number; b4: number; b5: number;
}

export type HourlyKind = "commit" | "issue" | "mr";
/** dow는 isodow(1=월 … 7=일), hour는 KST 0~23 */
export interface HourlyCell { kind: HourlyKind; dow: number; hour: number; n: number }
export interface HourlyResponse {
  range: DateRange;
  scope: { scopeLabel: string };
  kinds: HourlyKind[];
  cells: HourlyCell[];
  /** 대상이 3명 미만(본인 화면 제외)이라 숨김 */
  suppressed: boolean;
  notReady: boolean;
}

export interface PerfReport {
  notReady: boolean;
  users: UserPerf[];
  weekly: Weekly[];
  jiraProjects: JiraProjectPerf[];
  repos: RepoPerf[];
  spaces: SpacePerf[];
  /** 2단계: work_items_time_stats 행. RPC가 없으면 [] + durationsReady=false */
  durations: TimeStatRow[];
  durationsReady: boolean;
}

export interface PerfResponse extends PerfReport {
  range: DateRange;
  scope: { scope: "self" | "org"; scopeLabel: string };
  teams?: string[];
  freshness: Freshness;
  compare?: CompareBlock;
}
