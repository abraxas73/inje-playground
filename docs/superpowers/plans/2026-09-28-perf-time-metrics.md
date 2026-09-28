# 성과 측정 시간 정보 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 성과 측정 화면(`/admin/perf`, `/usage/perf`)에 데이터 기준 시점, 직전 기간·도입 전후 비교, 소요 시간 분포(p50/p90·체류), 활동 시간대 히트맵을 올린다.

**Architecture:** 1단계는 기존 일 집계와 수집 로그만으로 기준 시점 배지·기간 비교를 붙인다. 2단계는 이슈·MR·커밋을 한 행씩 담는 `work_items` 테이블과 RPC 2개(`work_items_time_stats`, `work_items_hourly`)를 깔고, Jira 수집기·GitLab 로컬 스크립트·sync API가 항목을 쓰게 한 뒤 화면을 p50·분포·시간대로 바꾼다. 시간대는 RPC에 사용자 차원이 없어 개인별 노출이 구조적으로 불가능하다.

**Tech Stack:** Next.js 16 App Router(Node 런타임 라우트), React 19, Supabase(service_role, RPC `security definer`), Postgres `percentile_cont`·grouping sets, vitest + @testing-library/react, Python 3 표준 라이브러리(로컬 GitLab 스크립트).

**Spec:** `docs/superpowers/specs/2026-09-28-perf-time-metrics-design.md`

## Global Constraints

- 작업은 `main`에 직접 커밋한다(feature 브랜치 없음). 커밋 메시지 끝에 세션 attribution 트레일러 2줄(`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, `Claude-Session: https://claude.ai/code/session_01AduDdkuDZWRPG4WAvyTmjr`).
- 테스트·린트는 `frontend/`에서 `npm test`(vitest run), `npm run lint`(ESLint 9, 0 오류), 타입은 `npx tsc --noEmit`.
- 배포는 반드시 `cd frontend && NODE_OPTIONS= vercel deploy --prod --yes` 뒤 `vercel inspect https://inje-playground.vercel.app`의 url이 방금 배포(`innogrid-playground-…`)와 같은지 확인. 루트에서 실행 금지.
- 운영 DB DDL은 Management API(curl)로 적용한다(런북 메모리 `supabase-sql-via-management-api`). 토큰·시크릿은 어떤 로그·응답·커밋에도 쓰지 않는다.
- 시각 기준은 모두 KST(`Asia/Seoul`). 업무시간 = 평일(isodow 1~5) 09:00~17:59.
- 확정값: 신선도 48시간, 도입일 `2026-08-27`, 시간대 최소 인원 3명.
- 시간대 데이터는 팀·조직 합계만. 개인별 시간대는 본인 화면(scope self)에서만.
- GitLab 집계 규칙은 서버 `lib/work-metrics/gitlab.ts`와 `frontend/scripts/gitlab-metrics-sync.py` 두 곳을 항상 같이 고친다.
- Supabase 조회는 1000행 상한이 있어 대량 조회는 `selectAll`(`lib/work-metrics/common.ts`).
- 라우트 응답은 `Cache-Control: no-store`(시간대 라우트 신규분).

## Review Focus

1. **수집 로그가 비어 있는 첫 배포 직후**(어떤 소스도 `work_metrics_sync` 행 없음): 배지가 "없음 · 오래됨"으로 뜨고 화면은 정상 렌더. → Task 3 `deriveFreshness([])` 테스트.
2. **하루짜리 기간**(from = to)의 직전 기간: 정확히 그 전날 하루. → Task 4 `prevRange` 테스트.
3. **2단계 코드가 RPC보다 먼저 배포된 상태**: `durationsReady=false`로 내려가고 화면은 평균으로 폴백, 500이 아니다. → Task 14 `loadDurations` 테스트(가짜 admin이 "could not find" 오류).
4. **시간대 팀 필터 결과가 2명**: `suppressed=true`, 셀 없음. 본인(self)은 1명이어도 보임. → Task 14 `hourlyTargets` 테스트.
5. **항목의 완료 시각이 생성 시각보다 앞선 경우**(시계 오차·수동 입력): sync 검증기가 created_at으로 보정하고 RPC는 `greatest(0, …)`로 잘라낸다. → Task 9 `normalizeGitlabItem` 테스트.
6. **In Progress 전이가 없는 이슈**: `started_at=null`이면 사이클·대기에서 빠지고 리드만 집계된다. → Task 9 `jiraIssueItem` 테스트 + Task 8 SQL 수동 검증 3.

---

## 1단계 — 수집 변경 없이 표시

### Task 1: 응답 타입 파일과 perf-report 타입 이동

**Files:**
- Create: `frontend/src/types/work-metrics.ts`
- Modify: `frontend/src/lib/work-metrics/perf-report.ts:15-78`
- Test: 기존 테스트 전체 + `npx tsc --noEmit`

**Interfaces:**
- Produces: `UserPerf`, `Weekly`, `JiraProjectPerf`, `RepoPerf`, `SpacePerf`, `PerfReport`, `Totals`, `DateRange`, `FreshnessSource`, `SourceFreshness`, `Freshness`, `CompareBlock`, `PerfResponse`(`@/types/work-metrics`). `perf-report.ts`는 같은 이름을 re-export한다.

- [ ] **Step 1: 타입 파일 작성**

`frontend/src/types/work-metrics.ts`:

```ts
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
```

- [ ] **Step 2: perf-report.ts의 인터페이스를 타입 파일로 교체**

`frontend/src/lib/work-metrics/perf-report.ts` 15~78행(`export interface PerfMember` 다음부터 `PerfReport`까지)을 아래로 바꾼다. `PerfMember`는 그대로 둔다.

```ts
import type { JiraProjectPerf, PerfReport, RepoPerf, SpacePerf, UserPerf, Weekly } from "@/types/work-metrics";
export type { UserPerf, Weekly, PerfReport } from "@/types/work-metrics";
```

`buildPerfReport`의 return 객체에 두 필드를 추가한다(2단계 Task 14에서 실제 값으로 바뀐다):

```ts
      spaces: top(spaces, (v) => v.pages_created + v.pages_updated),
      durations: [],
      durationsReady: false,
```

`dim<…>()` 세 줄의 인라인 타입은 그대로 두어도 되지만 `top()` 결과 타입이 `JiraProjectPerf[]` 등과 맞도록 `PerfReport`에 대입 가능해야 한다. `top`은 `{ key, ...v }`를 만들므로 구조적으로 일치한다. 타입 오류가 나면 `jiraProjects: top(jiraProjects, …) as JiraProjectPerf[]`처럼 단언한다.

- [ ] **Step 3: 타입·테스트 통과 확인**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run 2>&1 | tail -5`
Expected: 타입 오류 0, 기존 테스트 전부 PASS.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/types/work-metrics.ts frontend/src/lib/work-metrics/perf-report.ts
git commit -m "refactor(perf): 성과 지표 응답 타입을 types/work-metrics.ts로 모음"
```

---

### Task 2: 총계·증감 순수 함수 `totals.ts`

**Files:**
- Create: `frontend/src/lib/work-metrics/totals.ts`
- Test: `frontend/src/lib/__tests__/work-metrics-totals.test.ts`

**Interfaces:**
- Consumes: `Totals`, `UserPerf`(Task 1)
- Produces: `EMPTY_TOTALS: Totals`, `totalsOf(users: UserPerf[]): Totals`, `delta(cur: number, prev: number, lowerIsBetter?: boolean): { pct: number; good: boolean } | null`, `avgOf(sum: number, count: number): number | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/work-metrics-totals.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-totals.test.ts`
Expected: FAIL — `Cannot find module '@/lib/work-metrics/totals'`

- [ ] **Step 3: 구현**

`frontend/src/lib/work-metrics/totals.ts`:

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-totals.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/work-metrics/totals.ts frontend/src/lib/__tests__/work-metrics-totals.test.ts
git commit -m "feat(perf): 기간 총계·증감 순수 함수 totals.ts"
```

---

### Task 3: 데이터 기준 시점 `freshness.ts`

**Files:**
- Create: `frontend/src/lib/work-metrics/freshness.ts`
- Test: `frontend/src/lib/__tests__/work-metrics-freshness.test.ts`

**Interfaces:**
- Consumes: `Freshness`, `FreshnessSource`(Task 1)
- Produces: `FRESHNESS_SOURCES`, `STALE_AFTER_MS`, `SyncLogRow`, `deriveFreshness(rows: SyncLogRow[], now?: Date): Freshness`, `loadFreshness(admin: SupabaseClient, now?: Date): Promise<Freshness>`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/work-metrics-freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveFreshness, type SyncLogRow } from "@/lib/work-metrics/freshness";

const now = new Date("2026-09-28T01:00:00Z");
const row = (source: string, created_at: string, ok = true, error: string | null = null): SyncLogRow => ({ source, range_to: created_at.slice(0, 10), ok, error, created_at });

describe("deriveFreshness", () => {
  it("기록이 전혀 없으면 세 소스 모두 없음·오래됨", () => {
    const f = deriveFreshness([], now);
    expect(f.jira).toEqual({ lastOkAt: null, rangeTo: null, lastError: null, stale: true });
    expect(f.gitlab.stale).toBe(true);
    expect(f.confluence.stale).toBe(true);
  });
  it("최근 성공이 48시간 안이면 신선, 넘으면 오래됨", () => {
    const f = deriveFreshness([row("jira", "2026-09-27T22:30:00Z"), row("gitlab", "2026-09-25T22:45:00Z")], now);
    expect(f.jira).toMatchObject({ lastOkAt: "2026-09-27T22:30:00Z", rangeTo: "2026-09-27", stale: false, lastError: null });
    expect(f.gitlab.stale).toBe(true);
  });
  it("최신 기록이 실패면 오류를 싣고, 마지막 성공은 그 전 성공 행이다", () => {
    const f = deriveFreshness([row("jira", "2026-09-27T22:30:00Z"), row("jira", "2026-09-28T00:30:00Z", false, "Jira 401")], now);
    expect(f.jira).toEqual({ lastOkAt: "2026-09-27T22:30:00Z", rangeTo: "2026-09-27", lastError: "Jira 401", stale: false });
  });
  it("정렬되지 않은 입력·다른 소스(gitlab_items)는 무시한다", () => {
    const f = deriveFreshness([row("gitlab", "2026-09-26T22:45:00Z"), row("gitlab", "2026-09-27T22:45:00Z"), row("gitlab_items", "2026-09-27T23:00:00Z")], now);
    expect(f.gitlab.lastOkAt).toBe("2026-09-27T22:45:00Z");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-freshness.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/work-metrics/freshness.ts`:

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-freshness.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/work-metrics/freshness.ts frontend/src/lib/__tests__/work-metrics-freshness.test.ts
git commit -m "feat(perf): 수집 로그로 소스별 데이터 기준 시점(freshness) 계산"
```

---

### Task 4: 기간 비교 `compare.ts`와 도입일 상수

**Files:**
- Create: `frontend/src/lib/work-metrics/adoption.ts`
- Create: `frontend/src/lib/work-metrics/compare.ts`
- Test: `frontend/src/lib/__tests__/work-metrics-compare.test.ts`

**Interfaces:**
- Consumes: `addDays`(`@/lib/claude-usage/aggregate`, `(day: string, n: number) => string`), `buildPerfReport`·`PerfMember`(perf-report), `totalsOf`(Task 2), `DateRange`·`CompareBlock`(Task 1)
- Produces: `ADOPTION_DATE = "2026-08-27"`, `prevRange(range: DateRange): DateRange`, `adoptionWindows(date?: string): { date: string; before: DateRange; after: DateRange }`, `loadCompare(admin, opts: { from; to; members: PerfMember[]; filterEmails: string[] | null }): Promise<CompareBlock | { error: string }>`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/work-metrics-compare.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adoptionWindows, prevRange } from "@/lib/work-metrics/compare";
import { ADOPTION_DATE } from "@/lib/work-metrics/adoption";

describe("prevRange", () => {
  it("같은 길이의 직전 기간 — 30일", () => {
    expect(prevRange({ from: "2026-08-30", to: "2026-09-28" })).toEqual({ from: "2026-07-31", to: "2026-08-29" });
  });
  it("하루짜리 기간은 그 전날 하루", () => {
    expect(prevRange({ from: "2026-09-01", to: "2026-09-01" })).toEqual({ from: "2026-08-31", to: "2026-08-31" });
  });
  it("월 경계·윤년을 넘는다", () => {
    expect(prevRange({ from: "2028-03-01", to: "2028-03-02" })).toEqual({ from: "2028-02-28", to: "2028-02-29" });
  });
});

describe("adoptionWindows", () => {
  it("도입일 전 4주·후 4주", () => {
    expect(adoptionWindows("2026-08-27")).toEqual({ date: "2026-08-27", before: { from: "2026-07-30", to: "2026-08-26" }, after: { from: "2026-08-27", to: "2026-09-23" } });
    expect(adoptionWindows().date).toBe(ADOPTION_DATE);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-compare.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/work-metrics/adoption.ts`:

```ts
/** Claude Code 관리형 설정 전사 적용일(KST). 도입 전후 비교의 기준. 설정 화면으로 옮기는 것은 후속 */
export const ADOPTION_DATE = "2026-08-27";
```

`frontend/src/lib/work-metrics/compare.ts`:

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-compare.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests), 타입 오류 0

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/work-metrics/adoption.ts frontend/src/lib/work-metrics/compare.ts frontend/src/lib/__tests__/work-metrics-compare.test.ts
git commit -m "feat(perf): 직전 기간·도입 전후 4주 총계 비교(compare.ts)"
```

---

### Task 5: 성과 API 두 라우트에 freshness·compare 응답

**Files:**
- Modify: `frontend/src/app/api/admin/work-metrics/perf/route.ts:46-57`
- Modify: `frontend/src/app/api/usage/perf/route.ts:35-44`
- Test: 타입 검사 + 로컬 curl(선택)

**Interfaces:**
- Consumes: `loadFreshness`(Task 3), `loadCompare`(Task 4)
- Produces: 응답이 `PerfResponse`(Task 1) 형태. `compare`는 쿼리 `compare=1`일 때만.

- [ ] **Step 1: 어드민 라우트 수정**

`frontend/src/app/api/admin/work-metrics/perf/route.ts` 상단 import에 추가:

```ts
import { loadFreshness } from "@/lib/work-metrics/freshness";
import { loadCompare } from "@/lib/work-metrics/compare";
import type { PerfResponse } from "@/types/work-metrics";
```

46행 `const result = await buildPerfReport(...)`부터 끝까지를 아래로 바꾼다:

```ts
  const wantCompare = sp.get("compare") === "1";
  const [result, freshness, compare] = await Promise.all([
    buildPerfReport(admin, { from, to, members, filterEmails }),
    loadFreshness(admin),
    wantCompare ? loadCompare(admin, { from, to, members, filterEmails }) : Promise.resolve(null),
  ]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  if (compare && "error" in compare) console.warn(`[work-metrics] compare 실패: ${compare.error}`);

  const label = [team, q ? `"${q}"` : null].filter(Boolean).join(" · ");
  const body: PerfResponse = {
    range: { from, to },
    scope: { scope: "org", scopeLabel: label ? `${label} (${members.length}명)` : `전체 (${members.length}명)` },
    teams,
    freshness,
    ...(compare && !("error" in compare) ? { compare } : {}),
    ...result.report,
  };
  return NextResponse.json(body);
}
```

- [ ] **Step 2: 개인용 라우트 수정**

`frontend/src/app/api/usage/perf/route.ts`에 같은 import 3줄을 추가하고 35행부터 끝까지를 아래로 바꾼다:

```ts
  const wantCompare = sp.get("compare") === "1";
  const [result, freshness, compare] = await Promise.all([
    buildPerfReport(admin, { from, to, members, filterEmails }),
    loadFreshness(admin),
    wantCompare ? loadCompare(admin, { from, to, members, filterEmails }) : Promise.resolve(null),
  ]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  if (compare && "error" in compare) console.warn(`[work-metrics] compare 실패: ${compare.error}`);

  const filterLabel = [team, q ? `"${q}"` : null].filter(Boolean).join(" · ");
  const body: PerfResponse = {
    range: { from, to },
    scope: { scope: scope.scope, scopeLabel: filterLabel ? `${filterLabel} (${members.length}명)` : scope.scopeLabel },
    ...(scope.scope === "org" && teams.length > 1 ? { teams } : {}),
    freshness,
    ...(compare && !("error" in compare) ? { compare } : {}),
    ...result.report,
  };
  return NextResponse.json(body);
}
```

- [ ] **Step 3: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: 오류 0

- [ ] **Step 4: 로컬 확인(선택)**

`./frontend/scripts/restart-frontend.sh` 후 브라우저에서 로그인한 뒤 개발자 도구로 `/api/usage/perf?compare=1` 응답에 `freshness`(세 소스)·`compare.previous`·`compare.adoption`이 있는지 본다. 로컬 DB가 운영과 같은 프로젝트라 값이 채워진다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/app/api/admin/work-metrics/perf/route.ts frontend/src/app/api/usage/perf/route.ts
git commit -m "feat(perf): 성과 API에 데이터 기준 시점·기간 비교(compare=1) 응답"
```

---

### Task 6: 대시보드 1단계 — 배지·증감·도입 전후 카드·도입일 강조

**Files:**
- Modify: `frontend/src/components/usage/PerfDashboard.tsx`
- Test: `npx tsc --noEmit`, `npm run lint`, 브라우저 확인

**Interfaces:**
- Consumes: `PerfResponse`·`Freshness`·`FreshnessSource`·`CompareBlock`·`Totals`·`Weekly`(Task 1), `totalsOf`·`delta`·`avgOf`(Task 2)

- [ ] **Step 1: 로컬 인터페이스를 공용 타입으로 교체**

27~54행의 `interface UserPerf … interface Resp {…}`를 지우고 import로 바꾼다:

```ts
import { totalsOf, delta, avgOf } from "@/lib/work-metrics/totals";
import type { PerfResponse, UserPerf, Weekly, JiraProjectPerf as JiraProject, RepoPerf as Repo, SpacePerf as Space, Freshness, FreshnessSource, CompareBlock, Totals } from "@/types/work-metrics";
type Resp = PerfResponse;
```

- [ ] **Step 2: fetch에 compare=1, 총계는 totalsOf**

139행 fetch URL을 `` `${apiPath}?from=${range.from}&to=${range.to}&compare=1${teamQs}${qQs}` ``로. 151~161행의 `const t = useMemo(() => (data?.users ?? []).reduce(…))`를 통째로 아래로:

```ts
  const t: Totals = useMemo(() => totalsOf(data?.users ?? []), [data]);
```

- [ ] **Step 3: Stat에 증감 표시, 신선도 배지·도입 전후 카드 컴포넌트 추가**

`Stat` 함수(58~66행)를 아래로 바꾸고, 그 아래에 두 컴포넌트를 추가한다.

```tsx
function DeltaTag({ d }: { d: { pct: number; good: boolean } | null | undefined }) {
  if (!d) return null;
  const sign = d.pct > 0 ? "+" : "";
  return <span className={`ml-1 text-[11px] tabular-nums ${d.good ? "text-emerald-600" : "text-red-600"}`} title="직전 같은 길이 기간 대비">{sign}{d.pct}%</span>;
}

function Stat({ label, value, sub, delta: d }: { label: string; value: string; sub?: string; delta?: { pct: number; good: boolean } | null }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}<DeltaTag d={d} /></div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const SRC_LABEL: Record<FreshnessSource, string> = { jira: "Jira", gitlab: "GitLab", confluence: "Confluence" };
/** ISO → KST "MM-DD HH:mm" */
function fmtKst(iso: string): string {
  const k = new Date(new Date(iso).getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

function FreshnessBadges({ freshness }: { freshness: Freshness }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-muted-foreground">데이터 기준</span>
      {(Object.keys(SRC_LABEL) as FreshnessSource[]).map((s) => {
        const f = freshness[s];
        const warn = f.stale || !!f.lastError;
        const title = f.lastError ? `마지막 수집 실패: ${f.lastError}` : f.rangeTo ? `수집 범위 ~${f.rangeTo}` : "수집 기록 없음";
        return (
          <span key={s} title={title} className={`rounded border px-1.5 py-0.5 ${warn ? "border-amber-300 bg-amber-50 text-amber-800" : "text-muted-foreground"}`}>
            {SRC_LABEL[s]} {f.lastOkAt ? fmtKst(f.lastOkAt) : "없음"}{f.lastError ? " · 실패" : f.stale ? " · 오래됨" : ""}
          </span>
        );
      })}
      <span className="rounded border px-1.5 py-0.5 text-muted-foreground" title="OTel 수신 즉시 반영">Claude 실시간</span>
    </div>
  );
}

const hOf = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}h`);

function AdoptionCard({ c }: { c: CompareBlock["adoption"] }) {
  const rows: { label: string; before: number | null; after: number | null; fmt: (v: number | null) => string; lower?: boolean }[] = [
    { label: "이슈 해결", before: c.before.totals.resolved, after: c.after.totals.resolved, fmt: (v) => (v === null ? "—" : int(v)) },
    { label: "사이클 타임(평균)", before: avgOf(c.before.totals.cycleSum, c.before.totals.cycleN), after: avgOf(c.after.totals.cycleSum, c.after.totals.cycleN), fmt: hOf, lower: true },
    { label: "MR 리드(평균)", before: avgOf(c.before.totals.mrLead, c.before.totals.merged), after: avgOf(c.after.totals.mrLead, c.after.totals.merged), fmt: hOf, lower: true },
    { label: "커밋(GitLab)", before: c.before.totals.commits, after: c.after.totals.commits, fmt: (v) => (v === null ? "—" : int(v)) },
    { label: "MR 머지", before: c.before.totals.merged, after: c.after.totals.merged, fmt: (v) => (v === null ? "—" : int(v)) },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">도입 전후 4주 — {c.date} 기준</CardTitle>
        <p className="text-xs text-muted-foreground">전 {c.before.range.from}~{c.before.range.to} vs 후 {c.after.range.from}~{c.after.range.to}. 선택한 기간과 무관한 고정 창입니다. 상관이며 인과가 아닙니다.</p>
      </CardHeader>
      <CardContent>
        <table className="w-full text-xs">
          <thead className="bg-muted/50"><tr><th className="px-2 py-1 text-left">지표</th><th className="px-2 py-1 text-right">도입 전</th><th className="px-2 py-1 text-right">도입 후</th><th className="px-2 py-1 text-right">변화</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t">
                <td className="px-2 py-1.5 font-medium">{r.label}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.fmt(r.before)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.fmt(r.after)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums"><DeltaTag d={r.before !== null && r.after !== null ? delta(r.after, r.before, r.lower) : null} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: WeekBars에 도입일 이후 강조**

`WeekBars`의 props에 `highlightFrom?: string`을 추가하고, 막대 `div`(93~95행)를 아래로 바꾼다:

```tsx
              {series.map((s, i) => (
                <div key={i} className={`rounded-t ${s.cls}${highlightFrom && w.week >= highlightFrom ? " ring-1 ring-emerald-500/70" : ""}`} style={{ width: `${Math.floor(80 / series.length)}%`, height: `${Math.max(2, Math.round((s.value(w) / maxes[i]) * 100))}%` }} />
              ))}
```

하단 라벨 줄(98행)에 범례를 붙인다:

```tsx
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{weeks[0]?.week} 주</span>{highlightFrom && <span>테두리 = 도입일({highlightFrom}) 이후</span>}<span>{weeks.at(-1)?.week} 주</span></div>
```

함수 시그니처: `function WeekBars({ weeks, series, title, highlightFrom }: { …; highlightFrom?: string })`.

- [ ] **Step 5: 헤더·요약 탭 배선**

헤더 블록(256~282행) 끝, `{loading && …}` 다음 줄에:

```tsx
      </div>
      {data && <FreshnessBadges freshness={data.freshness} />}
      {data?.compare && <p className="text-[11px] text-muted-foreground">증감(%)은 직전 기간 {data.compare.previous.range.from}~{data.compare.previous.range.to} 대비</p>}
```

요약 탭의 Stat 8개를 증감 포함으로 바꾼다(`p = data?.compare?.previous.totals`):

```tsx
          {data && (() => {
            const p = data.compare?.previous.totals ?? null;
            const d = (cur: number, prev: number | undefined, lower = false) => (p && prev !== undefined ? delta(cur, prev, lower) : null);
            const cycleAvg = avgOf(t.cycleSum, t.cycleN);
            const prevCycleAvg = p ? avgOf(p.cycleSum, p.cycleN) : null;
            const mrAvg = avgOf(t.mrLead, t.merged);
            const prevMrAvg = p ? avgOf(p.mrLead, p.merged) : null;
            return (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="이슈 해결" value={int(t.resolved)} sub={`생성 ${int(t.created)} · SP ${int(Math.round(t.sp))}`} delta={d(t.resolved, p?.resolved)} />
                <Stat label="사이클 타임(평균)" value={hOf(cycleAvg)} sub={`리드 ${h(t.leadSum, t.resolved)} (생성→해결)`} delta={cycleAvg !== null && prevCycleAvg !== null ? delta(cycleAvg, prevCycleAvg, true) : null} />
                <Stat label="커밋 (GitLab)" value={int(t.commits)} sub={claudeShare === null ? "Claude 경유 —" : `Claude 경유 ${claudeShare}% · Claude Code 커밋 ${int(t.claudeCommits)}`} delta={d(t.commits, p?.commits)} />
                <Stat label="MR" value={`${int(t.merged)} 머지`} sub={`오픈 ${int(t.opened)} · 리드 ${hOf(mrAvg)}`} delta={mrAvg !== null && prevMrAvg !== null ? delta(mrAvg, prevMrAvg, true) : d(t.merged, p?.merged)} />
                <Stat label="문서" value={`${int(t.pc)}+${int(t.pu)}`} sub="생성+수정 (Confluence)" delta={d(t.pc + t.pu, p ? p.pc + p.pu : undefined)} />
                <Stat label="코드 라인(Claude 세션)" value={`+${int(t.locA)}`} sub={`-${int(t.locR)} 삭제`} delta={d(t.locA, p?.locA)} />
                <Stat label="Claude 투입" value={usd(t.cost)} sub={`세션 ${int(t.sessions)} · 프롬프트(사람) ${int(t.prompts)}`} delta={d(t.cost, p?.cost)} />
                <Stat label="Claude 활동 시간" value={`${int(Math.round(t.hours))}h`} sub="active time 합" delta={d(t.hours, p?.hours)} />
              </div>
            );
          })()}
          {data?.compare && <AdoptionCard c={data.compare.adoption} />}
          <WeekBars weeks={weeks} title="주별 추이" highlightFrom={data?.compare?.adoption.date} series={[
```

주의: MR 카드의 증감은 리드 평균이 있으면 리드(줄면 좋음), 없으면 머지 건수를 쓴다. 나머지 탭의 `WeekBars`에도 `highlightFrom={data?.compare?.adoption.date}`를 넘긴다(Jira·코드·문서 탭 4곳).

- [ ] **Step 6: 타입·린트·화면 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm test -- --run 2>&1 | tail -3`
Expected: 오류 0, 테스트 PASS.

`./frontend/scripts/restart-frontend.sh` 후 `/usage/perf`: 헤더 아래 "데이터 기준 Jira 09-27 07:31 · GitLab … · Confluence … · Claude 실시간" 배지, 요약 카드 값 옆 증감 %, "도입 전후 4주" 카드, 주별 막대에 도입일 이후 테두리. `/admin/perf`도 같은지 본다.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/components/usage/PerfDashboard.tsx
git commit -m "feat(perf): 데이터 기준 시점 배지·직전 기간 증감·도입 전후 4주 카드"
```

---

### Task 7: 1단계 배포·검증

**Files:** 없음(운영 확인)

- [ ] **Step 1: 원격 동기화 후 푸시**

```bash
git fetch origin && git status -sb   # main과 origin/main 차이 확인, 뒤처졌으면 git rebase origin/main
git push origin main
```

- [ ] **Step 2: 배포**

```bash
cd frontend && NODE_OPTIONS= vercel deploy --prod --yes 2>&1 | tail -3
NODE_OPTIONS= vercel inspect https://inje-playground.vercel.app 2>&1 | grep -E "url|name" | head -3
```
Expected: 배포 URL이 `innogrid-playground-…`, alias inspect의 url이 그 URL과 같음.

- [ ] **Step 3: 운영 확인**

브라우저(Chrome 확장)로 `https://inje-playground.vercel.app/admin/perf`를 열어 배지 3개·증감·도입 전후 카드를 스크린샷으로 남긴다. `/usage/perf`도 확인. 배지가 "오래됨"이면 실제 마지막 수집 시각과 맞는지 `work_metrics_sync` 최근 행과 대조한다.

---

## 2단계 — 항목 테이블과 분포·체류·시간대

### Task 8: SQL — `work_items` 테이블·RPC 2개 작성과 운영 적용

**Files:**
- Create: `docs/sql/2026-09-28-work-items.sql`
- Test: 운영 DB 수동 검증 쿼리 3건

**Interfaces:**
- Produces: 테이블 `public.work_items`, RPC `work_items_time_stats(p_from date, p_to date, p_emails text[])`, `work_items_hourly(p_from date, p_to date, p_emails text[], p_kinds text[])`. 반환 컬럼은 `TimeStatRow`·`HourlyCell`(Task 1)과 같다.

- [ ] **Step 1: SQL 파일 작성**

`docs/sql/2026-09-28-work-items.sql`:

```sql
-- 성과 측정 시간 정보 (2026-09-28) — 이슈·MR·커밋을 한 행씩 담는 work_items + 소요 시간·시간대 RPC.
-- 설계: docs/superpowers/specs/2026-09-28-perf-time-metrics-design.md. 재실행 안전.

create table if not exists public.work_items (
  source       text not null,                  -- jira | gitlab
  kind         text not null,                  -- issue | mr | commit
  item_key     text not null,                  -- issue: Jira 키 / mr: <project_path>!<iid> / commit: md5(email|authored|title)
  user_email   text not null,                  -- 소문자 회사 이메일(미확인 시 aid:<accountId>)
  scope_key    text not null,                  -- Jira project_key / GitLab project_path
  created_at   timestamptz not null,           -- issue 생성 / mr 오픈 / commit authored
  started_at   timestamptz,                    -- issue: 최초 In Progress 진입
  done_at      timestamptz,                    -- issue: resolutiondate / mr: merged_at
  story_points numeric,
  is_claude    boolean not null default false, -- commit: Co-Authored-By: Claude 트레일러
  extra        jsonb,                          -- 후속(상태별 체류 등)
  synced_at    timestamptz not null default now(),
  primary key (source, kind, item_key)
);
create index if not exists work_items_done_idx    on public.work_items (done_at);
create index if not exists work_items_created_idx on public.work_items (created_at);
create index if not exists work_items_email_idx   on public.work_items (user_email, done_at desc);

alter table public.work_items enable row level security;
drop policy if exists work_items_admin_read on public.work_items;
create policy work_items_admin_read on public.work_items for select to authenticated
  using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin'));

-- 소요 시간: 완료 시각이 기간 안인 이슈·MR의 리드/사이클/대기 p50·p90·평균·분포. grp = all | week:<월요일> | user:<email> | scope:<key>
drop function if exists public.work_items_time_stats(date, date, text[]);
create function public.work_items_time_stats(p_from date, p_to date, p_emails text[])
returns table (grp text, kind text, metric text, n bigint, p50 numeric, p90 numeric, avg numeric,
               b1 bigint, b2 bigint, b3 bigint, b4 bigint, b5 bigint)
language sql security definer set search_path = public as $$
  with base as (
    select kind, lower(user_email) as user_email, scope_key,
      to_char(date_trunc('week', done_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') as week,
      greatest(0, extract(epoch from (done_at - created_at)) / 3600) as lead_h,
      case when started_at is not null then greatest(0, extract(epoch from (done_at - started_at)) / 3600) end as cycle_h,
      case when started_at is not null then greatest(0, extract(epoch from (started_at - created_at)) / 3600) end as wait_h
    from work_items
    where done_at >= (p_from::text || ' 00:00:00+09')::timestamptz
      and done_at <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
      and kind in ('issue', 'mr')
      and (p_emails is null or lower(user_email) = any (p_emails))
  ), m as (
    select kind, user_email, scope_key, week, 'lead'::text as metric, lead_h as h from base
    union all select kind, user_email, scope_key, week, 'cycle', cycle_h from base where kind = 'issue' and cycle_h is not null
    union all select kind, user_email, scope_key, week, 'wait',  wait_h  from base where kind = 'issue' and wait_h  is not null
  )
  select coalesce('week:' || week, 'user:' || user_email, 'scope:' || scope_key, 'all') as grp, kind, metric,
    count(*)::bigint as n,
    (percentile_cont(0.5) within group (order by h))::numeric as p50,
    (percentile_cont(0.9) within group (order by h))::numeric as p90,
    avg(h)::numeric as avg,
    count(*) filter (where h <= 4)::bigint               as b1,
    count(*) filter (where h > 4   and h <= 24)::bigint  as b2,
    count(*) filter (where h > 24  and h <= 72)::bigint  as b3,
    count(*) filter (where h > 72  and h <= 168)::bigint as b4,
    count(*) filter (where h > 168)::bigint              as b5
  from m
  group by grouping sets ((kind, metric), (kind, metric, week), (kind, metric, user_email), (kind, metric, scope_key))
$$;
revoke execute on function public.work_items_time_stats(date, date, text[]) from public, anon, authenticated;
grant  execute on function public.work_items_time_stats(date, date, text[]) to service_role;

-- 시간대: 종류별 요일(isodow 1=월..7=일)×시각(KST) 건수. 커밋은 authored, 이슈는 해결, MR은 머지 시각. 사용자 차원 없음(개인별 노출 불가)
drop function if exists public.work_items_hourly(date, date, text[], text[]);
create function public.work_items_hourly(p_from date, p_to date, p_emails text[], p_kinds text[])
returns table (kind text, dow int, hour int, n bigint)
language sql security definer set search_path = public as $$
  select kind,
    extract(isodow from (ts at time zone 'Asia/Seoul'))::int as dow,
    extract(hour   from (ts at time zone 'Asia/Seoul'))::int as hour,
    count(*)::bigint as n
  from (
    select kind, user_email, case when kind = 'commit' then created_at else done_at end as ts
    from work_items
  ) x
  where ts is not null
    and ts >= (p_from::text || ' 00:00:00+09')::timestamptz
    and ts <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
    and kind = any (p_kinds)
    and (p_emails is null or lower(user_email) = any (p_emails))
  group by 1, 2, 3
$$;
revoke execute on function public.work_items_hourly(date, date, text[], text[]) from public, anon, authenticated;
grant  execute on function public.work_items_hourly(date, date, text[], text[]) to service_role;
```

- [ ] **Step 2: 운영 적용 (Management API)**

```bash
cd /Users/seunguk.kang/Repos/inje-playground
TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
jq -Rs '{query: .}' docs/sql/2026-09-28-work-items.sql > /tmp/claude-501/work-items-payload.json
curl -sS -X POST "https://api.supabase.com/v1/projects/avooqcxehfeurjhqqgui/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @/tmp/claude-501/work-items-payload.json | head -c 400; echo
unset TOKEN; rm -f /tmp/claude-501/work-items-payload.json
```
Expected: `[]` 또는 빈 결과(오류 JSON이 아님). 토큰은 출력하지 않는다.

- [ ] **Step 3: 수동 검증 3건 (같은 curl로 query만 바꿔 실행)**

1. 빈 테이블에서도 RPC가 오류 없이 0행:
   `select * from work_items_time_stats('2026-09-01','2026-09-28', null);` → 0행.
2. 임시 행 3개로 p50이 정렬 중앙과 일치·In Progress 없는 이슈는 cycle에서 빠짐(검증 후 삭제):
   ```sql
   insert into work_items (source,kind,item_key,user_email,scope_key,created_at,started_at,done_at) values
     ('jira','issue','T-1','t@innogrid.com','T','2026-09-20 00:00+09','2026-09-20 02:00+09','2026-09-20 10:00+09'),
     ('jira','issue','T-2','t@innogrid.com','T','2026-09-20 00:00+09',null,'2026-09-21 00:00+09'),
     ('jira','issue','T-3','t@innogrid.com','T','2026-09-20 00:00+09','2026-09-20 01:00+09','2026-09-23 00:00+09');
   select grp, metric, n, p50 from work_items_time_stats('2026-09-20','2026-09-23', array['t@innogrid.com']) where kind='issue' order by 1,2;
   ```
   → `all/lead n=3 p50=24`, `all/cycle n=2 p50=(8+71)/2=39.5`, `all/wait n=2 p50=1.5`. `user:t@innogrid.com`·`scope:T` 행은 all과 같은 값. 주별은 둘로 갈린다: `week:2026-09-14`(T-1만, lead n=1 p50=10), `week:2026-09-21`(T-2·T-3, lead n=2 p50=48).
   `select * from work_items_hourly('2026-09-20','2026-09-23', array['t@innogrid.com'], array['issue']);` → dow 7(일, 09-20)·hour 10 n=1, dow 1 hour 0 n=1, dow 3 hour 0 n=1.
   `delete from work_items where scope_key='T';`
3. 권한: `select has_function_privilege('authenticated','public.work_items_time_stats(date,date,text[])','execute');` → false.

- [ ] **Step 4: 커밋**

```bash
git add docs/sql/2026-09-28-work-items.sql
git commit -m "feat(perf): work_items 테이블·소요 시간/시간대 RPC SQL"
```

---

### Task 9: 항목 빌더·검증기 `items.ts`

**Files:**
- Create: `frontend/src/lib/work-metrics/items.ts`
- Test: `frontend/src/lib/__tests__/work-metrics-items.test.ts`

**Interfaces:**
- Consumes: `upsertChunked`(common.ts)
- Produces: `WorkItem`, `WorkItemKind`, `commitItemKey(email, authoredIso, title): string`, `mrItemKey(projectPath, iid): string`, `jiraIssueItem(i): WorkItem`, `normalizeGitlabItem(raw, resolveEmail): WorkItem | null`, `upsertItems(admin, items): Promise<number>`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/work-metrics-items.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commitItemKey, jiraIssueItem, mrItemKey, normalizeGitlabItem } from "@/lib/work-metrics/items";

const id = (e: string) => e;

describe("keys", () => {
  it("커밋 키는 이메일|authored|제목의 md5 — 일 집계 중복 제거 규칙과 같은 조합", () => {
    const k = commitItemKey("kim@innogrid.com", "2026-09-01T02:00:00.000Z", "fix: x");
    expect(k).toBe(createHash("md5").update("kim@innogrid.com|2026-09-01T02:00:00.000Z|fix: x").digest("hex"));
    expect(mrItemKey("grp/app", 12)).toBe("grp/app!12");
  });
});

describe("jiraIssueItem", () => {
  it("시각을 ISO로 정규화하고 In Progress 없는 이슈는 started_at null", () => {
    const it1 = jiraIssueItem({ key: "CMP-1", project: "CMP", email: "kim@innogrid.com", created: "2026-09-01T09:00:00.000+0900", started: null, resolved: "2026-09-02T09:00:00.000+0900", storyPoints: 3 });
    expect(it1).toEqual({ source: "jira", kind: "issue", item_key: "CMP-1", user_email: "kim@innogrid.com", scope_key: "CMP", created_at: "2026-09-01T00:00:00.000Z", started_at: null, done_at: "2026-09-02T00:00:00.000Z", story_points: 3, is_claude: false });
    expect(jiraIssueItem({ key: "CMP-2", project: "CMP", email: "kim@innogrid.com", created: "2026-09-01T09:00:00.000+0900", started: "2026-09-01T10:00:00.000+0900", resolved: "2026-09-02T09:00:00.000+0900", storyPoints: null }).started_at).toBe("2026-09-01T01:00:00.000Z");
  });
});

describe("normalizeGitlabItem", () => {
  const base = { kind: "mr", item_key: "grp/app!1", user_email: "Kim@innogrid.com", scope_key: "grp/app", created_at: "2026-09-01T00:00:00Z", done_at: "2026-09-02T00:00:00Z" };
  it("정상 행은 ISO·소문자·이메일 정규화 함수를 거친다", () => {
    const out = normalizeGitlabItem(base, (e) => (e === "kim@innogrid.com" ? "kim.s@innogrid.com" : e));
    expect(out).toEqual({ source: "gitlab", kind: "mr", item_key: "grp/app!1", user_email: "kim.s@innogrid.com", scope_key: "grp/app", created_at: "2026-09-01T00:00:00.000Z", started_at: null, done_at: "2026-09-02T00:00:00.000Z", story_points: null, is_claude: false });
  });
  it("done_at이 created_at보다 앞서면 created_at으로 보정한다", () => {
    expect(normalizeGitlabItem({ ...base, done_at: "2026-08-31T00:00:00Z" }, id)?.done_at).toBe("2026-09-01T00:00:00.000Z");
  });
  it("kind·키·이메일·scope·created_at이 잘못되면 null", () => {
    expect(normalizeGitlabItem({ ...base, kind: "issue" }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, item_key: "" }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, item_key: "x".repeat(201) }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, user_email: "ab" }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, scope_key: " " }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, created_at: "not a date" }, id)).toBeNull();
  });
  it("is_claude는 true일 때만 true, 커밋은 done_at 없음", () => {
    const c = normalizeGitlabItem({ kind: "commit", item_key: "abc", user_email: "kim@innogrid.com", scope_key: "grp/app", created_at: "2026-09-01T00:00:00Z", is_claude: "yes" }, id);
    expect(c).toMatchObject({ kind: "commit", is_claude: false, done_at: null, started_at: null });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-items.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/lib/work-metrics/items.ts`:

```ts
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertChunked } from "./common";

/**
 * work_items 항목 — 이슈·MR·커밋 한 행. 일 집계(jira_issue_daily·gitlab_daily)와 같은 수집에서 함께 쓴다.
 * 소요 시간·시간대는 이 테이블에서만 계산한다(SQL docs/sql/2026-09-28-work-items.sql).
 */

export type WorkItemKind = "issue" | "mr" | "commit";
export interface WorkItem {
  source: "jira" | "gitlab";
  kind: WorkItemKind;
  item_key: string;
  user_email: string;
  scope_key: string;
  created_at: string;
  started_at: string | null;
  done_at: string | null;
  story_points: number | null;
  is_claude: boolean;
}

/** 커밋 키 = 일 집계의 중복 제거 조합(이메일|authored 시각|제목)의 md5. 파이썬 스크립트(gitlab-metrics-sync.py)와 같아야 한다 */
export function commitItemKey(email: string, authoredIso: string, title: string): string {
  return createHash("md5").update(`${email}|${authoredIso}|${title}`).digest("hex");
}
export const mrItemKey = (projectPath: string, iid: number | string): string => `${projectPath}!${iid}`;

const toIso = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export function jiraIssueItem(i: { key: string; project: string; email: string; created: string; started: string | null; resolved: string; storyPoints: number | null }): WorkItem {
  return {
    source: "jira", kind: "issue", item_key: i.key, user_email: i.email, scope_key: i.project,
    created_at: new Date(i.created).toISOString(),
    started_at: i.started ? new Date(i.started).toISOString() : null,
    done_at: new Date(i.resolved).toISOString(),
    story_points: i.storyPoints, is_claude: false,
  };
}

/** sync API(gitlab_items)용 검증·정규화. 통과 못 하면 null — 그 행은 건너뛴다 */
export function normalizeGitlabItem(raw: Record<string, unknown>, resolveEmail: (email: string) => string): WorkItem | null {
  const kind = raw.kind;
  if (kind !== "mr" && kind !== "commit") return null;
  const key = typeof raw.item_key === "string" ? raw.item_key.trim() : "";
  if (!key || key.length > 200) return null;
  const email = typeof raw.user_email === "string" ? raw.user_email.trim().toLowerCase() : "";
  if (email.length < 4) return null;
  const scope = typeof raw.scope_key === "string" ? raw.scope_key.trim() : "";
  if (!scope) return null;
  const created = toIso(raw.created_at);
  if (!created) return null;
  // 완료·시작이 생성보다 앞서면(시계 오차·수동 입력) 생성 시각으로 보정
  const notBefore = (v: unknown) => { const iso = toIso(v); return iso && iso < created ? created : iso; };
  return {
    source: "gitlab", kind, item_key: key, user_email: resolveEmail(email), scope_key: scope,
    created_at: created, started_at: notBefore(raw.started_at), done_at: notBefore(raw.done_at),
    story_points: null, is_claude: raw.is_claude === true,
  };
}

export async function upsertItems(admin: SupabaseClient, items: WorkItem[]): Promise<number> {
  return upsertChunked(admin, "work_items", items as unknown as Record<string, unknown>[], "source,kind,item_key");
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-items.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/work-metrics/items.ts frontend/src/lib/__tests__/work-metrics-items.test.ts
git commit -m "feat(perf): work_items 항목 빌더·sync 검증기(items.ts)"
```

---

### Task 10: Jira 수집기가 이슈 항목을 쓴다

**Files:**
- Modify: `frontend/src/lib/work-metrics/jira.ts:111-132`
- Test: `npx tsc --noEmit`, 운영 백필 후 대조(Task 18)

**Interfaces:**
- Consumes: `jiraIssueItem`, `upsertItems`, `WorkItem`(Task 9)

- [ ] **Step 1: 해결 루프에서 항목 수집·upsert**

import 추가: `import { jiraIssueItem, upsertItems, type WorkItem } from "./items";`

112~126행의 해결 루프를 아래로 바꾼다:

```ts
  // 해결(담당자 기준) + 리드/사이클타임 + 스토리포인트 — 일 집계와 work_items 항목을 같은 루프에서 만든다
  const items: WorkItem[] = [];
  const resolved = await searchAll(`resolutiondate >= "${from}" AND resolutiondate <= "${to} 23:59"${projJql}`, fields, true);
  for (const is of resolved) {
    const email = await resolveUserEmail(admin, is.fields.assignee ?? is.fields.reporter, mapCache);
    const rd = is.fields.resolutiondate;
    if (!email || !rd) continue;
    const project = is.fields.project?.key ?? "?";
    const v = bump(kstDay(rd), email, project);
    v.issues_resolved += 1;
    if (is.fields.created) v.lead_hours_sum += hoursBetween(is.fields.created, rd);
    const cs = cycleStart(is);
    if (cs) { v.cycle_hours_sum += hoursBetween(cs, rd); v.cycle_count += 1; }
    let sp: number | null = null;
    if (spField) {
      const n = Number(is.fields[spField]);
      if (Number.isFinite(n)) { v.story_points += n; sp = n; }
    }
    if (is.fields.created) items.push(jiraIssueItem({ key: is.key, project, email, created: is.fields.created, started: cs, resolved: rd, storyPoints: sp }));
  }
```

131행 `await upsertChunked(admin, "jira_issue_daily", …)` 다음에:

```ts
  await upsertItems(admin, items);
  return { source: "jira", rows: rows.length, notes: `created ${created.length}건, resolved ${resolved.length}건, items ${items.length}건` };
```
(기존 return 줄은 지운다.)

- [ ] **Step 2: 타입·테스트 확인**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run 2>&1 | tail -3`
Expected: 오류 0

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/lib/work-metrics/jira.ts
git commit -m "feat(perf): Jira 수집기가 해결 이슈를 work_items에 함께 쓴다"
```

---

### Task 11: GitLab 서버 수집기의 커밋·MR 항목

**Files:**
- Modify: `frontend/src/lib/work-metrics/gitlab.ts`
- Test: `frontend/src/lib/__tests__/work-metrics-gitlab.test.ts`(추가)

**Interfaces:**
- Consumes: `commitItemKey`, `mrItemKey`, `upsertItems`, `WorkItem`(Task 9), `resolveCommitterEmail`
- Produces: `commitItems(commits: GlCommit[], projectPath: string): WorkItem[]`, `mrItems(mrs: GlMr[], projectPath: string, fromIso: string, toIso: string): WorkItem[]`

- [ ] **Step 1: 실패하는 테스트 추가**

`frontend/src/lib/__tests__/work-metrics-gitlab.test.ts` 끝에:

```ts
import { commitItems, mrItems } from "@/lib/work-metrics/gitlab";
import { commitItemKey } from "@/lib/work-metrics/items";

describe("commitItems", () => {
  it("중복 제거 규칙을 통과한 커밋마다 항목 하나, 키는 commitItemKey", () => {
    const base = { author_email: "kim@innogrid.com", authored_date: "2026-08-20T01:00:00.000Z", title: "fix: same", message: "fix: same\n\nCo-Authored-By: Claude <noreply@anthropic.com>" };
    const out = commitItems([{ id: "old", ...base }, { id: "rebased", ...base, committed_date: "2026-08-28T05:00:00.000Z" }], "grp/app");
    expect(out).toEqual([{ source: "gitlab", kind: "commit", item_key: commitItemKey("kim@innogrid.com", "2026-08-20T01:00:00.000Z", "fix: same"), user_email: "kim@innogrid.com", scope_key: "grp/app", created_at: "2026-08-20T01:00:00.000Z", started_at: null, done_at: null, story_points: null, is_claude: true }]);
  });
});

describe("mrItems", () => {
  const range = ["2026-09-01T00:00:00.000Z", "2026-09-03T00:00:00.000Z"] as const;
  it("오픈 또는 머지가 기간 안인 MR만, 미머지는 done_at null", () => {
    const out = mrItems([
      { iid: 1, author: { username: "kim" }, created_at: "2026-09-01T01:00:00.000Z", merged_at: null, state: "opened" },
      { iid: 2, author: { username: "lee" }, created_at: "2026-08-20T01:00:00.000Z", merged_at: "2026-09-02T01:00:00.000Z", state: "merged" },
      { iid: 3, author: { username: "park" }, created_at: "2026-08-20T01:00:00.000Z", merged_at: null, state: "opened" },
    ], "grp/app", range[0], range[1]);
    expect(out.map((i) => [i.item_key, i.user_email, i.done_at])).toEqual([["grp/app!1", "kim@innogrid.com", null], ["grp/app!2", "lee@innogrid.com", "2026-09-02T01:00:00.000Z"]]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-gitlab.test.ts`
Expected: FAIL — `commitItems is not a function` (또는 export 없음)

- [ ] **Step 3: 구현**

`gitlab.ts` import에 추가: `import { commitItemKey, mrItemKey, upsertItems, type WorkItem } from "./items";`

`GlMr`에 `iid` 추가: `interface GlMr { iid: number; author?: { username?: string }; created_at: string; merged_at?: string | null; state: string }`

`summarizeCommits` 다음에:

```ts
/** 커밋 → work_items 항목. summarizeCommits와 같은 중복 제거(이메일·authored·제목) */
export function commitItems(commits: GlCommit[], projectPath: string): WorkItem[] {
  const seen = new Set<string>();
  const out: WorkItem[] = [];
  for (const c of commits) {
    const email = normalizeEmail(c.author_email);
    const when = c.authored_date ?? c.committed_date;
    if (!email || !when) continue;
    const dedupe = `${email}|${when}|${c.title ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ source: "gitlab", kind: "commit", item_key: commitItemKey(email, when, c.title ?? ""), user_email: email, scope_key: projectPath, created_at: new Date(when).toISOString(), started_at: null, done_at: null, story_points: null, is_claude: isClaudeCommit(c.message) });
  }
  return out;
}

/** MR → 항목. 오픈 또는 머지가 [fromIso, toIso) 안인 것만. 미머지는 done_at null(나중에 머지되면 PK upsert로 채워진다) */
export function mrItems(mrs: GlMr[], projectPath: string, fromIso: string, toIso: string): WorkItem[] {
  const inRange = (iso: string | null | undefined) => !!iso && iso >= fromIso && iso < toIso;
  const out: WorkItem[] = [];
  for (const mr of mrs) {
    const email = normalizeEmail(mr.author?.username);
    if (!email || !(inRange(mr.created_at) || inRange(mr.merged_at))) continue;
    out.push({ source: "gitlab", kind: "mr", item_key: mrItemKey(projectPath, mr.iid), user_email: email, scope_key: projectPath, created_at: new Date(mr.created_at).toISOString(), started_at: null, done_at: mr.merged_at ? new Date(mr.merged_at).toISOString() : null, story_points: null, is_claude: false });
  }
  return out;
}
```

`collectGitlab` 프로젝트 루프 앞에 `const items: WorkItem[] = [];`를 두고, 루프 안에서 `summarizeCommits(commits)` 처리 뒤에 `items.push(...commitItems(commits, p.path_with_namespace));`, MR 루프 뒤에 `items.push(...mrItems(mrs, p.path_with_namespace, fromIso, toIso));`. 마지막 upsert 블록을 아래로:

```ts
  const days = new Set(dayList(from, to));
  const resolver = await loadEmailResolver(admin);
  const rows = resolveAndMergeGitlabRows([...agg.values()].filter((r) => days.has(r.day)), (e) => resolveCommitterEmail(e, resolver));
  await deleteDayRange(admin, "gitlab_daily", from, to);
  await upsertChunked(admin, "gitlab_daily", rows, "day,user_email,project_path");
  // 항목: 기간 커밋은 지우고 다시(force-push 정리), MR은 PK upsert
  const { error: delErr } = await admin.from("work_items").delete().eq("source", "gitlab").eq("kind", "commit").gte("created_at", fromIso).lt("created_at", toIso);
  if (delErr) throw new Error(`work_items 삭제 실패: ${delErr.message}`);
  await upsertItems(admin, items.map((it) => ({ ...it, user_email: resolveCommitterEmail(it.user_email, resolver) })));
  return { source: "gitlab", rows: rows.length, notes: `프로젝트 ${projects.length}개 순회, items ${items.length}건` };
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-gitlab.test.ts && npx tsc --noEmit`
Expected: PASS, 타입 오류 0

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/work-metrics/gitlab.ts frontend/src/lib/__tests__/work-metrics-gitlab.test.ts
git commit -m "feat(perf): GitLab 서버 수집기의 커밋·MR work_items 항목"
```

---

### Task 12: sync API에 `gitlab_items` 소스

**Files:**
- Modify: `frontend/src/app/api/admin/work-metrics/sync/route.ts` (전체 교체)
- Test: `npx tsc --noEmit` + 로컬 curl

**Interfaces:**
- Consumes: `normalizeGitlabItem`, `upsertItems`, `WorkItem`(Task 9), `kstDayBoundsUtc`(common.ts)
- Produces: `POST { source: "gitlab_items", rows, replace? }` → `{ ok, upserted, skipped, replaced }`

- [ ] **Step 1: 라우트 전체를 아래로 교체**

```ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { upsertChunked, logSync, deleteDayRange, kstDayBoundsUtc } from "@/lib/work-metrics/common";
import { loadEmailResolver, resolveAndMergeGitlabRows, resolveCommitterEmail } from "@/lib/work-metrics/email-resolve";
import { normalizeGitlabItem, upsertItems, type WorkItem } from "@/lib/work-metrics/items";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/work-metrics/sync — 성과 지표 로컬 푸시(사내망 전용 시스템용 폴백).
 * Vercel에서 접근할 수 없는 GitLab(사내 IP 화이트리스트) 등의 일 집계를 로컬 스크립트가 계산해 밀어 넣는다.
 * 인증: Bearer CLAUDE_OTEL_INGEST_TOKEN(수집 토큰) 또는 관리자 세션.
 * body: { source: "gitlab"|"jira"|"confluence"|"gitlab_items", rows: [...], replace?: { from, to } }
 *  - 일 집계 소스는 허용 컬럼만 통과, PK upsert(교체). replace가 있으면 그 기간(day 포함)의 기존 행을 먼저 지운다.
 *  - gitlab_items는 work_items 항목(kind mr|commit). 검증·이메일 정규화는 normalizeGitlabItem, replace는 그 기간 커밋 행만 지운다(MR은 PK upsert).
 *  - 여러 청크로 나눠 보낼 때 replace는 첫 청크에만 넣는다.
 */

const TABLES: Record<string, { table: string; conflict: string; columns: string[] }> = {
  gitlab: { table: "gitlab_daily", conflict: "day,user_email,project_path", columns: ["day", "user_email", "project_path", "commits", "claude_commits", "mrs_opened", "mrs_merged", "mr_lead_hours_sum"] },
  jira: { table: "jira_issue_daily", conflict: "day,user_email,project_key", columns: ["day", "user_email", "project_key", "issues_created", "issues_resolved", "lead_hours_sum", "cycle_hours_sum", "cycle_count", "story_points"] },
  confluence: { table: "confluence_daily", conflict: "day,user_email,space_key", columns: ["day", "user_email", "space_key", "pages_created", "pages_updated"] },
};

type Body = { source?: string; rows?: Record<string, unknown>[]; replace?: { from?: unknown; to?: unknown } };
type Replace = { from: string; to: string };

export async function POST(request: NextRequest) {
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const body = (await request.json().catch(() => null)) as Body | null;
  const source = body?.source ?? "";
  if (!(source === "gitlab_items" || TABLES[source]) || !Array.isArray(body?.rows)) return NextResponse.json({ error: "source/rows가 필요합니다." }, { status: 400 });
  if (body.rows.length > 20000) return NextResponse.json({ error: "rows는 20,000행 이하로 나눠 보내세요." }, { status: 400 });

  let replace: Replace | null = null;
  if (body.replace) {
    const from = typeof body.replace.from === "string" ? body.replace.from : null;
    const to = typeof body.replace.to === "string" ? body.replace.to : null;
    if (!isYmd(from) || !isYmd(to) || from > to) return NextResponse.json({ error: "replace.from/to는 YYYY-MM-DD(from ≤ to)여야 합니다." }, { status: 400 });
    replace = { from, to };
  }

  if (source === "gitlab_items") return syncGitlabItems(admin, body.rows, replace);

  const spec = TABLES[source];
  let rows = body.rows
    .map((r) => Object.fromEntries(spec.columns.map((col) => [col, r[col]])))
    .filter((r) => typeof r.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.day as string) && typeof r.user_email === "string" && (r.user_email as string).length > 3)
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)));

  try {
    if (source === "gitlab" && rows.length > 0) {
      const resolver = await loadEmailResolver(admin);
      rows = resolveAndMergeGitlabRows(rows as Array<{ day: string; user_email: string; project_path: string } & Record<string, unknown>>, (e) => resolveCommitterEmail(e, resolver));
    }
    if (replace) await deleteDayRange(admin, spec.table, replace.from, replace.to);
    if (rows.length > 0) await upsertChunked(admin, spec.table, rows, spec.conflict);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const first = rows[0]?.day ?? replace?.from ?? "1970-01-01";
    await logSync(admin, source, String(first), String(rows[rows.length - 1]?.day ?? replace?.to ?? first), 0, false, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0, skipped: body.rows.length, replaced: replace });
  const days = rows.map((r) => r.day as string).sort();
  await logSync(admin, source, replace?.from ?? days[0], replace?.to ?? days[days.length - 1], rows.length, true, replace ? "push(replace)" : "push");
  return NextResponse.json({ ok: true, upserted: rows.length, skipped: body.rows.length - rows.length, replaced: replace });
}

async function syncGitlabItems(admin: SupabaseClient, raw: Record<string, unknown>[], replace: Replace | null) {
  const resolver = await loadEmailResolver(admin);
  const items = raw.map((r) => normalizeGitlabItem(r, (e) => resolveCommitterEmail(e, resolver))).filter((x): x is WorkItem => x !== null);
  const rangeFrom = replace?.from ?? items[0]?.created_at.slice(0, 10) ?? "1970-01-01";
  const rangeTo = replace?.to ?? items[items.length - 1]?.created_at.slice(0, 10) ?? rangeFrom;
  try {
    if (replace) {
      const { fromIso } = kstDayBoundsUtc(replace.from);
      const { toIso } = kstDayBoundsUtc(replace.to);
      const { error } = await admin.from("work_items").delete().eq("source", "gitlab").eq("kind", "commit").gte("created_at", fromIso).lt("created_at", toIso);
      if (error) throw new Error(`work_items 삭제 실패: ${error.message}`);
    }
    if (items.length > 0) await upsertItems(admin, items);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(admin, "gitlab_items", rangeFrom, rangeTo, 0, false, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  await logSync(admin, "gitlab_items", rangeFrom, rangeTo, items.length, true, replace ? "push(replace)" : "push");
  return NextResponse.json({ ok: true, upserted: items.length, skipped: raw.length - items.length, replaced: replace });
}
```

- [ ] **Step 2: 타입·린트**

Run: `cd frontend && npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: 오류 0

- [ ] **Step 3: 로컬 curl로 검증·거부 확인**

`./frontend/scripts/restart-frontend.sh` 후(로컬 `.env.local`의 `CLAUDE_OTEL_INGEST_TOKEN` 사용, 값은 출력하지 않는다):

```bash
cd frontend && TOKEN=$(grep '^CLAUDE_OTEL_INGEST_TOKEN=' .env.local | cut -d= -f2-)
curl -sS -X POST http://localhost:3003/api/admin/work-metrics/sync -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"source":"gitlab_items","rows":[{"kind":"commit","item_key":"test-plan-12","user_email":"test@innogrid.com","scope_key":"test/plan","created_at":"2026-09-20T01:00:00Z","is_claude":true},{"kind":"issue","item_key":"bad"}]}'; echo; unset TOKEN
```
Expected: `{"ok":true,"upserted":1,"skipped":1,"replaced":null}`. 이어서 Management API로 `delete from work_items where scope_key='test/plan';`.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/app/api/admin/work-metrics/sync/route.ts
git commit -m "feat(perf): sync API에 gitlab_items 소스(항목 검증·커밋 replace)"
```

---

### Task 13: GitLab 로컬 스크립트가 항목을 보낸다

**Files:**
- Modify: `frontend/scripts/gitlab-metrics-sync.py:159-226`
- Test: `--dry-run` 실행(사내망), 파이썬 키 해시가 TS와 같은지 1건 대조

**Interfaces:**
- Produces: sync API `gitlab_items` 요청(Task 12 형식)

- [ ] **Step 1: 항목 수집 코드 추가**

`import hashlib`를 import 블록에 추가. `agg: dict[tuple, dict] = {}` 다음 줄에 `items: list[dict] = []`. 커밋 루프의 `seen.add(dedupe)` 다음에:

```python
                key = hashlib.md5(f"{email}|{when}|{cm.get('title') or ''}".encode()).hexdigest()
                items.append({"kind": "commit", "item_key": key, "user_email": email, "scope_key": path, "created_at": when,
                              "is_claude": bool(CLAUDE_TRAILER.search(cm.get("message") or ""))})
```

MR 루프(`for mr in mrs:`)의 `if not email: continue` 다음에:

```python
                created_day = kst_day(mr["created_at"])
                merged_at = mr.get("merged_at")
                merged_day = kst_day(merged_at) if merged_at else None
                if args.date_from <= created_day <= args.date_to or (merged_day and args.date_from <= merged_day <= args.date_to):
                    items.append({"kind": "mr", "item_key": f"{path}!{mr['iid']}", "user_email": email, "scope_key": path,
                                  "created_at": mr["created_at"], "done_at": merged_at})
```
(기존 `merged_at = mr.get("merged_at")` 줄은 중복이므로 지운다.)

- [ ] **Step 2: 전송을 함수로 묶고 항목도 보낸다**

`rows = [r for r in agg.values() …]` 아래 dry-run·전송 블록을 아래로 바꾼다:

```python
    rows = [r for r in agg.values() if args.date_from <= r["day"] <= args.date_to]
    print(f"집계 {len(rows)}행, 항목 {len(items)}건 ({args.date_from} ~ {args.date_to})")
    if args.dry_run:
        for r in rows[:10]:
            print(" ", r)
        for it in items[:5]:
            print("  item", it)
        return

    def post(source: str, payload_rows: list, chunk: int) -> None:
        chunks = [payload_rows[i : i + chunk] for i in range(0, len(payload_rows), chunk)] or [[]]  # 행이 없어도 replace로 기간을 비운다
        for idx, part in enumerate(chunks):
            body: dict = {"source": source, "rows": part}
            if idx == 0:
                body["replace"] = {"from": args.date_from, "to": args.date_to}
            req = urllib.request.Request(
                f"{app_url}/api/admin/work-metrics/sync",
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {ingest}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                print(f"→ {source}", json.load(r))

    post("gitlab", rows, 5000)
    post("gitlab_items", items, 5000)
```

docstring 집계 규칙에 한 줄 추가: `  - 항목(work_items): 커밋은 md5(email|authored|title) 키, MR은 <path>!<iid>. gitlab_items 소스로 따로 보낸다(서버 lib/work-metrics/items.ts와 같은 규칙).`

- [ ] **Step 3: 키 해시 대조**

```bash
python3 -c "import hashlib;print(hashlib.md5('kim@innogrid.com|2026-09-01T02:00:00.000Z|fix: x'.encode()).hexdigest())"
cd frontend && node -e "console.log(require('node:crypto').createHash('md5').update('kim@innogrid.com|2026-09-01T02:00:00.000Z|fix: x').digest('hex'))"
```
Expected: 두 값이 같다.

- [ ] **Step 4: dry-run (사내망·VPN에서, 사용자 실행)**

`python3 frontend/scripts/gitlab-metrics-sync.py --from <어제> --to <어제> --dry-run` → "집계 N행, 항목 M건"과 항목 표본 5건이 찍힌다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/scripts/gitlab-metrics-sync.py
git commit -m "feat(perf): GitLab 로컬 스크립트가 커밋·MR 항목을 gitlab_items로 푸시"
```

---

### Task 14: 소요 시간·시간대 서버 로직 (`perf-report` durations, `hourly.ts`)

**Files:**
- Modify: `frontend/src/lib/work-metrics/perf-report.ts:101-112, 188-198`
- Create: `frontend/src/lib/work-metrics/hourly.ts`
- Test: `frontend/src/lib/__tests__/work-metrics-hourly.test.ts`, `frontend/src/lib/__tests__/work-metrics-durations.test.ts`

**Interfaces:**
- Consumes: `TimeStatRow`, `HourlyCell`, `HourlyKind`(Task 1), RPC(Task 8)
- Produces: `loadDurations(admin, from, to, filterEmails): Promise<{ durations: TimeStatRow[]; durationsReady: boolean } | { error: string }>`(perf-report.ts에서 export), `HOURLY_KINDS`, `MIN_HOURLY_PEOPLE = 3`, `parseKinds(raw: string | null): HourlyKind[]`, `hourlyTargets(members: { email: string }[], opts: { self: boolean }): { emails: string[] | null; suppressed: boolean }`, `loadHourly(admin, { from, to, emails, kinds }): Promise<{ cells: HourlyCell[]; notReady: boolean } | { error: string }>`, `offHoursShare(cells: HourlyCell[]): { total; offHours; weekend; offShare: number | null; weekendShare: number | null }`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/__tests__/work-metrics-hourly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hourlyTargets, offHoursShare, parseKinds } from "@/lib/work-metrics/hourly";

describe("parseKinds", () => {
  it("허용 종류만, 비면 커밋 기본", () => {
    expect(parseKinds("commit,issue,x")).toEqual(["commit", "issue"]);
    expect(parseKinds(null)).toEqual(["commit"]);
    expect(parseKinds("mr,mr")).toEqual(["mr"]);
  });
});

describe("hourlyTargets", () => {
  const m = (n: number) => Array.from({ length: n }, (_, i) => ({ email: `u${i}@innogrid.com` }));
  it("본인 화면은 1명이어도 보이고, 조직 화면은 3명 미만이면 숨긴다", () => {
    expect(hourlyTargets(m(1), { self: true })).toEqual({ emails: ["u0@innogrid.com"], suppressed: false });
    expect(hourlyTargets(m(2), { self: false })).toEqual({ emails: null, suppressed: true });
    expect(hourlyTargets(m(3), { self: false }).suppressed).toBe(false);
  });
});

describe("offHoursShare", () => {
  it("업무시간 = 평일 09~17시. 그 밖과 주말을 센다", () => {
    const r = offHoursShare([
      { kind: "commit", dow: 1, hour: 9, n: 4 },   // 월 09시 — 업무시간
      { kind: "commit", dow: 1, hour: 17, n: 1 },  // 월 17시 — 업무시간
      { kind: "commit", dow: 1, hour: 18, n: 2 },  // 월 18시 — 밖
      { kind: "commit", dow: 6, hour: 10, n: 3 },  // 토 — 주말(밖)
    ]);
    expect(r).toEqual({ total: 10, offHours: 5, weekend: 3, offShare: 0.5, weekendShare: 0.3 });
    expect(offHoursShare([])).toEqual({ total: 0, offHours: 0, weekend: 0, offShare: null, weekendShare: null });
  });
});
```

`frontend/src/lib/__tests__/work-metrics-durations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadDurations } from "@/lib/work-metrics/perf-report";

const fake = (rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>) => ({ rpc }) as never;

describe("loadDurations", () => {
  it("RPC가 없으면(스키마 캐시) durationsReady=false, 500 아님", async () => {
    const r = await loadDurations(fake(async () => ({ data: null, error: { message: "Could not find the function public.work_items_time_stats in the schema cache" } })), "2026-09-01", "2026-09-28", null);
    expect(r).toEqual({ durations: [], durationsReady: false });
  });
  it("다른 오류는 error로 돌려주고, 정상이면 숫자로 바꾼다", async () => {
    expect(await loadDurations(fake(async () => ({ data: null, error: { message: "timeout" } })), "2026-09-01", "2026-09-28", null)).toEqual({ error: "durations: timeout" });
    const r = await loadDurations(fake(async (_n, args) => {
      expect(args).toEqual({ p_from: "2026-09-01", p_to: "2026-09-28", p_emails: ["a@innogrid.com"] });
      return { data: [{ grp: "all", kind: "issue", metric: "lead", n: "3", p50: "24", p90: "70.5", avg: "30", b1: "0", b2: "2", b3: "1", b4: "0", b5: "0" }], error: null };
    }), "2026-09-01", "2026-09-28", ["a@innogrid.com"]);
    expect(r).toEqual({ durations: [{ grp: "all", kind: "issue", metric: "lead", n: 3, p50: 24, p90: 70.5, avg: 30, b1: 0, b2: 2, b3: 1, b4: 0, b5: 0 }], durationsReady: true });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-hourly.test.ts src/lib/__tests__/work-metrics-durations.test.ts`
Expected: FAIL — 모듈/함수 없음

- [ ] **Step 3: perf-report.ts에 loadDurations, 리포트에 포함**

`perf-report.ts` import에 `import type { TimeStatRow } from "@/types/work-metrics";` 추가. `buildPerfReport` 위에:

```ts
/** work_items_time_stats — RPC가 아직 없으면(2단계 SQL 미적용) 빈 목록 + durationsReady=false. 화면은 평균으로 폴백한다 */
export async function loadDurations(
  admin: SupabaseClient, from: string, to: string, filterEmails: string[] | null
): Promise<{ durations: TimeStatRow[]; durationsReady: boolean } | { error: string }> {
  const res = await admin.rpc("work_items_time_stats", { p_from: from, p_to: to, p_emails: filterEmails });
  if (res.error) {
    if (/could not find|does not exist|schema cache/i.test(res.error.message)) return { durations: [], durationsReady: false };
    return { error: `durations: ${res.error.message}` };
  }
  return { durations: ((res.data ?? []) as Record<string, unknown>[]).map((r) => numify(r) as unknown as TimeStatRow), durationsReady: true };
}
```

`buildPerfReport`의 `Promise.all`(101~106행)에 다섯 번째 요소로 `loadDurations(admin, from, to, filterEmails)`를 넣고 `const [code, jira, gitlab, conf, dur] = …`. 오류 검사 루프 뒤에:

```ts
  if ("error" in dur) return { ok: false, error: dur.error };
```

return의 `durations: [], durationsReady: false`(Task 1)를 `durations: dur.durations, durationsReady: dur.durationsReady`로 바꾼다.

- [ ] **Step 4: hourly.ts 구현**

`frontend/src/lib/work-metrics/hourly.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HourlyCell, HourlyKind } from "@/types/work-metrics";

/**
 * 활동 시간대 — work_items_hourly RPC. 공개 범위: 팀·조직 합계만, 개인별은 본인 화면(self)에서만.
 * 대상이 3명 미만이면 숨긴다(k-익명성). RPC에 사용자 차원이 없어 개인을 되짚을 수 없다.
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
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/work-metrics-hourly.test.ts src/lib/__tests__/work-metrics-durations.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), 타입 오류 0

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/lib/work-metrics/perf-report.ts frontend/src/lib/work-metrics/hourly.ts frontend/src/lib/__tests__/work-metrics-hourly.test.ts frontend/src/lib/__tests__/work-metrics-durations.test.ts
git commit -m "feat(perf): 소요 시간 RPC 로드·시간대 로직(hourly.ts)"
```

---

### Task 15: 시간대 라우트 2개

**Files:**
- Create: `frontend/src/app/api/admin/work-metrics/perf/hourly/route.ts`
- Create: `frontend/src/app/api/usage/perf/hourly/route.ts`
- Test: `npx tsc --noEmit` + 로컬 curl

**Interfaces:**
- Consumes: `parseKinds`, `hourlyTargets`, `loadHourly`(Task 14), `resolveUsageScope`, `requireAdmin`·`adminClientOr500`·`isYmd`, `dateRangePreset`
- Produces: `HourlyResponse`(Task 1)

- [ ] **Step 1: 어드민 라우트**

`frontend/src/app/api/admin/work-metrics/perf/hourly/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { hourlyTargets, loadHourly, parseKinds } from "@/lib/work-metrics/hourly";
import type { HourlyResponse } from "@/types/work-metrics";

export const runtime = "nodejs";

/**
 * GET /api/admin/work-metrics/perf/hourly?from&to&team&kinds=commit,issue,mr — 활동 시간대(admin).
 * 팀 필터까지만 받고 이름 검색(q)은 받지 않는다. 팀이 3명 미만이면 suppressed. 개인별 값은 내려가지 않는다(RPC에 사용자 차원 없음).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  const team = sp.get("team")?.trim() || null;
  const kinds = parseKinds(sp.get("kinds"));

  let emails: string[] | null = null;
  let suppressed = false;
  let scopeLabel = "전체";
  if (team) {
    const dir = await admin.from("company_directory").select("email").eq("active", true).eq("team", team).limit(1000);
    if (dir.error) return NextResponse.json({ error: dir.error.message }, { status: 500 });
    const t = hourlyTargets((dir.data ?? []).map((r) => ({ email: r.email as string })), { self: false });
    emails = t.emails; suppressed = t.suppressed; scopeLabel = `${team} (${dir.data?.length ?? 0}명)`;
  }
  const headers = { "Cache-Control": "no-store" };
  const base = { range: { from, to }, scope: { scopeLabel }, kinds };
  if (suppressed) return NextResponse.json({ ...base, cells: [], suppressed: true, notReady: false } satisfies HourlyResponse, { headers });
  const res = await loadHourly(admin, { from, to, emails, kinds });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ...base, cells: res.cells, suppressed: false, notReady: res.notReady } satisfies HourlyResponse, { headers });
}
```

- [ ] **Step 2: 개인용 라우트**

`frontend/src/app/api/usage/perf/hourly/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { hourlyTargets, loadHourly, parseKinds } from "@/lib/work-metrics/hourly";
import type { HourlyResponse } from "@/types/work-metrics";

export const runtime = "nodejs";

/**
 * GET /api/usage/perf/hourly?from&to&team&kinds — 개인/조직장용 활동 시간대.
 * 본인(scope self)은 본인만. 조직장은 범위 안에서 팀 필터까지만, 3명 미만이면 suppressed. 이름 검색은 받지 않는다.
 */
export async function GET(request: NextRequest) {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope, admin } = r;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  const team = sp.get("team")?.trim() || null;
  const kinds = parseKinds(sp.get("kinds"));

  const self = scope.scope === "self";
  const members = self ? scope.members.filter((m) => m.email === scope.email) : team ? scope.members.filter((m) => m.team === team) : scope.members;
  const t = hourlyTargets(members, { self });
  const headers = { "Cache-Control": "no-store" };
  const base = { range: { from, to }, scope: { scopeLabel: self ? "내 활동" : team ? `${team} (${members.length}명)` : scope.scopeLabel }, kinds };
  if (t.suppressed) return NextResponse.json({ ...base, cells: [], suppressed: true, notReady: false } satisfies HourlyResponse, { headers });
  const res = await loadHourly(admin, { from, to, emails: t.emails, kinds });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ...base, cells: res.cells, suppressed: false, notReady: res.notReady } satisfies HourlyResponse, { headers });
}
```

`scope.email`은 `UsageScope`(`lib/usage-scope.ts:45`)의 본인 이메일이다.

- [ ] **Step 3: 타입·린트·로컬 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint 2>&1 | tail -3`
브라우저 로그인 상태에서 `/api/usage/perf/hourly?from=2026-09-01&to=2026-09-28&kinds=commit` → `{ range, scope: { scopeLabel: "내 활동" }, kinds: ["commit"], cells: [...], suppressed: false, notReady: false }`(백필 전이면 cells 빈 배열).

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/app/api/admin/work-metrics/perf/hourly/route.ts frontend/src/app/api/usage/perf/hourly/route.ts
git commit -m "feat(perf): 활동 시간대 API(어드민·개인용, 3명 미만 숨김)"
```

---

### Task 16: 공용 히트맵 `HourHeatmap`과 Claude 사용량 탭 리팩터

**Files:**
- Create: `frontend/src/components/shared/HourHeatmap.tsx`
- Modify: `frontend/src/components/admin/claude-usage/HourlyPatternTab.tsx:45-131`
- Test: `frontend/src/lib/__tests__/hour-heatmap.test.tsx`

**Interfaces:**
- Produces: `HeatCell { dow: number; hour: number; value: number; title?: string }`(dow는 isodow 1=월..7=일), `HourHeatmap({ cells, unit, footnote? })`

- [ ] **Step 1: 실패하는 렌더 테스트**

`frontend/src/lib/__tests__/hour-heatmap.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HourHeatmap from "@/components/shared/HourHeatmap";

describe("HourHeatmap", () => {
  it("월~일 7행·24열을 그리고 최대값 셀에 숫자를 쓴다", () => {
    render(<HourHeatmap cells={[{ dow: 1, hour: 9, value: 10 }, { dow: 7, hour: 22, value: 4, title: "일 22시 — 커밋 4건" }]} unit="건" />);
    expect(screen.getByText("월")).toBeInTheDocument();
    expect(screen.getByText("일")).toBeInTheDocument();
    expect(screen.getByTitle("월 9시 — 10건")).toHaveTextContent("10"); // 최대값 셀에만 숫자
    expect(screen.getByTitle("일 22시 — 커밋 4건")).toBeInTheDocument();
    expect(screen.getByTitle("화 0시 — 없음")).toBeInTheDocument(); // 기본 title
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/hour-heatmap.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`frontend/src/components/shared/HourHeatmap.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { int } from "@/components/admin/claude-usage/format";

/** 요일×시각 히트맵(KST). dow는 isodow(1=월 … 7=일). Claude 사용량 시간대 탭과 성과 시간대 탭이 같이 쓴다 */
export interface HeatCell { dow: number; hour: number; value: number; title?: string }
const DOW = ["", "월", "화", "수", "목", "금", "토", "일"];

export default function HourHeatmap({ cells, unit, footnote }: { cells: HeatCell[]; unit: string; footnote?: string }) {
  const { grid, max, hourTotals } = useMemo(() => {
    const grid = new Map<string, HeatCell>();
    let max = 0;
    const hourTotals = Array.from({ length: 24 }, () => 0);
    for (const c of cells) {
      grid.set(`${c.dow}:${c.hour}`, c);
      max = Math.max(max, c.value);
      hourTotals[c.hour] += c.value;
    }
    return { grid, max: Math.max(1, max), hourTotals };
  }, [cells]);
  const maxHourTotal = Math.max(1, ...hourTotals);
  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="pr-1 text-right text-[10px] font-normal text-muted-foreground">시</th>
            {Array.from({ length: 24 }, (_, h) => <th key={h} className="w-7 text-center text-[10px] font-normal text-muted-foreground">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
            <tr key={dow}>
              <td className={`pr-1 text-right text-[11px] ${dow >= 6 ? "text-red-500" : "text-muted-foreground"}`}>{DOW[dow]}</td>
              {Array.from({ length: 24 }, (_, h) => {
                const cell = grid.get(`${dow}:${h}`);
                const v = cell?.value ?? 0;
                const alpha = v === 0 ? 0 : 0.15 + 0.85 * (v / max);
                return (
                  <td key={h} className="h-7 w-7 rounded-sm text-center align-middle text-[9px]"
                    style={{ backgroundColor: v === 0 ? "var(--muted)" : `rgba(79, 70, 229, ${alpha.toFixed(2)})`, color: alpha > 0.55 ? "#fff" : undefined }}
                    title={cell?.title ?? (cell ? `${DOW[dow]} ${h}시 — ${int(v)}${unit}` : `${DOW[dow]} ${h}시 — 없음`)}>
                    {v > 0 && v >= max * 0.5 ? int(v) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td className="pr-1 pt-1 text-right text-[10px] text-muted-foreground">합계</td>
            {hourTotals.map((v, h) => (
              <td key={h} className="pt-1 text-center align-bottom" title={`${h}시 합계 ${int(v)}${unit}`}>
                <div className="mx-auto w-4 rounded-sm bg-primary/30" style={{ height: `${Math.max(2, Math.round((v / maxHourTotal) * 28))}px` }} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">{footnote ?? `색 농도 = 해당 요일·시각의 ${unit} 수(최대 ${int(max)}${unit} 기준). 마지막 줄은 시각별 합계입니다.`}</p>
    </div>
  );
}
```

- [ ] **Step 4: HourlyPatternTab을 공용 컴포넌트로**

`HourlyPatternTab.tsx`에서 `useMemo` 블록(45~58행)과 `<div className="overflow-x-auto">…</div>` + 안내 `<p>`(81~131행)를 지우고, `import HourHeatmap from "@/components/shared/HourHeatmap";`를 추가한 뒤 `CardContent` 안을 아래로 바꾼다. `DOW` 상수와 `total` 계산은 유지한다(제목에 쓰므로 `total`은 `data.cells`의 requests 합으로 다시 계산):

```tsx
  const total = useMemo(() => (data?.cells ?? []).reduce((a, c) => a + Number(c.requests), 0), [data]);
  const heat = useMemo(() => (data?.cells ?? []).map((c) => {
    const dow = Number(c.dow) === 0 ? 7 : Number(c.dow); // RPC는 dow 0=일 → isodow
    return { dow, hour: Number(c.hour), value: Number(c.requests), title: `${DOW[Number(c.dow)]} ${c.hour}시 — 요청 ${int(Number(c.requests))}건 · ${usd(Number(c.cost_usd))} · 사용자 ${int(Number(c.users))}명` };
  }), [data, usd]);
  …
        <CardContent>
          <HourHeatmap cells={heat} unit="건" footnote="색 농도 = 해당 요일·시각의 요청 수. 셀에 마우스를 올리면 요청·비용·사용자 수가 보입니다. 마지막 줄은 시각별 합계입니다." />
        </CardContent>
```

- [ ] **Step 5: 통과·화면 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/hour-heatmap.test.tsx && npx tsc --noEmit && npm run lint 2>&1 | tail -3`
`/admin/claude-usage` 시간대 탭이 이전과 같이 보이는지(요일 순서 월~일, 툴팁에 비용·사용자) 확인.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/shared/HourHeatmap.tsx frontend/src/components/admin/claude-usage/HourlyPatternTab.tsx frontend/src/lib/__tests__/hour-heatmap.test.tsx
git commit -m "refactor(usage): 요일×시각 히트맵을 공용 HourHeatmap으로 추출"
```

---

### Task 17: 대시보드 2단계 — p50·분포·체류·시간대 탭·코호트 열

**Files:**
- Modify: `frontend/src/components/usage/PerfDashboard.tsx`
- Create: `frontend/src/components/usage/PerfHourlyTab.tsx`
- Test: `frontend/src/lib/__tests__/perf-durations-ui.test.ts`(순수 헬퍼), 타입·린트, 브라우저

**Interfaces:**
- Consumes: `TimeStatRow`, `HourlyResponse`(Task 1), `offHoursShare`(Task 14), `HourHeatmap`(Task 16)
- Produces: `frontend/src/lib/work-metrics/durations-view.ts`의 `pickStat(rows, grp, kind, metric): TimeStatRow | undefined`, `DIST_LABELS`, `weightedP50(rows: TimeStatRow[]): number | null`

- [ ] **Step 1: 순수 헬퍼 테스트**

`frontend/src/lib/__tests__/perf-durations-ui.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickStat, weightedP50 } from "@/lib/work-metrics/durations-view";
import type { TimeStatRow } from "@/types/work-metrics";

const row = (grp: string, kind: "issue" | "mr", metric: "lead" | "cycle" | "wait", n: number, p50: number): TimeStatRow => ({ grp, kind, metric, n, p50, p90: p50 * 2, avg: p50, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0 });

describe("durations-view", () => {
  const rows = [row("all", "issue", "cycle", 10, 20), row("user:a@innogrid.com", "issue", "cycle", 4, 10), row("user:b@innogrid.com", "issue", "cycle", 6, 30), row("all", "mr", "lead", 3, 5)];
  it("pickStat은 grp·kind·metric으로 한 행", () => {
    expect(pickStat(rows, "all", "issue", "cycle")?.p50).toBe(20);
    expect(pickStat(rows, "all", "issue", "wait")).toBeUndefined();
  });
  it("weightedP50은 건수 가중 평균, 비면 null", () => {
    expect(weightedP50([rows[1], rows[2]])).toBe(22);
    expect(weightedP50([])).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인 후 헬퍼 구현**

Run: `cd frontend && npx vitest run src/lib/__tests__/perf-durations-ui.test.ts` → FAIL(모듈 없음).

`frontend/src/lib/work-metrics/durations-view.ts`:

```ts
import type { TimeMetric, TimeStatRow } from "@/types/work-metrics";

/** 화면용 소요 시간 행 선택·근사. RPC 행(grp = all | week:… | user:… | scope:…)을 그대로 받는다 */
export const DIST_LABELS = ["≤4h", "≤1일", "≤3일", "≤1주", ">1주"] as const;

export function pickStat(rows: TimeStatRow[], grp: string, kind: "issue" | "mr", metric: TimeMetric): TimeStatRow | undefined {
  return rows.find((r) => r.grp === grp && r.kind === kind && r.metric === metric);
}

/** 여러 그룹(코호트 구성원)의 p50을 건수 가중 평균으로 근사. 정확한 코호트 p50은 후속 */
export function weightedP50(rows: TimeStatRow[]): number | null {
  const n = rows.reduce((a, r) => a + r.n, 0);
  if (!n) return null;
  return rows.reduce((a, r) => a + r.p50 * r.n, 0) / n;
}
```

Run again → PASS (2 tests).

- [ ] **Step 3: 시간대 탭 컴포넌트**

`frontend/src/components/usage/PerfHourlyTab.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import HourHeatmap from "@/components/shared/HourHeatmap";
import { int } from "@/components/admin/claude-usage/format";
import { offHoursShare } from "@/lib/work-metrics/hourly";
import type { HourlyKind, HourlyResponse } from "@/types/work-metrics";

const KIND_LABEL: Record<HourlyKind, string> = { commit: "커밋(authored)", issue: "이슈 해결", mr: "MR 머지" };
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** 활동 시간대 탭 — apiPath는 성과 API 경로(…/perf), 여기에 /hourly를 붙인다. 조직 화면은 팀 합계만, 개인 화면은 본인만 */
export default function PerfHourlyTab({ apiPath, from, to, team, isSelf }: { apiPath: string; from: string; to: string; team: string; isSelf: boolean }) {
  const [kind, setKind] = useState<HourlyKind>("commit");
  const [result, setResult] = useState<{ key: string; data?: HourlyResponse; error?: string } | null>(null);
  const key = `${from}|${to}|${team}|${kind}`;
  useEffect(() => {
    let cancelled = false;
    const teamQs = team !== "all" ? `&team=${encodeURIComponent(team)}` : "";
    fetch(`${apiPath}/hourly?from=${from}&to=${to}&kinds=${kind}${teamQs}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as HourlyResponse; })
      .then((j) => { if (!cancelled) setResult({ key, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [apiPath, from, to, team, kind, key]);
  const loading = result?.key !== key;
  const data = result?.data ?? null;
  const share = useMemo(() => offHoursShare(data?.cells ?? []), [data]);
  const heat = useMemo(() => (data?.cells ?? []).map((c) => ({ dow: c.dow, hour: c.hour, value: c.n })), [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(KIND_LABEL) as HourlyKind[]).map((k) => (
          <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>{KIND_LABEL[k]}</Button>
        ))}
        {data && <span className="text-xs text-muted-foreground">{data.scope.scopeLabel}</span>}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {result?.error && result.key === key && <p className="text-sm text-destructive">{result.error}</p>}
      {data?.notReady && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">시간대 집계 함수가 아직 없습니다 — docs/sql/2026-09-28-work-items.sql을 적용하세요.</p>}
      {data?.suppressed && <p className="rounded-md border p-2 text-xs text-muted-foreground">대상이 3명 미만이라 시간대는 표시하지 않습니다.</p>}
      {data && !data.suppressed && !data.notReady && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{KIND_LABEL[kind]}</div><div className="mt-1 text-lg font-semibold tabular-nums">{int(share.total)}건</div></div>
            <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">업무시간 외 비중</div><div className="mt-1 text-lg font-semibold tabular-nums">{pct(share.offShare)}</div><div className="text-[11px] text-muted-foreground">평일 09~18시 밖 + 주말</div></div>
            <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">주말 비중</div><div className="mt-1 text-lg font-semibold tabular-nums">{pct(share.weekendShare)}</div></div>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">시간대별 활동 (KST · {KIND_LABEL[kind]})</CardTitle>
              <p className="text-xs text-muted-foreground">{isSelf ? "내 활동만 집계합니다." : "팀·조직 합계입니다. 개인별 시간대는 표시하지 않습니다."} 커밋은 authored 시각, 이슈는 해결 시각, MR은 머지 시각 기준.</p>
            </CardHeader>
            <CardContent><HourHeatmap cells={heat} unit="건" /></CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 대시보드에 p50·분포·체류·열·코호트·탭 배선**

`PerfDashboard.tsx` 변경 목록(코드 그대로 넣는다):

(a) import 추가:
```ts
import PerfHourlyTab from "@/components/usage/PerfHourlyTab";
import { DIST_LABELS, pickStat, weightedP50 } from "@/lib/work-metrics/durations-view";
import type { TimeStatRow } from "@/types/work-metrics";
```

(b) 분포 막대 컴포넌트(`AdoptionCard` 아래):
```tsx
function DistBars({ row, title }: { row: TimeStatRow | undefined; title: string }) {
  if (!row || !row.n) return null;
  const vals = [row.b1, row.b2, row.b3, row.b4, row.b5];
  const max = Math.max(1, ...vals);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title} 분포 (n={int(row.n)} · p50 {row.p50.toFixed(1)}h · p90 {row.p90.toFixed(1)}h · 평균 {row.avg.toFixed(1)}h)</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-1">
          {vals.map((v, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-10 text-right text-muted-foreground">{DIST_LABELS[i]}</span>
              <div className="h-4 flex-1 rounded-sm bg-muted"><div className="h-4 rounded-sm bg-primary/60" style={{ width: `${Math.round((v / max) * 100)}%` }} /></div>
              <span className="w-20 tabular-nums">{int(v)}건 ({Math.round((v / row.n) * 100)}%)</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

(c) `t` 아래에 선택 헬퍼:
```ts
  const dur = data?.durationsReady ? data.durations : [];
  const stat = (grp: string, kind: "issue" | "mr", metric: "lead" | "cycle" | "wait") => pickStat(dur, grp, kind, metric);
  const p50 = (grp: string, kind: "issue" | "mr", metric: "lead" | "cycle" | "wait") => stat(grp, kind, metric)?.p50 ?? null;
  const p50Sort = (v: number | null) => (v === null ? -1 : v);
```

(d) 요약 탭 사이클 카드: `durationsReady`면 p50이 주 값.
```tsx
                <Stat label={data.durationsReady ? "사이클 타임(p50)" : "사이클 타임(평균)"}
                  value={data.durationsReady ? hOf(p50("all", "issue", "cycle")) : hOf(cycleAvg)}
                  sub={data.durationsReady ? `평균 ${hOf(cycleAvg)} · p90 ${hOf(stat("all", "issue", "cycle")?.p90 ?? null)} · 대기 p50 ${hOf(p50("all", "issue", "wait"))}` : `리드 ${h(t.leadSum, t.resolved)} (생성→해결)`}
                  delta={cycleAvg !== null && prevCycleAvg !== null ? delta(cycleAvg, prevCycleAvg, true) : null} />
```
(증감은 평균 기준을 유지한다. 직전 기간 p50은 후속.)

(e) Jira 탭: `WeekBars` 사이클 시리즈를 p50 우선으로, 아래에 체류·분포:
```tsx
          <WeekBars weeks={weeks} title={data?.durationsReady ? "주별 사이클 타임(p50 h)" : "주별 사이클 타임(평균 h)"} highlightFrom={data?.compare?.adoption.date} series={[
            { label: "사이클 h", cls: "bg-amber-500/60", value: (w) => (data?.durationsReady ? Math.round((p50(`week:${w.week}`, "issue", "cycle") ?? 0) * 10) / 10 : w.cycle_count ? Math.round((w.cycle_hours_sum / w.cycle_count) * 10) / 10 : 0) },
          ]} />
          {data?.durationsReady && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="대기 p50 (생성→진행)" value={hOf(p50("all", "issue", "wait"))} sub={`n=${int(stat("all", "issue", "wait")?.n ?? 0)}`} />
              <Stat label="진행 p50 (진행→해결)" value={hOf(p50("all", "issue", "cycle"))} sub={`n=${int(stat("all", "issue", "cycle")?.n ?? 0)}`} />
              <Stat label="리드 p50 (생성→해결)" value={hOf(p50("all", "issue", "lead"))} sub={`p90 ${hOf(stat("all", "issue", "lead")?.p90 ?? null)}`} />
            </div>
          )}
          <DistBars row={stat("all", "issue", "cycle")} title="사이클 타임" />
```
`jiraUserCols`에 두 열(사이클(평균) 열 뒤):
```tsx
    { key: "cyclep50", header: "사이클 p50", align: "right", value: (r) => p50Sort(p50(`user:${r.email}`, "issue", "cycle")), render: (r) => hOf(p50(`user:${r.email}`, "issue", "cycle")) },
    { key: "leadp50", header: "리드 p50", align: "right", value: (r) => p50Sort(p50(`user:${r.email}`, "issue", "lead")), render: (r) => hOf(p50(`user:${r.email}`, "issue", "lead")) },
```
`projCols`에: `{ key: "cyclep50", header: "사이클 p50", align: "right", value: (r) => p50Sort(p50(`scope:${r.key}`, "issue", "cycle")), render: (r) => hOf(p50(`scope:${r.key}`, "issue", "cycle")) },`

(f) 코드 탭: 코드 산출 `WeekBars` 아래에
```tsx
          {data?.durationsReady && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="MR 리드 p50 (오픈→머지)" value={hOf(p50("all", "mr", "lead"))} sub={`p90 ${hOf(stat("all", "mr", "lead")?.p90 ?? null)} · n=${int(stat("all", "mr", "lead")?.n ?? 0)}`} />
            </div>
          )}
          <DistBars row={stat("all", "mr", "lead")} title="MR 리드타임" />
```
`codeUserCols`의 "MR 리드(평균)" 열 뒤와 `repoCols`의 "MR 리드(평균)" 열 뒤에 각각:
```tsx
    { key: "mrp50", header: "MR 리드 p50", align: "right", value: (r) => p50Sort(p50(`user:${r.email}`, "mr", "lead")), render: (r) => hOf(p50(`user:${r.email}`, "mr", "lead")) },
```
```tsx
    { key: "mrp50", header: "MR 리드 p50", align: "right", value: (r) => p50Sort(p50(`scope:${r.key}`, "mr", "lead")), render: (r) => hOf(p50(`scope:${r.key}`, "mr", "lead")) },
```

(g) 코호트: `cohorts` useMemo의 return 객체에 두 필드를 추가하고 의존성 배열을 `[data, isTeamView, dur]`로 바꾼다:
```ts
        cycleP50: weightedP50(us.map((u) => stat(`user:${u.email}`, "issue", "cycle")).filter((r): r is TimeStatRow => !!r)),
        mrP50: weightedP50(us.map((u) => stat(`user:${u.email}`, "mr", "lead")).filter((r): r is TimeStatRow => !!r)),
```
표 헤더 `<th className="px-2 py-1 text-right">문서</th>` 뒤에 `<th className="px-2 py-1 text-right">사이클 p50</th><th className="px-2 py-1 text-right">MR 리드 p50</th>`, 행의 마지막 `<td>` 뒤에:
```tsx
                          <td className="px-2 py-1.5 text-right tabular-nums">{hOf(c.cycleP50)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{hOf(c.mrP50)}</td>
```
카드 설명 `<p>` 끝에 " p50 열은 구성원별 p50의 건수 가중 근사입니다."를 덧붙인다. `stat`은 useMemo 밖에서 정의되므로 useMemo 안에서 쓰려면 `dur`만 의존성에 넣으면 된다(`stat`은 `dur`의 순수 함수).

(h) 시간대 탭: `TabsList`에 `<TabsTrigger value="hourly">시간대</TabsTrigger>`(분석 앞), 내용:
```tsx
        <TabsContent value="hourly">
          {data && <PerfHourlyTab apiPath={apiPath} from={range.from} to={range.to} team={team} isSelf={data.scope.scope === "self"} />}
        </TabsContent>
```
어드민에서는 이름 검색(`q`)이 시간대에 영향을 주지 않는다는 문구를 탭 상단에 한 줄: `{q && <p className="text-xs text-muted-foreground">시간대는 이름 검색을 적용하지 않습니다(팀·조직 합계).</p>}`.

- [ ] **Step 5: 타입·린트·테스트·화면**

Run: `cd frontend && npx tsc --noEmit && npm run lint 2>&1 | tail -3 && npm test -- --run 2>&1 | tail -3`
백필 전이라도 `/usage/perf`가 평균으로 정상 렌더(`durationsReady=false`)되고 시간대 탭이 "함수 없음" 또는 빈 히트맵을 보여야 한다. RPC 적용 후에는 p50 카드·분포·체류·시간대 히트맵이 값으로 채워진다.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/usage/PerfDashboard.tsx frontend/src/components/usage/PerfHourlyTab.tsx frontend/src/lib/work-metrics/durations-view.ts frontend/src/lib/__tests__/perf-durations-ui.test.ts
git commit -m "feat(perf): 사이클·리드 p50/p90·분포·체류, 활동 시간대 탭, 코호트 p50 열"
```

---

### Task 18: 2단계 배포·백필·대조

**Files:** 없음(운영)

- [ ] **Step 1: 푸시·배포**

```bash
git fetch origin && git status -sb && git push origin main
cd frontend && NODE_OPTIONS= vercel deploy --prod --yes 2>&1 | tail -3
NODE_OPTIONS= vercel inspect https://inje-playground.vercel.app 2>&1 | grep -E "url" | head -2
```
Expected: URL `innogrid-playground-…`, alias 일치. Task 8의 SQL이 이미 적용돼 있어야 한다(아니면 지금 적용).

- [ ] **Step 2: Jira 백필 (월 단위)**

관리자 브라우저 세션으로 아래 URL을 차례로 연다(각각 수 분). 또는 `frontend/.env.local`에 `CRON_SECRET`이 있으면 curl로:

```bash
cd frontend && SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)
for r in "2026-05-01 2026-05-31" "2026-06-01 2026-06-30" "2026-07-01 2026-07-31" "2026-08-01 2026-08-31" "2026-09-01 $(TZ=Asia/Seoul date -v-1d +%F)"; do set -- $r
  curl -sS "https://inje-playground.vercel.app/api/cron/work-metrics?source=jira&from=$1&to=$2" -H "Authorization: Bearer $SECRET" | head -c 300; echo; done; unset SECRET
```
Expected: 각 응답 `results[0].ok=true`, notes에 `items N건`.

- [ ] **Step 3: GitLab 백필 (사내망, 사용자 실행)**

`python3 frontend/scripts/gitlab-metrics-sync.py --from 2026-05-04 --to <어제>` → 출력에 `→ gitlab {...}`와 `→ gitlab_items {"ok":true,"upserted":M,…}`.

- [ ] **Step 4: 대조 쿼리 (Management API)**

```sql
select 'issues' as k, (select count(*) from work_items where source='jira' and kind='issue' and done_at >= '2026-09-01 00:00+09' and done_at < '2026-09-28 00:00+09') as items,
       (select coalesce(sum(issues_resolved),0) from jira_issue_daily where day between '2026-09-01' and '2026-09-27') as daily
union all
select 'commits', (select count(*) from work_items where source='gitlab' and kind='commit' and created_at >= '2026-09-01 00:00+09' and created_at < '2026-09-28 00:00+09'),
       (select coalesce(sum(commits),0) from gitlab_daily where day between '2026-09-01' and '2026-09-27')
union all
select 'mrs_merged', (select count(*) from work_items where source='gitlab' and kind='mr' and done_at >= '2026-09-01 00:00+09' and done_at < '2026-09-28 00:00+09'),
       (select coalesce(sum(mrs_merged),0) from gitlab_daily where day between '2026-09-01' and '2026-09-27');
```
Expected: 세 행 모두 `items = daily`. 어긋나면 이메일 정규화 전후(`aid:` 행, `gitlab_email_map`)와 날짜 경계(KST)를 먼저 의심한다.

- [ ] **Step 5: 운영 화면 확인**

`/admin/perf` 요약 탭 p50 카드·도입 전후, Jira 탭 분포·체류·구성원 p50 열, 코드 탭 MR p50·분포, 시간대 탭 히트맵(전체·팀 2명 이하 팀 선택 시 "3명 미만" 문구), `/usage/perf` 시간대 탭 "내 활동". 스크린샷을 남긴다.

---

### Task 19: 문서 갱신

**Files:**
- Modify: `.claude/rules/claude-usage-cost.md`
- Modify: `docs/superpowers/specs/2026-08-31-claude-roi-integrations-design.md`(§8 끝)
- Modify: `frontend/src/lib/work-metrics/common.ts:3`(설계 링크)

- [ ] **Step 1: 규칙 파일**

`.claude/rules/claude-usage-cost.md`의 "## API" 절 `GET /api/usage/{scope,code,…}` 항목 뒤에 한 항목 추가:

```markdown
- 성과 API(`/api/admin/work-metrics/perf`, `/api/usage/perf`)는 `freshness`(소스별 마지막 수집·48시간 오래됨)·`compare=1`(직전 기간·도입 전후 4주 총계, 도입일 상수 `lib/work-metrics/adoption.ts`)·`durations`(RPC `work_items_time_stats` 행: 리드·사이클·대기·MR 리드 p50/p90/분포, grp all|week:|user:|scope:)를 함께 내린다. 활동 시간대는 `…/perf/hourly?from&to&team&kinds`(RPC `work_items_hourly`, **팀·조직 합계만**, 3명 미만 suppressed, 개인은 본인만) — `lib/work-metrics/{freshness,compare,totals,hourly,items,durations-view}.ts`, 화면 `components/usage/PerfHourlyTab.tsx`, 공용 히트맵 `components/shared/HourHeatmap.tsx`
```

"## Supabase 테이블" 절 work metrics 항목 뒤에:

```markdown
- `work_items`(source·kind·item_key PK, 이슈·MR·커밋 한 행, created_at/started_at/done_at, is_claude — SQL `docs/sql/2026-09-28-work-items.sql`) + RPC `work_items_time_stats`·`work_items_hourly`(service_role). Jira 수집기와 GitLab 로컬 스크립트(`gitlab_items` 소스, 커밋은 기간 replace·MR은 PK upsert)가 일 집계와 함께 쓴다. 백필·대조는 스펙 `2026-09-28-perf-time-metrics-design.md` §4.3
```

- [ ] **Step 2: 기존 스펙 §8에 한 줄**

```markdown
- **시간 정보(2026-09-28)**: `work_items` 항목 테이블 + RPC로 p50/p90·분포·체류·시간대 히트맵, 기준 시점 배지, 직전 기간·도입 전후 비교. 설계 `docs/superpowers/specs/2026-09-28-perf-time-metrics-design.md`, 계획 `docs/superpowers/plans/2026-09-28-perf-time-metrics.md`.
```

- [ ] **Step 3: common.ts 헤더 주석에 새 스펙 링크 추가**

```ts
/** 성과 측정 수집기 공통 — 이메일 정규화·KST 날짜·upsert. 설계: docs/superpowers/specs/2026-08-31-claude-roi-integrations-design.md, 시간 정보: docs/superpowers/specs/2026-09-28-perf-time-metrics-design.md */
```

- [ ] **Step 4: 커밋·푸시**

```bash
git add .claude/rules/claude-usage-cost.md docs/superpowers/specs/2026-08-31-claude-roi-integrations-design.md frontend/src/lib/work-metrics/common.ts
git commit -m "docs(perf): 성과 시간 정보 규칙 파일·스펙 현황 갱신"
git push origin main
```
