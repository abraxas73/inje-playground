# Claude 사용량 대시보드 (OTel + CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 7개 Claude Team 조직의 사용자별 Claude Code 사용량(OTel 실시간)과 채팅·Cowork 활동(멤버 활동 CSV)을 Supabase에 적재하고 `/admin/claude-usage`에서 통합 조회한다.

**Architecture:** Claude Code 클라이언트가 관리형 설정으로 켜진 OTLP(http/json, delta)를 `POST /api/otel/v1/{metrics,logs}`로 보내면 토큰 검증 후 `lib/claude-usage/otlp.ts`가 파싱해 RPC `claude_code_ingest`로 일 단위(KST) 사용자별 합산 테이블에 누적한다. 소유자가 월 1회 내려받는 `members-analytics-*.csv`는 `/api/admin/claude-usage/imports`로 업로드해 `claude_member_activity`에 교체 적재한다. 관리자 페이지는 두 소스를 이메일로 조인해 표시한다.

**Tech Stack:** Next.js 16 App Router(Route Handlers, Node runtime), React 19, TypeScript strict, Tailwind 4 + shadcn/ui(Card/Tabs/Select/Input/Button/Badge), Supabase(service role 쓰기 + RLS admin 읽기, plpgsql RPC), vitest 3(jsdom).

**Spec:** `docs/superpowers/specs/2026-08-26-claude-usage-analytics-design.md` (§2 확정 아키텍처)

## Global Constraints

- 모든 코드는 `frontend/` 하위. 경로 별칭 `@/*` = `frontend/src/*`. 페이지는 `"use client"`.
- 실제 직원 이메일·이름을 리포(테스트 픽스처 포함)에 넣지 않는다. 테스트는 `dev1@example.com` 같은 합성 데이터만 사용.
- DB 쓰기는 service role(`createAdminClient()` in `@/lib/supabase-admin`)로만. 관리자 API는 세션 클라이언트로 `user_profiles.role === 'admin'` 확인 후 service role 사용(기존 `/api/admin/*` 패턴 + RLS 이중 방어).
- 신규 환경변수: `SUPABASE_SERVICE_ROLE_KEY`(사용자가 Vercel·`.env.local`에 설정), `CLAUDE_OTEL_INGEST_TOKEN`(수집 토큰). settings 테이블에 저장 금지.
- 날짜 집계는 **KST(Asia/Seoul)** 일 단위. 금액 단위는 USD(소수). 토큰·카운트는 numeric.
- 커밋은 main에 직접(브랜치/worktree 금지 — 사용자 규칙). 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 테스트 실행: `cd frontend && npx vitest run <file>`. 린트: `cd frontend && npm run lint`.
- 사용자 미확인 사항은 없음(2026-08-26 결정 A2). Innogrid-ax 조직 ID `4ad6b3e9-552f-4b67-bb96-25b51d1852f4`는 문서 예시로만 사용.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `docs/sql/2026-08-26-claude-usage.sql` | 테이블 6개·RPC·RLS 마이그레이션(사용자가 Supabase SQL Editor에서 실행) |
| `docs/claude-usage.md` | 운영 런북: 환경변수, 관리형 설정 JSON, 롤아웃, 월간 CSV 절차 |
| `frontend/src/types/claude-usage.ts` | 공용 타입·필드 상수 |
| `frontend/src/lib/claude-usage/otlp.ts` | OTLP JSON → `DailyRow[]`/`ModelRow[]`/`ApiRequestEvent[]` (순수 함수) |
| `frontend/src/lib/claude-usage/ingest-auth.ts` | Bearer 토큰 상수시간 검증 |
| `frontend/src/lib/claude-usage/ingest-store.ts` | Supabase 쓰기(RPC 호출·이벤트 insert·수신 로그) |
| `frontend/src/lib/claude-usage/members-csv.ts` | RFC4180 CSV 파서 + 멤버 활동 CSV 매핑 + 파일명 파서 |
| `frontend/src/lib/claude-usage/aggregate.ts` | 일별 행 → 요약(사용자/일별/모델), 노는 시트 판정, CSV 조인 |
| `frontend/src/lib/claude-usage/managed-settings.ts` | 관리형 설정 JSON 생성 |
| `frontend/src/lib/claude-usage/require-admin.ts` | 관리자 API 공통 가드 |
| `frontend/src/app/api/otel/v1/metrics/route.ts`, `.../logs/route.ts` | OTLP 수신 |
| `frontend/src/app/api/admin/claude-usage/{summary,members,imports,imports/[id],orgs,health}/route.ts` | 관리자 API |
| `frontend/src/app/admin/claude-usage/page.tsx` | 탭 컨테이너 |
| `frontend/src/components/admin/claude-usage/{CodeUsageTab,MembersCsvTab,OrgSettingsTab,DailyBars,SortableTable}.tsx` | UI |
| `frontend/src/app/admin/layout.tsx` | 네비 항목 추가 |
| `frontend/scripts/claude-usage-upload.sh`, `.claude/skills/claude-usage-csv/SKILL.md` | CSV 반자동 수집(Task 9) |
| `frontend/src/lib/__tests__/claude-usage-*.test.ts` | 단위 테스트 |

---
### Task 1: 공용 타입 + DB 마이그레이션 SQL + 런북 골격

**Files:**
- Create: `frontend/src/types/claude-usage.ts`
- Create: `docs/sql/2026-08-26-claude-usage.sql`
- Create: `docs/claude-usage.md`

**Interfaces:**
- Produces: `DAILY_NUMERIC_FIELDS`, `DailyMetrics`, `DailyRow`, `ModelRow`, `ApiRequestEvent`, `MemberActivityRow`, `CsvImport`, `ClaudeOrg`, `UserUsageRow`, `UsageSummary` (아래 코드 그대로). 이후 모든 Task가 이 타입을 import한다.
- DB: 테이블 `claude_orgs`, `claude_code_daily`, `claude_code_daily_model`, `claude_code_requests`, `claude_ingest_log`, `claude_csv_imports`, `claude_member_activity`; RPC `claude_code_ingest(p_daily jsonb, p_model jsonb)`.

- [ ] **Step 1: 타입 파일 작성**

```ts
// frontend/src/types/claude-usage.ts
/** Claude 사용량 대시보드 공용 타입 — OTel(Claude Code) + 멤버 활동 CSV */

export const DAILY_NUMERIC_FIELDS = [
  "sessions",
  "prompts",
  "cost_usd",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
  "loc_added",
  "loc_removed",
  "edits_accepted",
  "edits_rejected",
  "commits",
  "pull_requests",
  "active_user_seconds",
  "active_cli_seconds",
] as const;
export type DailyNumericField = (typeof DAILY_NUMERIC_FIELDS)[number];
export type DailyMetrics = Record<DailyNumericField, number>;

export function emptyDailyMetrics(): DailyMetrics {
  return Object.fromEntries(DAILY_NUMERIC_FIELDS.map((f) => [f, 0])) as DailyMetrics;
}

/** claude_code_daily 한 행 (day = KST YYYY-MM-DD) */
export interface DailyRow extends DailyMetrics {
  day: string;
  org_id: string;
  user_email: string;
  account_uuid: string | null;
}

/** claude_code_daily_model 한 행 */
export interface ModelRow {
  day: string;
  org_id: string;
  user_email: string;
  model: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

/** claude_code.api_request 이벤트 1건 */
export interface ApiRequestEvent {
  ts: string; // ISO
  org_id: string;
  user_email: string;
  account_uuid: string | null;
  session_id: string | null;
  model: string | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  duration_ms: number | null;
  query_source: string | null;
  request_id: string | null;
}

export interface ClaudeOrg {
  id: string;
  name: string;
  seats_total: number | null;
  sort_order: number;
}

/** members-analytics CSV 한 행 */
export interface MemberActivityRow {
  name: string;
  email: string;
  role: string;
  seat_tier: string;
  last_active: string | null;
  days_active: number;
  chats: number;
  messages: number;
  projects_created: number;
  projects_used: number;
  pull_requests: number;
  code_sessions: number;
  file_edits: number;
  cowork_sessions: number;
  cowork_messages: number;
  artifacts_created: number;
  claude_code_artifacts: number;
  cowork_artifacts: number;
  estimated_spend_usd: number;
}

export interface CsvImport {
  id: string;
  org_id: string;
  period_start: string;
  period_end: string;
  filename: string | null;
  row_count: number;
  created_at: string;
}

export interface UserUsageRow extends DailyMetrics {
  user_email: string;
  orgs: string[];
  active_days: number;
  name: string | null;
  seat_tier: string | null;
}

export interface UsageSummary {
  range: { from: string; to: string };
  orgs: ClaudeOrg[];
  totals: DailyMetrics & { active_users: number };
  users: UserUsageRow[];
  daily: { day: string; cost_usd: number; sessions: number; active_users: number }[];
  models: {
    model: string;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
  }[];
}
```

- [ ] **Step 2: 마이그레이션 SQL 작성** (`docs/sql/2026-08-26-claude-usage.sql`)

```sql
-- Claude 사용량 대시보드 (OTel + CSV) — 2026-08-26
-- Supabase SQL Editor에서 그대로 실행. 멱등(if not exists / or replace).

create table if not exists public.claude_orgs (
  id text primary key,                      -- Anthropic organization UUID
  name text not null,
  seats_total int,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.claude_code_daily (
  day date not null,
  org_id text not null references public.claude_orgs(id),
  user_email text not null,
  account_uuid text,
  sessions numeric not null default 0,
  prompts numeric not null default 0,
  cost_usd numeric not null default 0,
  input_tokens numeric not null default 0,
  output_tokens numeric not null default 0,
  cache_read_tokens numeric not null default 0,
  cache_creation_tokens numeric not null default 0,
  loc_added numeric not null default 0,
  loc_removed numeric not null default 0,
  edits_accepted numeric not null default 0,
  edits_rejected numeric not null default 0,
  commits numeric not null default 0,
  pull_requests numeric not null default 0,
  active_user_seconds numeric not null default 0,
  active_cli_seconds numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, org_id, user_email)
);
create index if not exists claude_code_daily_email_idx on public.claude_code_daily (user_email, day);

create table if not exists public.claude_code_daily_model (
  day date not null,
  org_id text not null,
  user_email text not null,
  model text not null,
  cost_usd numeric not null default 0,
  input_tokens numeric not null default 0,
  output_tokens numeric not null default 0,
  cache_read_tokens numeric not null default 0,
  cache_creation_tokens numeric not null default 0,
  primary key (day, org_id, user_email, model)
);

create table if not exists public.claude_code_requests (
  id bigint generated always as identity primary key,
  ts timestamptz not null,
  org_id text not null,
  user_email text not null,
  account_uuid text,
  session_id text,
  model text,
  cost_usd numeric not null default 0,
  input_tokens numeric not null default 0,
  output_tokens numeric not null default 0,
  cache_read_tokens numeric not null default 0,
  cache_creation_tokens numeric not null default 0,
  duration_ms numeric,
  query_source text,
  request_id text
);
create index if not exists claude_code_requests_ts_idx on public.claude_code_requests (ts);
create index if not exists claude_code_requests_email_idx on public.claude_code_requests (user_email, ts);

create table if not exists public.claude_ingest_log (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  signal text not null,                     -- 'metrics' | 'logs'
  org_ids text[] not null default '{}',
  rows int not null default 0,
  dropped int not null default 0,
  bytes int not null default 0,
  ok boolean not null default true,
  error text
);
create index if not exists claude_ingest_log_received_idx on public.claude_ingest_log (received_at desc);

create table if not exists public.claude_csv_imports (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.claude_orgs(id),
  period_start date not null,
  period_end date not null,
  filename text,
  uploaded_by uuid,
  row_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, period_start, period_end)
);

create table if not exists public.claude_member_activity (
  import_id uuid not null references public.claude_csv_imports(id) on delete cascade,
  org_id text not null,
  period_start date not null,
  period_end date not null,
  name text,
  email text not null,
  role text,
  seat_tier text,
  last_active date,
  days_active int not null default 0,
  chats int not null default 0,
  messages int not null default 0,
  projects_created int not null default 0,
  projects_used int not null default 0,
  pull_requests int not null default 0,
  code_sessions int not null default 0,
  file_edits int not null default 0,
  cowork_sessions int not null default 0,
  cowork_messages int not null default 0,
  artifacts_created int not null default 0,
  claude_code_artifacts int not null default 0,
  cowork_artifacts int not null default 0,
  estimated_spend_usd numeric not null default 0,
  primary key (import_id, email)
);
create index if not exists claude_member_activity_email_idx on public.claude_member_activity (email);

-- delta 합산 RPC: 같은 호출 안에 (day,org,email[,model]) 중복 키가 없어야 한다(파서가 사전 집계).
create or replace function public.claude_code_ingest(p_daily jsonb, p_model jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into claude_orgs (id, name)
  select distinct x->>'org_id', left(x->>'org_id', 8)
  from jsonb_array_elements(coalesce(p_daily, '[]'::jsonb)) x
  where coalesce(x->>'org_id', '') <> ''
  on conflict (id) do nothing;

  insert into claude_code_daily (day, org_id, user_email, account_uuid,
    sessions, prompts, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
    loc_added, loc_removed, edits_accepted, edits_rejected, commits, pull_requests,
    active_user_seconds, active_cli_seconds)
  select (x->>'day')::date, x->>'org_id', x->>'user_email', nullif(x->>'account_uuid', ''),
    coalesce((x->>'sessions')::numeric, 0), coalesce((x->>'prompts')::numeric, 0),
    coalesce((x->>'cost_usd')::numeric, 0), coalesce((x->>'input_tokens')::numeric, 0),
    coalesce((x->>'output_tokens')::numeric, 0), coalesce((x->>'cache_read_tokens')::numeric, 0),
    coalesce((x->>'cache_creation_tokens')::numeric, 0), coalesce((x->>'loc_added')::numeric, 0),
    coalesce((x->>'loc_removed')::numeric, 0), coalesce((x->>'edits_accepted')::numeric, 0),
    coalesce((x->>'edits_rejected')::numeric, 0), coalesce((x->>'commits')::numeric, 0),
    coalesce((x->>'pull_requests')::numeric, 0), coalesce((x->>'active_user_seconds')::numeric, 0),
    coalesce((x->>'active_cli_seconds')::numeric, 0)
  from jsonb_array_elements(coalesce(p_daily, '[]'::jsonb)) x
  on conflict (day, org_id, user_email) do update set
    account_uuid = coalesce(excluded.account_uuid, claude_code_daily.account_uuid),
    sessions = claude_code_daily.sessions + excluded.sessions,
    prompts = claude_code_daily.prompts + excluded.prompts,
    cost_usd = claude_code_daily.cost_usd + excluded.cost_usd,
    input_tokens = claude_code_daily.input_tokens + excluded.input_tokens,
    output_tokens = claude_code_daily.output_tokens + excluded.output_tokens,
    cache_read_tokens = claude_code_daily.cache_read_tokens + excluded.cache_read_tokens,
    cache_creation_tokens = claude_code_daily.cache_creation_tokens + excluded.cache_creation_tokens,
    loc_added = claude_code_daily.loc_added + excluded.loc_added,
    loc_removed = claude_code_daily.loc_removed + excluded.loc_removed,
    edits_accepted = claude_code_daily.edits_accepted + excluded.edits_accepted,
    edits_rejected = claude_code_daily.edits_rejected + excluded.edits_rejected,
    commits = claude_code_daily.commits + excluded.commits,
    pull_requests = claude_code_daily.pull_requests + excluded.pull_requests,
    active_user_seconds = claude_code_daily.active_user_seconds + excluded.active_user_seconds,
    active_cli_seconds = claude_code_daily.active_cli_seconds + excluded.active_cli_seconds,
    updated_at = now();

  insert into claude_code_daily_model (day, org_id, user_email, model,
    cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
  select (x->>'day')::date, x->>'org_id', x->>'user_email', x->>'model',
    coalesce((x->>'cost_usd')::numeric, 0), coalesce((x->>'input_tokens')::numeric, 0),
    coalesce((x->>'output_tokens')::numeric, 0), coalesce((x->>'cache_read_tokens')::numeric, 0),
    coalesce((x->>'cache_creation_tokens')::numeric, 0)
  from jsonb_array_elements(coalesce(p_model, '[]'::jsonb)) x
  on conflict (day, org_id, user_email, model) do update set
    cost_usd = claude_code_daily_model.cost_usd + excluded.cost_usd,
    input_tokens = claude_code_daily_model.input_tokens + excluded.input_tokens,
    output_tokens = claude_code_daily_model.output_tokens + excluded.output_tokens,
    cache_read_tokens = claude_code_daily_model.cache_read_tokens + excluded.cache_read_tokens,
    cache_creation_tokens = claude_code_daily_model.cache_creation_tokens + excluded.cache_creation_tokens;
end;
$$;
revoke execute on function public.claude_code_ingest(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.claude_code_ingest(jsonb, jsonb) to service_role;

-- RLS: 읽기는 admin만, 쓰기 정책 없음(service role만 쓴다)
do $$
declare t text;
begin
  foreach t in array array['claude_orgs','claude_code_daily','claude_code_daily_model','claude_code_requests','claude_ingest_log','claude_csv_imports','claude_member_activity']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))',
      t || '_admin_read', t);
  end loop;
end $$;
```

- [ ] **Step 3: 런북 골격 작성** (`docs/claude-usage.md`) — 아래 내용으로 생성. Task 8에서 관리형 설정 JSON·검증 절차를 채운다.

```markdown
# Claude 사용량 대시보드 운영 런북

설계: `docs/superpowers/specs/2026-08-26-claude-usage-analytics-design.md` · 화면: `/admin/claude-usage`

## 1. 최초 설정
1. Supabase SQL Editor에서 `docs/sql/2026-08-26-claude-usage.sql` 실행.
2. 환경변수(Vercel Production + `frontend/.env.local`):
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase > Project Settings > API > service_role (서버 전용, 절대 클라이언트 노출 금지)
   - `CLAUDE_OTEL_INGEST_TOKEN` — 임의의 32바이트 이상 랜덤 문자열(`openssl rand -hex 32`)
3. 배포 후 `/admin/claude-usage` > 조직·설정 탭에서 "수집 상태"가 토큰/서비스키 구성됨으로 표시되는지 확인.

## 2. Claude Code 수집 켜기 (조직별 1회) — Task 8에서 채움
## 3. 월간 CSV 절차 — Task 8에서 채움
## 4. 장애 대응 — Task 8에서 채움
```

- [ ] **Step 4: 타입 컴파일 확인**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep claude-usage || echo OK`
Expected: `OK`

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/types/claude-usage.ts docs/sql/2026-08-26-claude-usage.sql docs/claude-usage.md
git commit -m "feat(claude-usage): 공용 타입·DB 마이그레이션 SQL·런북 골격

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**사용자 액션(병행)**: SQL을 Supabase 대시보드에서 실행하고, `SUPABASE_SERVICE_ROLE_KEY`를 Vercel(Production)과 `frontend/.env.local`에 추가.

---

### Task 2: OTLP JSON 파서 (`otlp.ts`) — TDD

**Files:**
- Create: `frontend/src/lib/claude-usage/otlp.ts`
- Test: `frontend/src/lib/__tests__/claude-usage-otlp.test.ts`

**Interfaces:**
- Consumes: `DailyRow`, `ModelRow`, `ApiRequestEvent`, `emptyDailyMetrics` from `@/types/claude-usage`
- Produces:
  - `parseMetricsPayload(body: unknown): { daily: DailyRow[]; model: ModelRow[]; dropped: number }`
  - `parseLogsPayload(body: unknown): { requests: ApiRequestEvent[]; promptDaily: DailyRow[]; dropped: number }`
  - `kstDay(ms: number): string`, `nanoToMs(nano: string | number | undefined): number | null`
- 매핑 규칙(delta 합산): `claude_code.session.count`→sessions · `claude_code.cost.usage`→cost_usd(+model행) · `claude_code.token.usage`(attr `type`: input/output/cacheRead/cacheCreation)→토큰 4종(+model행) · `claude_code.lines_of_code.count`(type: added/removed) · `claude_code.code_edit_tool.decision`(decision: accept/reject) · `claude_code.commit.count`→commits · `claude_code.pull_request.count`→pull_requests · `claude_code.active_time.total`(type: user/cli). 사용자 = 데이터포인트 attr `user.email` → 리소스 attr → `uuid:<user.account_uuid>` → `unknown`. 조직 = `organization.id` → `unknown`. temporality가 CUMULATIVE(2 또는 문자열 포함 "CUMULATIVE")인 메트릭은 버리고 dropped++.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-usage-otlp.test.ts
import { describe, it, expect } from "vitest";
import { parseMetricsPayload, parseLogsPayload, kstDay, nanoToMs } from "@/lib/claude-usage/otlp";

const RES = { attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }] };
const ID = [
  { key: "user.email", value: { stringValue: "Dev1@Example.com" } },
  { key: "user.account_uuid", value: { stringValue: "acc-1" } },
  { key: "organization.id", value: { stringValue: "org-a" } },
  { key: "session.id", value: { stringValue: "s1" } },
];
// 2026-08-25T15:30:00Z = 2026-08-26 00:30 KST
const T = "1787326200000000000";
const point = (v: number, extra: { key: string; value: { stringValue: string } }[] = []) => ({
  attributes: [...ID, ...extra],
  timeUnixNano: T,
  asDouble: v,
});
const sum = (name: string, dataPoints: unknown[], temporality: number | string = 1) => ({
  name,
  sum: { dataPoints, aggregationTemporality: temporality, isMonotonic: true },
});
const metricsBody = (metrics: unknown[]) => ({ resourceMetrics: [{ resource: RES, scopeMetrics: [{ metrics }] }] });

describe("kstDay / nanoToMs", () => {
  it("나노초 문자열을 ms로, UTC 15:30을 KST 다음날로", () => {
    expect(nanoToMs(T)).toBe(1787326200000);
    expect(nanoToMs(undefined)).toBeNull();
    expect(kstDay(1787326200000)).toBe("2026-08-26");
  });
});

describe("parseMetricsPayload", () => {
  it("메트릭을 사용자·일 단위로 합산하고 모델별 행을 만든다", () => {
    const body = metricsBody([
      sum("claude_code.session.count", [point(1)]),
      sum("claude_code.cost.usage", [
        point(0.5, [{ key: "model", value: { stringValue: "claude-opus-5" } }]),
        point(0.25, [{ key: "model", value: { stringValue: "claude-opus-5" } }]),
      ]),
      sum("claude_code.token.usage", [
        point(100, [{ key: "type", value: { stringValue: "input" } }, { key: "model", value: { stringValue: "claude-opus-5" } }]),
        point(40, [{ key: "type", value: { stringValue: "output" } }, { key: "model", value: { stringValue: "claude-opus-5" } }]),
        point(7, [{ key: "type", value: { stringValue: "cacheRead" } }, { key: "model", value: { stringValue: "claude-opus-5" } }]),
        point(3, [{ key: "type", value: { stringValue: "cacheCreation" } }, { key: "model", value: { stringValue: "claude-opus-5" } }]),
      ]),
      sum("claude_code.lines_of_code.count", [
        point(30, [{ key: "type", value: { stringValue: "added" } }]),
        point(5, [{ key: "type", value: { stringValue: "removed" } }]),
      ]),
      sum("claude_code.code_edit_tool.decision", [
        point(4, [{ key: "decision", value: { stringValue: "accept" } }]),
        point(1, [{ key: "decision", value: { stringValue: "reject" } }]),
      ]),
      sum("claude_code.commit.count", [point(2)]),
      sum("claude_code.pull_request.count", [point(1)]),
      sum("claude_code.active_time.total", [
        point(120, [{ key: "type", value: { stringValue: "user" } }]),
        point(30, [{ key: "type", value: { stringValue: "cli" } }]),
      ]),
    ]);
    const r = parseMetricsPayload(body);
    expect(r.dropped).toBe(0);
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0]).toMatchObject({
      day: "2026-08-26", org_id: "org-a", user_email: "dev1@example.com", account_uuid: "acc-1",
      sessions: 1, cost_usd: 0.75, input_tokens: 100, output_tokens: 40, cache_read_tokens: 7, cache_creation_tokens: 3,
      loc_added: 30, loc_removed: 5, edits_accepted: 4, edits_rejected: 1, commits: 2, pull_requests: 1,
      active_user_seconds: 120, active_cli_seconds: 30, prompts: 0,
    });
    expect(r.model).toEqual([
      { day: "2026-08-26", org_id: "org-a", user_email: "dev1@example.com", model: "claude-opus-5",
        cost_usd: 0.75, input_tokens: 100, output_tokens: 40, cache_read_tokens: 7, cache_creation_tokens: 3 },
    ]);
  });

  it("asInt 문자열 값, 이메일 없음(uuid 폴백), 조직 없음(unknown), 리소스 속성 폴백을 처리한다", () => {
    const body = {
      resourceMetrics: [{
        resource: { attributes: [{ key: "user.email", value: { stringValue: "res@example.com" } }] },
        scopeMetrics: [{ metrics: [
          { name: "claude_code.session.count", sum: { aggregationTemporality: 1, dataPoints: [
            { attributes: [], timeUnixNano: T, asInt: "3" },
          ] } },
          { name: "claude_code.session.count", sum: { aggregationTemporality: 1, dataPoints: [
            { attributes: [{ key: "user.account_uuid", value: { stringValue: "acc-9" } }, { key: "organization.id", value: { stringValue: "org-b" } }],
              timeUnixNano: T, asInt: 2 },
          ] } },
        ] }],
      }],
    };
    const r = parseMetricsPayload(body);
    expect(r.daily).toHaveLength(2);
    const byEmail = Object.fromEntries(r.daily.map((d) => [d.user_email, d]));
    expect(byEmail["res@example.com"]).toMatchObject({ org_id: "unknown", sessions: 3 });
    // 데이터포인트에 이메일이 없고 account_uuid만 있으면 리소스 이메일보다 uuid 폴백이 아니라 리소스 이메일을 쓴다
    // → 리소스에 이메일이 있으므로 두 번째 포인트도 res@example.com 이어야 하지만 org가 다르므로 별도 행
    expect(byEmail["res@example.com"].sessions + (byEmail["uuid:acc-9"]?.sessions ?? 0)).toBe(5);
  });

  it("CUMULATIVE 메트릭은 버리고 dropped를 센다", () => {
    const r = parseMetricsPayload(metricsBody([
      sum("claude_code.session.count", [point(1)], 2),
      sum("claude_code.session.count", [point(1)], "AGGREGATION_TEMPORALITY_CUMULATIVE"),
      sum("claude_code.session.count", [point(1)], "AGGREGATION_TEMPORALITY_DELTA"),
    ]));
    expect(r.dropped).toBe(2);
    expect(r.daily[0].sessions).toBe(1);
  });

  it("형식이 아니면 빈 결과", () => {
    expect(parseMetricsPayload(null)).toEqual({ daily: [], model: [], dropped: 0 });
    expect(parseMetricsPayload({ resourceMetrics: "x" })).toEqual({ daily: [], model: [], dropped: 0 });
  });
});

describe("parseLogsPayload", () => {
  const log = (name: string, attrs: Record<string, string | number>, viaBody = false) => ({
    timeUnixNano: T,
    body: viaBody ? { stringValue: name } : undefined,
    attributes: [
      ...(viaBody ? [] : [{ key: "event.name", value: { stringValue: name } }]),
      ...ID,
      ...Object.entries(attrs).map(([k, v]) => [k, typeof v === "number" ? { key: k, value: { doubleValue: v } } : { key: k, value: { stringValue: v } }][1]),
    ],
  });
  const logsBody = (records: unknown[]) => ({ resourceLogs: [{ resource: RES, scopeLogs: [{ logRecords: records }] }] });

  it("api_request 이벤트를 추출하고 user_prompt는 일별 prompts로 센다", () => {
    const r = parseLogsPayload(logsBody([
      log("claude_code.api_request", { model: "claude-opus-5", cost_usd: 0.12, input_tokens: 10, output_tokens: 5, cache_read_tokens: 1, cache_creation_tokens: 0, duration_ms: 900, query_source: "main", request_id: "req-1" }),
      log("claude_code.api_request", { model: "claude-sonnet-5", cost_usd: "0.01", input_tokens: "3", output_tokens: "2" }, true),
      log("claude_code.user_prompt", { prompt_length: 20 }),
      log("claude_code.user_prompt", { prompt_length: 5 }),
      log("claude_code.tool_result", { tool_name: "Edit" }),
    ]));
    expect(r.requests).toHaveLength(2);
    expect(r.requests[0]).toMatchObject({
      ts: "2026-08-25T15:30:00.000Z", org_id: "org-a", user_email: "dev1@example.com", account_uuid: "acc-1", session_id: "s1",
      model: "claude-opus-5", cost_usd: 0.12, input_tokens: 10, output_tokens: 5, cache_read_tokens: 1, cache_creation_tokens: 0,
      duration_ms: 900, query_source: "main", request_id: "req-1",
    });
    expect(r.requests[1]).toMatchObject({ model: "claude-sonnet-5", cost_usd: 0.01, input_tokens: 3, output_tokens: 2, duration_ms: null, request_id: null });
    expect(r.promptDaily).toEqual([
      expect.objectContaining({ day: "2026-08-26", org_id: "org-a", user_email: "dev1@example.com", prompts: 2, sessions: 0 }),
    ]);
    expect(r.dropped).toBe(0);
  });

  it("형식이 아니면 빈 결과", () => {
    expect(parseLogsPayload({})).toEqual({ requests: [], promptDaily: [], dropped: 0 });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-usage-otlp.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/claude-usage/otlp"`

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/claude-usage/otlp.ts
/**
 * OTLP/HTTP JSON(ExportMetricsServiceRequest / ExportLogsServiceRequest) → 앱 내부 행.
 * Claude Code는 delta temporality로 보내므로 같은 (day, org, email[, model]) 키를 합산한다.
 * 순수 함수 — I/O 없음.
 */
import {
  DAILY_NUMERIC_FIELDS,
  emptyDailyMetrics,
  type ApiRequestEvent,
  type DailyRow,
  type ModelRow,
} from "@/types/claude-usage";

type AnyValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
};
type KeyValue = { key: string; value?: AnyValue };
type Attrs = Record<string, string | number | boolean>;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function nanoToMs(nano: string | number | undefined): number | null {
  if (nano === undefined || nano === null || nano === "") return null;
  try {
    const big = typeof nano === "number" ? BigInt(Math.trunc(nano)) : BigInt(nano);
    return Number(big / 1_000_000n);
  } catch {
    return null;
  }
}

/** ms(UTC) → Asia/Seoul 기준 YYYY-MM-DD */
export function kstDay(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function attrsToRecord(list: unknown): Attrs {
  const out: Attrs = {};
  if (!Array.isArray(list)) return out;
  for (const kv of list as KeyValue[]) {
    if (!kv || typeof kv.key !== "string" || !kv.value) continue;
    const v = kv.value;
    if (typeof v.stringValue === "string") out[kv.key] = v.stringValue;
    else if (v.intValue !== undefined) out[kv.key] = Number(v.intValue);
    else if (typeof v.doubleValue === "number") out[kv.key] = v.doubleValue;
    else if (typeof v.boolValue === "boolean") out[kv.key] = v.boolValue;
  }
  return out;
}

function str(a: Attrs, key: string): string | null {
  const v = a[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function num(a: Attrs, key: string): number | null {
  const v = a[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

interface Identity {
  org_id: string;
  user_email: string;
  account_uuid: string | null;
  session_id: string | null;
}
function identity(point: Attrs, resource: Attrs): Identity {
  const pick = (k: string) => str(point, k) ?? str(resource, k);
  const account_uuid = pick("user.account_uuid");
  const email = pick("user.email")?.toLowerCase() ?? null;
  return {
    org_id: pick("organization.id") ?? "unknown",
    user_email: email ?? (account_uuid ? `uuid:${account_uuid}` : "unknown"),
    account_uuid,
    session_id: pick("session.id"),
  };
}

function isCumulative(t: unknown): boolean {
  if (t === 2) return true;
  return typeof t === "string" && t.toUpperCase().includes("CUMULATIVE");
}

function pointValue(p: { asDouble?: number; asInt?: string | number }): number | null {
  if (typeof p.asDouble === "number") return p.asDouble;
  if (p.asInt !== undefined) {
    const n = Number(p.asInt);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

class DailyAcc {
  private map = new Map<string, DailyRow>();
  add(day: string, id: Identity, field: (typeof DAILY_NUMERIC_FIELDS)[number], value: number) {
    const key = `${day}|${id.org_id}|${id.user_email}`;
    let row = this.map.get(key);
    if (!row) {
      row = { ...emptyDailyMetrics(), day, org_id: id.org_id, user_email: id.user_email, account_uuid: id.account_uuid };
      this.map.set(key, row);
    }
    if (!row.account_uuid && id.account_uuid) row.account_uuid = id.account_uuid;
    row[field] += value;
  }
  rows(): DailyRow[] {
    return [...this.map.values()];
  }
}

class ModelAcc {
  private map = new Map<string, ModelRow>();
  add(day: string, id: Identity, model: string, field: keyof Omit<ModelRow, "day" | "org_id" | "user_email" | "model">, value: number) {
    const key = `${day}|${id.org_id}|${id.user_email}|${model}`;
    let row = this.map.get(key);
    if (!row) {
      row = { day, org_id: id.org_id, user_email: id.user_email, model, cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
      this.map.set(key, row);
    }
    row[field] += value;
  }
  rows(): ModelRow[] {
    return [...this.map.values()];
  }
}

const TOKEN_TYPE_FIELD: Record<string, "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_creation_tokens"> = {
  input: "input_tokens",
  output: "output_tokens",
  cacheread: "cache_read_tokens",
  cachecreation: "cache_creation_tokens",
  cache_read: "cache_read_tokens",
  cache_creation: "cache_creation_tokens",
};

export function parseMetricsPayload(body: unknown): { daily: DailyRow[]; model: ModelRow[]; dropped: number } {
  const daily = new DailyAcc();
  const model = new ModelAcc();
  let dropped = 0;
  const rms = (body as { resourceMetrics?: unknown })?.resourceMetrics;
  if (!Array.isArray(rms)) return { daily: [], model: [], dropped: 0 };

  for (const rm of rms as { resource?: { attributes?: unknown }; scopeMetrics?: unknown }[]) {
    const resource = attrsToRecord(rm?.resource?.attributes);
    if (!Array.isArray(rm?.scopeMetrics)) continue;
    for (const sm of rm.scopeMetrics as { metrics?: unknown }[]) {
      if (!Array.isArray(sm?.metrics)) continue;
      for (const m of sm.metrics as { name?: string; sum?: { dataPoints?: unknown; aggregationTemporality?: unknown }; gauge?: { dataPoints?: unknown } }[]) {
        const name = m?.name;
        const dps = m?.sum?.dataPoints ?? m?.gauge?.dataPoints;
        if (!name || !Array.isArray(dps)) continue;
        if (m.sum && isCumulative(m.sum.aggregationTemporality)) {
          dropped += dps.length;
          continue;
        }
        for (const p of dps as { attributes?: unknown; timeUnixNano?: string | number; asDouble?: number; asInt?: string | number }[]) {
          const ms = nanoToMs(p.timeUnixNano);
          const value = pointValue(p);
          if (ms === null || value === null) {
            dropped++;
            continue;
          }
          const a = attrsToRecord(p.attributes);
          const id = identity(a, resource);
          const day = kstDay(ms);
          const type = (str(a, "type") ?? "").replace(/[\s-]/g, "").toLowerCase();
          switch (name) {
            case "claude_code.session.count":
              daily.add(day, id, "sessions", value);
              break;
            case "claude_code.cost.usage": {
              daily.add(day, id, "cost_usd", value);
              const mdl = str(a, "model");
              if (mdl) model.add(day, id, mdl, "cost_usd", value);
              break;
            }
            case "claude_code.token.usage": {
              const field = TOKEN_TYPE_FIELD[type];
              if (!field) {
                dropped++;
                break;
              }
              daily.add(day, id, field, value);
              const mdl = str(a, "model");
              if (mdl) model.add(day, id, mdl, field, value);
              break;
            }
            case "claude_code.lines_of_code.count":
              if (type === "added") daily.add(day, id, "loc_added", value);
              else if (type === "removed") daily.add(day, id, "loc_removed", value);
              else dropped++;
              break;
            case "claude_code.code_edit_tool.decision": {
              const d = (str(a, "decision") ?? "").toLowerCase();
              if (d === "accept") daily.add(day, id, "edits_accepted", value);
              else if (d === "reject") daily.add(day, id, "edits_rejected", value);
              else dropped++;
              break;
            }
            case "claude_code.commit.count":
              daily.add(day, id, "commits", value);
              break;
            case "claude_code.pull_request.count":
              daily.add(day, id, "pull_requests", value);
              break;
            case "claude_code.active_time.total":
              if (type === "user") daily.add(day, id, "active_user_seconds", value);
              else if (type === "cli") daily.add(day, id, "active_cli_seconds", value);
              else dropped++;
              break;
            default:
              // 알 수 없는 메트릭은 무시(카운트하지 않음)
              break;
          }
        }
      }
    }
  }
  return { daily: daily.rows(), model: model.rows(), dropped };
}

export function parseLogsPayload(body: unknown): { requests: ApiRequestEvent[]; promptDaily: DailyRow[]; dropped: number } {
  const requests: ApiRequestEvent[] = [];
  const prompts = new DailyAcc();
  let dropped = 0;
  const rls = (body as { resourceLogs?: unknown })?.resourceLogs;
  if (!Array.isArray(rls)) return { requests: [], promptDaily: [], dropped: 0 };

  for (const rl of rls as { resource?: { attributes?: unknown }; scopeLogs?: unknown }[]) {
    const resource = attrsToRecord(rl?.resource?.attributes);
    if (!Array.isArray(rl?.scopeLogs)) continue;
    for (const sl of rl.scopeLogs as { logRecords?: unknown }[]) {
      if (!Array.isArray(sl?.logRecords)) continue;
      for (const rec of sl.logRecords as { timeUnixNano?: string | number; observedTimeUnixNano?: string | number; body?: AnyValue; attributes?: unknown }[]) {
        const a = attrsToRecord(rec.attributes);
        const name = str(a, "event.name") ?? (typeof rec.body?.stringValue === "string" ? rec.body.stringValue.trim() : null);
        const ms = nanoToMs(rec.timeUnixNano) ?? nanoToMs(rec.observedTimeUnixNano);
        if (!name || ms === null) {
          dropped++;
          continue;
        }
        const id = identity(a, resource);
        if (name === "claude_code.api_request") {
          requests.push({
            ts: new Date(ms).toISOString(),
            org_id: id.org_id,
            user_email: id.user_email,
            account_uuid: id.account_uuid,
            session_id: id.session_id,
            model: str(a, "model"),
            cost_usd: num(a, "cost_usd") ?? 0,
            input_tokens: num(a, "input_tokens") ?? 0,
            output_tokens: num(a, "output_tokens") ?? 0,
            cache_read_tokens: num(a, "cache_read_tokens") ?? 0,
            cache_creation_tokens: num(a, "cache_creation_tokens") ?? 0,
            duration_ms: num(a, "duration_ms"),
            query_source: str(a, "query_source"),
            request_id: str(a, "request_id"),
          });
        } else if (name === "claude_code.user_prompt") {
          prompts.add(kstDay(ms), id, "prompts", 1);
        }
        // 그 외 이벤트(tool_result, tool_decision, assistant_response, api_error)는 저장하지 않음
      }
    }
  }
  return { requests, promptDaily: prompts.rows(), dropped };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-usage-otlp.test.ts`
Expected: PASS (7 tests). 두 번째 테스트에서 `uuid:acc-9` 행이 생기지 않고 `res@example.com`이 `org-b`에도 생기면(리소스 이메일 폴백이 우선) 합계 5 검증은 그대로 통과한다 — 의도된 동작.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/claude-usage/otlp.ts frontend/src/lib/__tests__/claude-usage-otlp.test.ts
git commit -m "feat(claude-usage): OTLP JSON 파서 — 메트릭 delta 합산·api_request/user_prompt 이벤트 추출

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 수집 인증 + 저장 + OTLP 수신 라우트

**Files:**
- Create: `frontend/src/lib/claude-usage/ingest-auth.ts`
- Create: `frontend/src/lib/claude-usage/ingest-store.ts`
- Create: `frontend/src/app/api/otel/v1/metrics/route.ts`
- Create: `frontend/src/app/api/otel/v1/logs/route.ts`
- Test: `frontend/src/lib/__tests__/claude-usage-ingest-auth.test.ts`

**Interfaces:**
- Consumes: `parseMetricsPayload`, `parseLogsPayload` (Task 2); `createAdminClient()` from `@/lib/supabase-admin` (기존: `SUPABASE_SERVICE_ROLE_KEY` 없으면 throw)
- Produces:
  - `verifyIngestToken(authorization: string | null, expected: string | undefined): boolean`
  - `storeMetrics(admin, parsed: ReturnType<typeof parseMetricsPayload>): Promise<{ rows: number }>`
  - `storeLogs(admin, parsed: ReturnType<typeof parseLogsPayload>): Promise<{ rows: number }>`
  - `logIngest(admin, entry: { signal: "metrics" | "logs"; org_ids: string[]; rows: number; dropped: number; bytes: number; ok: boolean; error?: string }): Promise<void>`
- HTTP 계약: `POST /api/otel/v1/metrics|logs`, 헤더 `Authorization: Bearer <CLAUDE_OTEL_INGEST_TOKEN>`, `Content-Type: application/json`. 성공 `200 {}`(OTLP 응답 규격). 401 토큰 불일치·미설정, 415 JSON 아님, 400 JSON 파싱 실패, 500 DB 오류(exporter가 재시도).

- [ ] **Step 1: 인증 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-usage-ingest-auth.test.ts
import { describe, it, expect } from "vitest";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";

describe("verifyIngestToken", () => {
  it("Bearer 토큰이 기대값과 같을 때만 true", () => {
    expect(verifyIngestToken("Bearer abc123", "abc123")).toBe(true);
    expect(verifyIngestToken("bearer abc123", "abc123")).toBe(true);
    expect(verifyIngestToken("Bearer abc124", "abc123")).toBe(false);
    expect(verifyIngestToken("Bearer abc12", "abc123")).toBe(false);
    expect(verifyIngestToken("abc123", "abc123")).toBe(false);
    expect(verifyIngestToken(null, "abc123")).toBe(false);
  });
  it("서버에 토큰이 설정되지 않았거나 8자 미만이면 항상 false", () => {
    expect(verifyIngestToken("Bearer x", undefined)).toBe(false);
    expect(verifyIngestToken("Bearer short", "short")).toBe(false);
  });
});
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-usage-ingest-auth.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 인증 구현**

```ts
// frontend/src/lib/claude-usage/ingest-auth.ts
import { timingSafeEqual } from "node:crypto";

/** `Authorization: Bearer <token>`을 상수시간 비교. 서버 토큰이 없거나 너무 짧으면 무조건 거부. */
export function verifyIngestToken(authorization: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 8) return false;
  if (!authorization) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m) return false;
  const given = Buffer.from(m[1].trim(), "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
```

- [ ] **Step 4: 실행 → 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-usage-ingest-auth.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 저장 계층 구현** (DB I/O — 단위 테스트 없음, Task 8 배포 후 curl 스모크로 검증)

```ts
// frontend/src/lib/claude-usage/ingest-store.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { parseLogsPayload, parseMetricsPayload } from "@/lib/claude-usage/otlp";

type MetricsParsed = ReturnType<typeof parseMetricsPayload>;
type LogsParsed = ReturnType<typeof parseLogsPayload>;

/** 메트릭 → RPC claude_code_ingest (delta 합산). 행 0개면 호출하지 않음. */
export async function storeMetrics(admin: SupabaseClient, parsed: MetricsParsed): Promise<{ rows: number }> {
  if (parsed.daily.length === 0 && parsed.model.length === 0) return { rows: 0 };
  const { error } = await admin.rpc("claude_code_ingest", { p_daily: parsed.daily, p_model: parsed.model });
  if (error) throw new Error(`claude_code_ingest: ${error.message}`);
  return { rows: parsed.daily.length + parsed.model.length };
}

/** 로그 → api_request 이벤트 insert + user_prompt 카운트 RPC */
export async function storeLogs(admin: SupabaseClient, parsed: LogsParsed): Promise<{ rows: number }> {
  let rows = 0;
  if (parsed.requests.length > 0) {
    for (let i = 0; i < parsed.requests.length; i += 500) {
      const chunk = parsed.requests.slice(i, i + 500);
      const { error } = await admin.from("claude_code_requests").insert(chunk);
      if (error) throw new Error(`claude_code_requests insert: ${error.message}`);
      rows += chunk.length;
    }
  }
  if (parsed.promptDaily.length > 0) {
    const { error } = await admin.rpc("claude_code_ingest", { p_daily: parsed.promptDaily, p_model: [] });
    if (error) throw new Error(`claude_code_ingest(prompts): ${error.message}`);
    rows += parsed.promptDaily.length;
  }
  return { rows };
}

export async function logIngest(
  admin: SupabaseClient,
  entry: { signal: "metrics" | "logs"; org_ids: string[]; rows: number; dropped: number; bytes: number; ok: boolean; error?: string }
): Promise<void> {
  const { error } = await admin.from("claude_ingest_log").insert({
    signal: entry.signal,
    org_ids: [...new Set(entry.org_ids)],
    rows: entry.rows,
    dropped: entry.dropped,
    bytes: entry.bytes,
    ok: entry.ok,
    error: entry.error ? entry.error.slice(0, 500) : null,
  });
  if (error) console.error("[claude-usage] ingest log failed:", error.message);
}
```

- [ ] **Step 6: 수신 라우트 2개 구현**

```ts
// frontend/src/app/api/otel/v1/metrics/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { parseMetricsPayload } from "@/lib/claude-usage/otlp";
import { logIngest, storeMetrics } from "@/lib/claude-usage/ingest-store";

export const runtime = "nodejs";

/** OTLP/HTTP JSON 메트릭 수신 — Claude Code 관리형 설정의 OTEL_EXPORTER_OTLP_ENDPOINT + /v1/metrics */
export async function POST(req: Request) {
  if (!verifyIngestToken(req.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "use OTEL_EXPORTER_OTLP_PROTOCOL=http/json" }, { status: 415 });
  }
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parseMetricsPayload(body);
  const orgIds = parsed.daily.map((d) => d.org_id);
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[claude-usage] admin client:", e);
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  try {
    const { rows } = await storeMetrics(admin, parsed);
    await logIngest(admin, { signal: "metrics", org_ids: orgIds, rows, dropped: parsed.dropped, bytes: raw.length, ok: true });
    return NextResponse.json({});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngest(admin, { signal: "metrics", org_ids: orgIds, rows: 0, dropped: parsed.dropped, bytes: raw.length, ok: false, error: msg });
    return NextResponse.json({ error: "store failed" }, { status: 500 });
  }
}
```

```ts
// frontend/src/app/api/otel/v1/logs/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { parseLogsPayload } from "@/lib/claude-usage/otlp";
import { logIngest, storeLogs } from "@/lib/claude-usage/ingest-store";

export const runtime = "nodejs";

/** OTLP/HTTP JSON 로그(이벤트) 수신 — api_request·user_prompt만 저장 */
export async function POST(req: Request) {
  if (!verifyIngestToken(req.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "use OTEL_EXPORTER_OTLP_PROTOCOL=http/json" }, { status: 415 });
  }
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parseLogsPayload(body);
  const orgIds = [...parsed.requests.map((r) => r.org_id), ...parsed.promptDaily.map((d) => d.org_id)];
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[claude-usage] admin client:", e);
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }
  try {
    const { rows } = await storeLogs(admin, parsed);
    await logIngest(admin, { signal: "logs", org_ids: orgIds, rows, dropped: parsed.dropped, bytes: raw.length, ok: true });
    return NextResponse.json({});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logIngest(admin, { signal: "logs", org_ids: orgIds, rows: 0, dropped: parsed.dropped, bytes: raw.length, ok: false, error: msg });
    return NextResponse.json({ error: "store failed" }, { status: 500 });
  }
}
```

- [ ] **Step 7: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint -- src/app/api/otel src/lib/claude-usage`
Expected: 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/claude-usage/ingest-auth.ts frontend/src/lib/claude-usage/ingest-store.ts frontend/src/app/api/otel frontend/src/lib/__tests__/claude-usage-ingest-auth.test.ts
git commit -m "feat(claude-usage): OTLP/HTTP JSON 수신 라우트(/api/otel/v1/metrics|logs) — Bearer 토큰 검증·RPC 합산 저장

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 멤버 활동 CSV 파서 (`members-csv.ts`) — TDD

**Files:**
- Create: `frontend/src/lib/claude-usage/members-csv.ts`
- Test: `frontend/src/lib/__tests__/claude-usage-members-csv.test.ts`

**Interfaces:**
- Consumes: `MemberActivityRow` from `@/types/claude-usage`
- Produces:
  - `parseCsv(text: string): string[][]` — RFC4180(따옴표·이스케이프 `""`·CRLF/LF), 선두 BOM 제거, 빈 줄 무시
  - `parseMembersCsv(text: string): { rows: MemberActivityRow[]; missing: string[] }` — 헤더 이름 기반 매핑(대소문자·공백 무시). 필수: `Email`, `Seat Tier`, `Chats`, `Code sessions`, `Cowork Sessions`. 누락 시 `rows: []`, `missing`에 누락 헤더. 이메일 소문자, 숫자는 천단위 콤마 제거, 빈 값 0, `Last Active` 빈 값 → null. 이메일 없는 행 스킵.
  - `parseMembersFilename(name: string): { orgId: string; periodStart: string; periodEnd: string } | null` — `members-analytics-<uuid>-<YYYY-MM-DD>-to-<YYYY-MM-DD>.csv`
  - `MEMBERS_CSV_COLUMNS`: 헤더 → 필드 매핑 상수(UI 안내용)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-usage-members-csv.test.ts
import { describe, it, expect } from "vitest";
import { parseCsv, parseMembersCsv, parseMembersFilename } from "@/lib/claude-usage/members-csv";

const HEADER =
  '"Name","Email","Role","Seat Tier","Last Active","Days Active","Chats","Messages","Projects Created","Projects Used","Pull Requests","Code sessions","File Edits","Cowork Sessions","Cowork Messages","Artifacts Created","Claude Code Artifacts","Cowork Artifacts","Estimated Spend (USD)"';
const ROW1 = '"홍, 길동","Dev1@Example.com","User","Premium","2026-08-24","1","6","21","0","0","0","32","0","0","0","0","0","0","0.00"';
const ROW2 = '"Kim ""K""","dev2@example.com","Owner","","","0","0","0","0","0","0","0","0","0","0","0","0","0","1,234.50"';

describe("parseCsv", () => {
  it("BOM·따옴표·이스케이프·CRLF를 처리한다", () => {
    const rows = parseCsv('﻿"a","b ""q"" c",d\r\n1,"x,y",\r\n\r\n');
    expect(rows).toEqual([["a", 'b "q" c', "d"], ["1", "x,y", ""]]);
  });
});

describe("parseMembersCsv", () => {
  it("헤더 기반으로 매핑하고 값을 정규화한다", () => {
    const r = parseMembersCsv(`﻿${HEADER}\r\n${ROW1}\r\n${ROW2}\r\n`);
    expect(r.missing).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      name: "홍, 길동", email: "dev1@example.com", role: "User", seat_tier: "Premium", last_active: "2026-08-24",
      days_active: 1, chats: 6, messages: 21, projects_created: 0, projects_used: 0, pull_requests: 0, code_sessions: 32,
      file_edits: 0, cowork_sessions: 0, cowork_messages: 0, artifacts_created: 0, claude_code_artifacts: 0, cowork_artifacts: 0,
      estimated_spend_usd: 0,
    });
    expect(r.rows[1]).toMatchObject({ name: 'Kim "K"', seat_tier: "", last_active: null, estimated_spend_usd: 1234.5 });
  });

  it("칼럼 순서가 달라도, 알 수 없는 칼럼이 있어도 동작하고 이메일 없는 행은 건너뛴다", () => {
    const text = `Email,Chats,Seat Tier,Cowork Sessions,Code sessions,Extra\ndev3@example.com,2,Standard,1,0,zzz\n,5,Premium,0,0,\n`;
    const r = parseMembersCsv(text);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ email: "dev3@example.com", chats: 2, seat_tier: "Standard", cowork_sessions: 1, code_sessions: 0, name: "" });
  });

  it("필수 칼럼이 없으면 거부한다", () => {
    const r = parseMembersCsv(`Name,Email,Chats\nA,dev@example.com,1\n`);
    expect(r.rows).toEqual([]);
    expect(r.missing).toEqual(["Seat Tier", "Code sessions", "Cowork Sessions"]);
  });
});

describe("parseMembersFilename", () => {
  it("조직 ID와 기간을 추출한다", () => {
    expect(parseMembersFilename("members-analytics-4ad6b3e9-552f-4b67-bb96-25b51d1852f4-2026-07-27-to-2026-08-25.csv")).toEqual({
      orgId: "4ad6b3e9-552f-4b67-bb96-25b51d1852f4", periodStart: "2026-07-27", periodEnd: "2026-08-25",
    });
    expect(parseMembersFilename("members-analytics-4AD6B3E9-552F-4B67-BB96-25B51D1852F4-2026-07-27-to-2026-08-25 (1).csv")?.orgId).toBe("4ad6b3e9-552f-4b67-bb96-25b51d1852f4");
    expect(parseMembersFilename("claude-code-productivity-raw.csv")).toBeNull();
  });
});
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-usage-members-csv.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/claude-usage/members-csv.ts
/** claude.ai 분석 > 멤버 "모두 보기" > CSV 내보내기(members-analytics-*.csv) 파서. 순수 함수. */
import type { MemberActivityRow } from "@/types/claude-usage";

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}

type NumericField = Exclude<keyof MemberActivityRow, "name" | "email" | "role" | "seat_tier" | "last_active">;

/** CSV 헤더 → 필드. 키는 normalize(header) 결과. */
export const MEMBERS_CSV_COLUMNS: Record<string, keyof MemberActivityRow> = {
  name: "name",
  email: "email",
  role: "role",
  "seat tier": "seat_tier",
  "last active": "last_active",
  "days active": "days_active",
  chats: "chats",
  messages: "messages",
  "projects created": "projects_created",
  "projects used": "projects_used",
  "pull requests": "pull_requests",
  "code sessions": "code_sessions",
  "file edits": "file_edits",
  "cowork sessions": "cowork_sessions",
  "cowork messages": "cowork_messages",
  "artifacts created": "artifacts_created",
  "claude code artifacts": "claude_code_artifacts",
  "cowork artifacts": "cowork_artifacts",
  "estimated spend (usd)": "estimated_spend_usd",
};

const REQUIRED_HEADERS = ["Email", "Seat Tier", "Chats", "Code sessions", "Cowork Sessions"];

const NUMERIC_FIELDS: NumericField[] = [
  "days_active", "chats", "messages", "projects_created", "projects_used", "pull_requests", "code_sessions",
  "file_edits", "cowork_sessions", "cowork_messages", "artifacts_created", "claude_code_artifacts", "cowork_artifacts",
  "estimated_spend_usd",
];

function normalize(h: string): string {
  return h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function parseMembersCsv(text: string): { rows: MemberActivityRow[]; missing: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], missing: [...REQUIRED_HEADERS] };
  const header = table[0].map(normalize);
  const index = new Map<keyof MemberActivityRow, number>();
  header.forEach((h, i) => {
    const field = MEMBERS_CSV_COLUMNS[h];
    if (field && !index.has(field)) index.set(field, i);
  });
  const missing = REQUIRED_HEADERS.filter((h) => !index.has(MEMBERS_CSV_COLUMNS[normalize(h)]));
  if (missing.length > 0) return { rows: [], missing };

  const cell = (r: string[], f: keyof MemberActivityRow): string | undefined => {
    const i = index.get(f);
    return i === undefined ? undefined : r[i]?.trim();
  };

  const rows: MemberActivityRow[] = [];
  for (const r of table.slice(1)) {
    const email = cell(r, "email")?.toLowerCase();
    if (!email) continue;
    const row: MemberActivityRow = {
      name: cell(r, "name") ?? "",
      email,
      role: cell(r, "role") ?? "",
      seat_tier: cell(r, "seat_tier") ?? "",
      last_active: cell(r, "last_active") || null,
      days_active: 0, chats: 0, messages: 0, projects_created: 0, projects_used: 0, pull_requests: 0, code_sessions: 0,
      file_edits: 0, cowork_sessions: 0, cowork_messages: 0, artifacts_created: 0, claude_code_artifacts: 0,
      cowork_artifacts: 0, estimated_spend_usd: 0,
    };
    for (const f of NUMERIC_FIELDS) row[f] = toNumber(cell(r, f));
    rows.push(row);
  }
  return { rows, missing: [] };
}

const FILENAME_RE = /members-analytics-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})/i;

export function parseMembersFilename(name: string): { orgId: string; periodStart: string; periodEnd: string } | null {
  const m = FILENAME_RE.exec(name);
  if (!m) return null;
  return { orgId: m[1].toLowerCase(), periodStart: m[2], periodEnd: m[3] };
}
```

- [ ] **Step 4: 실행 → 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-usage-members-csv.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/claude-usage/members-csv.ts frontend/src/lib/__tests__/claude-usage-members-csv.test.ts
git commit -m "feat(claude-usage): members-analytics CSV 파서 — RFC4180·헤더 매핑·파일명에서 조직/기간 추출

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 요약 집계(`aggregate.ts`) + 관리형 설정 생성(`managed-settings.ts`) — TDD

**Files:**
- Create: `frontend/src/lib/claude-usage/aggregate.ts`
- Create: `frontend/src/lib/claude-usage/managed-settings.ts`
- Test: `frontend/src/lib/__tests__/claude-usage-aggregate.test.ts`
- Test: `frontend/src/lib/__tests__/claude-usage-managed-settings.test.ts`

**Interfaces:**
- Consumes: `DailyRow`, `ModelRow`, `ClaudeOrg`, `MemberActivityRow`, `UsageSummary`, `UserUsageRow`, `DAILY_NUMERIC_FIELDS`, `emptyDailyMetrics`
- Produces:
  - `summarize(input: { rows: DailyRow[]; models: ModelRow[]; orgs: ClaudeOrg[]; members: Pick<MemberActivityRow, "email" | "name" | "seat_tier">[]; from: string; to: string }): UsageSummary` — 사용자(이메일)별 합산(조직 여러 개면 `orgs`에 모두), `active_days` = sessions>0 또는 prompts>0 또는 cost_usd>0인 날 수, 일별 시리즈(비용·세션·활성 사용자 수, 기간 내 빈 날은 0으로 채움), 모델별 합산(비용 내림차순), `name`/`seat_tier`는 members에서 이메일로 조인(없으면 null), users는 cost_usd 내림차순
  - `acceptRate(accepted: number, rejected: number): number | null` — 분모 0이면 null, 아니면 0~100 정수 반올림
  - `isIdleSeat(m: MemberActivityRow): boolean` — seat_tier가 비어 있지 않고 chats+code_sessions+cowork_sessions === 0
  - `dateRangePreset(preset: "7d" | "30d" | "90d" | "thisMonth" | "lastMonth", today: Date): { from: string; to: string }` — KST 기준 YYYY-MM-DD
  - `buildManagedSettings(endpointBase: string, token = "<CLAUDE_OTEL_INGEST_TOKEN>"): { env: Record<string, string> }`

- [ ] **Step 1: 집계 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-usage-aggregate.test.ts
import { describe, it, expect } from "vitest";
import { summarize, acceptRate, isIdleSeat, dateRangePreset } from "@/lib/claude-usage/aggregate";
import { emptyDailyMetrics, type DailyRow, type ModelRow } from "@/types/claude-usage";

const row = (p: Partial<DailyRow> & Pick<DailyRow, "day" | "org_id" | "user_email">): DailyRow => ({
  ...emptyDailyMetrics(), account_uuid: null, ...p,
});

describe("summarize", () => {
  const rows = [
    row({ day: "2026-08-24", org_id: "org-a", user_email: "dev1@example.com", sessions: 2, cost_usd: 1.5, input_tokens: 100, edits_accepted: 9, edits_rejected: 1 }),
    row({ day: "2026-08-25", org_id: "org-b", user_email: "dev1@example.com", sessions: 1, cost_usd: 0.5, commits: 1 }),
    row({ day: "2026-08-25", org_id: "org-a", user_email: "dev2@example.com", prompts: 3, cost_usd: 0 }),
    row({ day: "2026-08-25", org_id: "org-a", user_email: "dev3@example.com" }), // 활동 없음 → active 아님
  ];
  const models: ModelRow[] = [
    { day: "2026-08-24", org_id: "org-a", user_email: "dev1@example.com", model: "claude-opus-5", cost_usd: 1.5, input_tokens: 100, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
    { day: "2026-08-25", org_id: "org-b", user_email: "dev1@example.com", model: "claude-sonnet-5", cost_usd: 0.5, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
  ];
  const orgs = [{ id: "org-a", name: "A", seats_total: 10, sort_order: 0 }, { id: "org-b", name: "B", seats_total: null, sort_order: 1 }];
  const members = [{ email: "dev1@example.com", name: "개발1", seat_tier: "Premium" }];

  it("사용자별 합산·조직 목록·활성일·이름 조인·정렬", () => {
    const s = summarize({ rows, models, orgs, members, from: "2026-08-23", to: "2026-08-25" });
    expect(s.users.map((u) => u.user_email)).toEqual(["dev1@example.com", "dev2@example.com", "dev3@example.com"]);
    expect(s.users[0]).toMatchObject({ orgs: ["org-a", "org-b"], sessions: 3, cost_usd: 2, active_days: 2, name: "개발1", seat_tier: "Premium", commits: 1 });
    expect(s.users[1]).toMatchObject({ active_days: 1, name: null, seat_tier: null });
    expect(s.users[2].active_days).toBe(0);
  });

  it("합계·일별 시리즈(빈 날 0)·모델별", () => {
    const s = summarize({ rows, models, orgs, members, from: "2026-08-23", to: "2026-08-25" });
    expect(s.totals).toMatchObject({ cost_usd: 2, sessions: 3, prompts: 3, active_users: 2 });
    expect(s.daily).toEqual([
      { day: "2026-08-23", cost_usd: 0, sessions: 0, active_users: 0 },
      { day: "2026-08-24", cost_usd: 1.5, sessions: 2, active_users: 1 },
      { day: "2026-08-25", cost_usd: 0.5, sessions: 1, active_users: 2 },
    ]);
    expect(s.models.map((m) => m.model)).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect(s.orgs).toEqual(orgs);
    expect(s.range).toEqual({ from: "2026-08-23", to: "2026-08-25" });
  });
});

describe("acceptRate / isIdleSeat", () => {
  it("수락률과 노는 시트", () => {
    expect(acceptRate(9, 1)).toBe(90);
    expect(acceptRate(0, 0)).toBeNull();
    const base = { name: "", email: "x@example.com", role: "User", last_active: null, days_active: 0, messages: 0, projects_created: 0, projects_used: 0, pull_requests: 0, file_edits: 0, cowork_messages: 0, artifacts_created: 0, claude_code_artifacts: 0, cowork_artifacts: 0, estimated_spend_usd: 0 };
    expect(isIdleSeat({ ...base, seat_tier: "Premium", chats: 0, code_sessions: 0, cowork_sessions: 0 })).toBe(true);
    expect(isIdleSeat({ ...base, seat_tier: "Premium", chats: 0, code_sessions: 1, cowork_sessions: 0 })).toBe(false);
    expect(isIdleSeat({ ...base, seat_tier: "", chats: 0, code_sessions: 0, cowork_sessions: 0 })).toBe(false);
  });
});

describe("dateRangePreset", () => {
  // 2026-08-26 10:00 KST = 2026-08-26T01:00:00Z
  const today = new Date("2026-08-26T01:00:00Z");
  it("KST 기준 프리셋", () => {
    expect(dateRangePreset("7d", today)).toEqual({ from: "2026-08-20", to: "2026-08-26" });
    expect(dateRangePreset("30d", today)).toEqual({ from: "2026-07-28", to: "2026-08-26" });
    expect(dateRangePreset("thisMonth", today)).toEqual({ from: "2026-08-01", to: "2026-08-26" });
    expect(dateRangePreset("lastMonth", today)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
});
```

- [ ] **Step 2: 관리형 설정 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-usage-managed-settings.test.ts
import { describe, it, expect } from "vitest";
import { buildManagedSettings } from "@/lib/claude-usage/managed-settings";

describe("buildManagedSettings", () => {
  it("엔드포인트 끝 슬래시를 정리하고 http/json·delta 기본값을 넣는다", () => {
    const s = buildManagedSettings("https://inje-playground.vercel.app/", "tok");
    expect(s.env).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://inje-playground.vercel.app/api/otel",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer tok",
      OTEL_METRICS_INCLUDE_SESSION_ID: "false",
      OTEL_METRICS_INCLUDE_ACCOUNT_UUID: "true",
    });
  });
  it("토큰 생략 시 자리표시자", () => {
    expect(buildManagedSettings("https://x.test").env.OTEL_EXPORTER_OTLP_HEADERS).toBe("Authorization=Bearer <CLAUDE_OTEL_INGEST_TOKEN>");
  });
});
```

- [ ] **Step 3: 실행 → 두 파일 모두 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-usage-aggregate.test.ts src/lib/__tests__/claude-usage-managed-settings.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 4: 집계 구현**

```ts
// frontend/src/lib/claude-usage/aggregate.ts
/** 일별 행 → 대시보드 요약. 순수 함수. */
import {
  DAILY_NUMERIC_FIELDS,
  emptyDailyMetrics,
  type ClaudeOrg,
  type DailyRow,
  type MemberActivityRow,
  type ModelRow,
  type UsageSummary,
  type UserUsageRow,
} from "@/types/claude-usage";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDate(d: Date): { y: number; m: number; d: number } {
  const t = new Date(d.getTime() + KST_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function addDays(day: string, n: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export type RangePreset = "7d" | "30d" | "90d" | "thisMonth" | "lastMonth";

export function dateRangePreset(preset: RangePreset, today: Date = new Date()): { from: string; to: string } {
  const { y, m, d } = kstDate(today);
  const to = ymd(y, m, d);
  switch (preset) {
    case "7d":
      return { from: addDays(to, -6), to };
    case "30d":
      return { from: addDays(to, -29), to };
    case "90d":
      return { from: addDays(to, -89), to };
    case "thisMonth":
      return { from: ymd(y, m, 1), to };
    case "lastMonth": {
      const first = new Date(Date.UTC(y, m - 1, 1));
      first.setUTCMonth(first.getUTCMonth() - 1);
      const from = first.toISOString().slice(0, 10);
      return { from, to: addDays(ymd(y, m, 1), -1) };
    }
  }
}

export function acceptRate(accepted: number, rejected: number): number | null {
  const total = accepted + rejected;
  if (total <= 0) return null;
  return Math.round((accepted / total) * 100);
}

export function isIdleSeat(m: MemberActivityRow): boolean {
  if (!m.seat_tier.trim()) return false;
  return m.chats + m.code_sessions + m.cowork_sessions === 0;
}

function isActive(r: DailyRow): boolean {
  return r.sessions > 0 || r.prompts > 0 || r.cost_usd > 0;
}

export function summarize(input: {
  rows: DailyRow[];
  models: ModelRow[];
  orgs: ClaudeOrg[];
  members: Pick<MemberActivityRow, "email" | "name" | "seat_tier">[];
  from: string;
  to: string;
}): UsageSummary {
  const memberByEmail = new Map(input.members.map((m) => [m.email.toLowerCase(), m]));

  const users = new Map<string, UserUsageRow & { _days: Set<string>; _orgs: Set<string> }>();
  const totals = { ...emptyDailyMetrics(), active_users: 0 };
  const dailyMap = new Map<string, { cost_usd: number; sessions: number; users: Set<string> }>();
  const activeEmails = new Set<string>();

  for (const r of input.rows) {
    let u = users.get(r.user_email);
    if (!u) {
      const m = memberByEmail.get(r.user_email);
      u = { ...emptyDailyMetrics(), user_email: r.user_email, orgs: [], active_days: 0, name: m?.name ?? null, seat_tier: m?.seat_tier ?? null, _days: new Set(), _orgs: new Set() };
      users.set(r.user_email, u);
    }
    u._orgs.add(r.org_id);
    for (const f of DAILY_NUMERIC_FIELDS) {
      u[f] += r[f];
      totals[f] += r[f];
    }
    const d = dailyMap.get(r.day) ?? { cost_usd: 0, sessions: 0, users: new Set<string>() };
    d.cost_usd += r.cost_usd;
    d.sessions += r.sessions;
    if (isActive(r)) {
      u._days.add(r.day);
      d.users.add(r.user_email);
      activeEmails.add(r.user_email);
    }
    dailyMap.set(r.day, d);
  }
  totals.active_users = activeEmails.size;

  const userRows: UserUsageRow[] = [...users.values()]
    .map(({ _days, _orgs, ...u }) => ({ ...u, orgs: [..._orgs].sort(), active_days: _days.size }))
    .sort((a, b) => b.cost_usd - a.cost_usd || b.sessions - a.sessions || a.user_email.localeCompare(b.user_email));

  const daily: UsageSummary["daily"] = [];
  for (let day = input.from; day <= input.to; day = addDays(day, 1)) {
    const d = dailyMap.get(day);
    daily.push({ day, cost_usd: d?.cost_usd ?? 0, sessions: d?.sessions ?? 0, active_users: d?.users.size ?? 0 });
  }

  const modelMap = new Map<string, UsageSummary["models"][number]>();
  for (const m of input.models) {
    const e = modelMap.get(m.model) ?? { model: m.model, cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
    e.cost_usd += m.cost_usd;
    e.input_tokens += m.input_tokens;
    e.output_tokens += m.output_tokens;
    e.cache_read_tokens += m.cache_read_tokens;
    e.cache_creation_tokens += m.cache_creation_tokens;
    modelMap.set(m.model, e);
  }
  const models = [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd);

  return { range: { from: input.from, to: input.to }, orgs: input.orgs, totals, users: userRows, daily, models };
}
```

- [ ] **Step 5: 관리형 설정 구현**

```ts
// frontend/src/lib/claude-usage/managed-settings.ts
/** claude.ai Admin Settings > Claude Code > Managed settings 에 붙일 env 블록 */
export function buildManagedSettings(endpointBase: string, token = "<CLAUDE_OTEL_INGEST_TOKEN>"): { env: Record<string, string> } {
  const base = endpointBase.replace(/\/+$/, "");
  return {
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_ENDPOINT: `${base}/api/otel`,
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
      OTEL_METRICS_INCLUDE_SESSION_ID: "false",
      OTEL_METRICS_INCLUDE_ACCOUNT_UUID: "true",
    },
  };
}
```

- [ ] **Step 6: 실행 → 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-usage-aggregate.test.ts src/lib/__tests__/claude-usage-managed-settings.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/lib/claude-usage/aggregate.ts frontend/src/lib/claude-usage/managed-settings.ts frontend/src/lib/__tests__/claude-usage-aggregate.test.ts frontend/src/lib/__tests__/claude-usage-managed-settings.test.ts
git commit -m "feat(claude-usage): 사용자/일별/모델 요약 집계·노는 시트 판정·관리형 설정 JSON 생성

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 관리자 API (`/api/admin/claude-usage/*`)

**Files:**
- Create: `frontend/src/lib/claude-usage/require-admin.ts`
- Create: `frontend/src/app/api/admin/claude-usage/summary/route.ts`
- Create: `frontend/src/app/api/admin/claude-usage/members/route.ts`
- Create: `frontend/src/app/api/admin/claude-usage/imports/route.ts`
- Create: `frontend/src/app/api/admin/claude-usage/imports/[id]/route.ts`
- Create: `frontend/src/app/api/admin/claude-usage/orgs/route.ts`
- Create: `frontend/src/app/api/admin/claude-usage/health/route.ts`

**Interfaces:**
- Consumes: `summarize`, `dateRangePreset` (Task 5); `parseMembersCsv`, `parseMembersFilename` (Task 4); `createServerSupabase` (`@/lib/supabase-server`), `createAdminClient` (`@/lib/supabase-admin`); 타입(Task 1)
- Produces(HTTP, 모두 admin 전용 401/403):
  - `GET /api/admin/claude-usage/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&org=<id|all>` → `UsageSummary`
  - `GET /api/admin/claude-usage/members?org=<id|all>&importId=<uuid|latest>` → `{ imports: CsvImport[]; rows: (MemberActivityRow & { org_id: string; import_id: string })[] }` (`latest` = 조직별 period_end 최신 import)
  - `GET /api/admin/claude-usage/imports` → `{ imports: CsvImport[] }`; `POST` multipart `files`(여러 개), 옵션 `orgId`,`periodStart`,`periodEnd`(파일 1개일 때만 파일명 대체) → `{ results: { filename: string; ok: boolean; org_id?: string; period_start?: string; period_end?: string; row_count?: number; error?: string }[] }`
  - `DELETE /api/admin/claude-usage/imports/[id]` → `{ success: true }`
  - `GET /api/admin/claude-usage/orgs` → `{ orgs: ClaudeOrg[] }`; `PATCH` body `{ id: string; name?: string; seats_total?: number | null; sort_order?: number }` → `{ org: ClaudeOrg }`
  - `GET /api/admin/claude-usage/health` → `{ tokenConfigured: boolean; serviceKeyConfigured: boolean; lastReceivedAt: string | null; count24h: number; errors24h: number; lastError: string | null; orgLastDay: { org_id: string; last_day: string }[] }`
- 규칙: `requireAdmin()`으로 세션 확인 → 이후 service role로 읽기/쓰기. 날짜 파라미터는 `isYmd` 검증, 없으면 `dateRangePreset("30d")`. `from > to`면 400. 기간 최대 366일. `createAdminClient()`가 throw(서비스 키 미설정)하면 500 `"SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다."`.

- [ ] **Step 1: 공통 가드**

```ts
// frontend/src/lib/claude-usage/require-admin.ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 세션 사용자가 admin인지 확인. 기존 /api/admin/* 라우트와 같은 401/403 메시지. */
export async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  const { data: caller } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  if (caller?.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }) };
  }
  return { ok: true, userId: user.id };
}

/** service role 클라이언트 또는 500 응답 */
export function adminClientOr500(): { ok: true; admin: SupabaseClient } | { ok: false; response: NextResponse } {
  try {
    return { ok: true, admin: createAdminClient() };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다." }, { status: 500 }) };
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isYmd(s: string | null | undefined): s is string {
  return !!s && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** PostgREST numeric → 문자열로 올 수 있어 숫자화(식별자 칼럼 제외) */
const ID_KEYS = new Set(["day", "org_id", "user_email", "account_uuid", "model", "id", "import_id", "email", "name", "role", "seat_tier", "last_active", "period_start", "period_end", "filename", "created_at"]);
export function numify<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = !ID_KEYS.has(k) && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return out as T;
}
```

- [ ] **Step 2: summary 라우트**

```ts
// frontend/src/app/api/admin/claude-usage/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd, numify } from "@/lib/claude-usage/require-admin";
import { dateRangePreset, summarize } from "@/lib/claude-usage/aggregate";
import type { ClaudeOrg, DailyRow, ModelRow } from "@/types/claude-usage";

const MAX_DAYS = 366;

/** GET /api/admin/claude-usage/summary?from&to&org — Claude Code(OTel) 요약 */
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
  if (from > to) return NextResponse.json({ error: "from이 to보다 늦습니다." }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) {
    return NextResponse.json({ error: `기간은 최대 ${MAX_DAYS}일입니다.` }, { status: 400 });
  }
  const org = sp.get("org");

  let dailyQ = admin.from("claude_code_daily").select("*").gte("day", from).lte("day", to);
  let modelQ = admin.from("claude_code_daily_model").select("*").gte("day", from).lte("day", to);
  if (org && org !== "all") {
    dailyQ = dailyQ.eq("org_id", org);
    modelQ = modelQ.eq("org_id", org);
  }
  const [daily, models, orgs, imports] = await Promise.all([
    dailyQ,
    modelQ,
    admin.from("claude_orgs").select("id, name, seats_total, sort_order").order("sort_order").order("name"),
    admin.from("claude_csv_imports").select("id, org_id, period_end").order("period_end", { ascending: false }),
  ]);
  const err = daily.error ?? models.error ?? orgs.error ?? imports.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  // 조직별 최신 import 1개씩 → 이름/티어 조인용
  const latestByOrg = new Map<string, string>();
  for (const i of imports.data ?? []) if (!latestByOrg.has(i.org_id)) latestByOrg.set(i.org_id, i.id);
  const importIds = [...latestByOrg.values()];
  const members = importIds.length
    ? await admin.from("claude_member_activity").select("email, name, seat_tier").in("import_id", importIds)
    : { data: [] as { email: string; name: string; seat_tier: string }[], error: null };
  if (members.error) return NextResponse.json({ error: members.error.message }, { status: 500 });

  const summary = summarize({
    rows: (daily.data ?? []).map((r) => numify(r as Record<string, unknown>)) as unknown as DailyRow[],
    models: (models.data ?? []).map((r) => numify(r as Record<string, unknown>)) as unknown as ModelRow[],
    orgs: (orgs.data ?? []) as ClaudeOrg[],
    members: (members.data ?? []) as { email: string; name: string; seat_tier: string }[],
    from,
    to,
  });
  return NextResponse.json(summary);
}
```

- [ ] **Step 3: members 라우트**

```ts
// frontend/src/app/api/admin/claude-usage/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, numify } from "@/lib/claude-usage/require-admin";

/** GET /api/admin/claude-usage/members?org=all|<id>&importId=latest|<uuid> — CSV 멤버 활동 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const org = sp.get("org") ?? "all";
  const importId = sp.get("importId") ?? "latest";

  let importsQ = admin
    .from("claude_csv_imports")
    .select("id, org_id, period_start, period_end, filename, row_count, created_at")
    .order("period_end", { ascending: false })
    .order("created_at", { ascending: false });
  if (org !== "all") importsQ = importsQ.eq("org_id", org);
  const imports = await importsQ;
  if (imports.error) return NextResponse.json({ error: imports.error.message }, { status: 500 });

  let ids: string[];
  if (importId === "latest") {
    const seen = new Map<string, string>();
    for (const i of imports.data ?? []) if (!seen.has(i.org_id)) seen.set(i.org_id, i.id);
    ids = [...seen.values()];
  } else {
    ids = [importId];
  }
  const rows = ids.length
    ? await admin.from("claude_member_activity").select("*").in("import_id", ids).order("chats", { ascending: false })
    : { data: [] as Record<string, unknown>[], error: null };
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });

  return NextResponse.json({ imports: imports.data ?? [], rows: (rows.data ?? []).map((r) => numify(r as Record<string, unknown>)) });
}
```

- [ ] **Step 4: imports 라우트 (목록·업로드·삭제)**

```ts
// frontend/src/app/api/admin/claude-usage/imports/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { parseMembersCsv, parseMembersFilename } from "@/lib/claude-usage/members-csv";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { data, error } = await c.admin
    .from("claude_csv_imports")
    .select("id, org_id, period_start, period_end, filename, row_count, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imports: data ?? [] });
}

/** POST multipart: files[] (+ orgId/periodStart/periodEnd — 파일 1개일 때 파일명 대체) */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  const orgIdField = typeof form.get("orgId") === "string" ? (form.get("orgId") as string).trim().toLowerCase() : "";
  const ps = form.get("periodStart");
  const pe = form.get("periodEnd");
  const override =
    files.length === 1 && orgIdField && isYmd(typeof ps === "string" ? ps : null) && isYmd(typeof pe === "string" ? pe : null)
      ? { orgId: orgIdField, periodStart: ps as string, periodEnd: pe as string }
      : null;

  const results: { filename: string; ok: boolean; org_id?: string; period_start?: string; period_end?: string; row_count?: number; error?: string }[] = [];

  for (const file of files) {
    const filename = file.name;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("5MB를 초과합니다.");
      const meta = parseMembersFilename(filename) ?? override;
      if (!meta) throw new Error("파일명에서 조직/기간을 읽을 수 없습니다. members-analytics-<조직ID>-<시작>-to-<끝>.csv 형식이거나 조직·기간을 직접 지정하세요.");
      if (meta.periodStart > meta.periodEnd) throw new Error("기간 시작이 끝보다 늦습니다.");
      const { rows, missing } = parseMembersCsv(await file.text());
      if (missing.length > 0) throw new Error(`필수 칼럼 누락: ${missing.join(", ")}`);
      if (rows.length === 0) throw new Error("데이터 행이 없습니다.");

      const orgUp = await admin.from("claude_orgs").upsert({ id: meta.orgId, name: meta.orgId.slice(0, 8) }, { onConflict: "id", ignoreDuplicates: true });
      if (orgUp.error) throw new Error(orgUp.error.message);

      const del = await admin.from("claude_csv_imports").delete().eq("org_id", meta.orgId).eq("period_start", meta.periodStart).eq("period_end", meta.periodEnd);
      if (del.error) throw new Error(del.error.message);

      const ins = await admin
        .from("claude_csv_imports")
        .insert({ org_id: meta.orgId, period_start: meta.periodStart, period_end: meta.periodEnd, filename, uploaded_by: auth.userId, row_count: rows.length })
        .select("id")
        .single();
      if (ins.error) throw new Error(ins.error.message);

      const byEmail = new Map(rows.map((r) => [r.email, r])); // 같은 이메일 중복 시 마지막 행
      const payload = [...byEmail.values()].map((r) => ({ ...r, import_id: ins.data.id, org_id: meta.orgId, period_start: meta.periodStart, period_end: meta.periodEnd }));
      for (let i = 0; i < payload.length; i += 500) {
        const chunk = await admin.from("claude_member_activity").insert(payload.slice(i, i + 500));
        if (chunk.error) throw new Error(chunk.error.message);
      }
      results.push({ filename, ok: true, org_id: meta.orgId, period_start: meta.periodStart, period_end: meta.periodEnd, row_count: payload.length });
    } catch (e) {
      results.push({ filename, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ results });
}
```

```ts
// frontend/src/app/api/admin/claude-usage/imports/[id]/route.ts
import { NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { error } = await c.admin.from("claude_csv_imports").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: orgs·health 라우트**

```ts
// frontend/src/app/api/admin/claude-usage/orgs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { data, error } = await c.admin.from("claude_orgs").select("id, name, seats_total, sort_order").order("sort_order").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orgs: data ?? [] });
}

/** PATCH { id, name?, seats_total?, sort_order? } */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { id?: unknown; name?: unknown; seats_total?: unknown; sort_order?: unknown } | null;
  if (!body || typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (body.seats_total === null || (typeof body.seats_total === "number" && Number.isInteger(body.seats_total) && body.seats_total >= 0)) patch.seats_total = body.seats_total;
  if (typeof body.sort_order === "number" && Number.isInteger(body.sort_order)) patch.sort_order = body.sort_order;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "변경할 값이 없습니다." }, { status: 400 });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { data, error } = await c.admin.from("claude_orgs").update(patch).eq("id", body.id).select("id, name, seats_total, sort_order").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ org: data });
}
```

```ts
// frontend/src/app/api/admin/claude-usage/health/route.ts
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
  const [last, recent, lastErr, lastDays] = await Promise.all([
    admin.from("claude_ingest_log").select("received_at").order("received_at", { ascending: false }).limit(1),
    admin.from("claude_ingest_log").select("ok").gte("received_at", since),
    admin.from("claude_ingest_log").select("error, received_at").eq("ok", false).order("received_at", { ascending: false }).limit(1),
    admin.from("claude_code_daily").select("org_id, day").order("day", { ascending: false }).limit(2000),
  ]);
  const err = last.error ?? recent.error ?? lastErr.error ?? lastDays.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });
  const orgLastDay = new Map<string, string>();
  for (const r of lastDays.data ?? []) if (!orgLastDay.has(r.org_id)) orgLastDay.set(r.org_id, r.day);
  return NextResponse.json({
    ...empty,
    lastReceivedAt: last.data?.[0]?.received_at ?? null,
    count24h: recent.data?.length ?? 0,
    errors24h: (recent.data ?? []).filter((r) => !r.ok).length,
    lastError: lastErr.data?.[0] ? `${lastErr.data[0].received_at} ${lastErr.data[0].error ?? ""}` : null,
    orgLastDay: [...orgLastDay].map(([org_id, last_day]) => ({ org_id, last_day })),
  });
}
```

- [ ] **Step 6: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint -- src/app/api/admin/claude-usage src/lib/claude-usage`
Expected: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/lib/claude-usage/require-admin.ts frontend/src/app/api/admin/claude-usage
git commit -m "feat(claude-usage): 관리자 API — 요약·멤버 활동·CSV 업로드/삭제·조직 편집·수집 상태

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 관리자 화면 `/admin/claude-usage` (탭 3개) + 네비

**Files:**
- Create: `frontend/src/app/admin/claude-usage/page.tsx`
- Create: `frontend/src/components/admin/claude-usage/SortableTable.tsx`
- Create: `frontend/src/components/admin/claude-usage/DailyBars.tsx`
- Create: `frontend/src/components/admin/claude-usage/CodeUsageTab.tsx`
- Create: `frontend/src/components/admin/claude-usage/MembersCsvTab.tsx`
- Create: `frontend/src/components/admin/claude-usage/OrgSettingsTab.tsx`
- Modify: `frontend/src/app/admin/layout.tsx:11-15` (네비 배열에 항목 추가)

**Interfaces:**
- Consumes: Task 6 API 계약, `UsageSummary`/`UserUsageRow`/`MemberActivityRow`/`CsvImport`/`ClaudeOrg` 타입, `acceptRate`/`isIdleSeat`/`dateRangePreset` (Task 5, 클라이언트에서 import 가능 — 순수 함수), `buildManagedSettings` (Task 5), shadcn `Card/Tabs/Select/Input/Button/Badge`, `lucide-react` 아이콘, 기존 `HBar` (`@/components/admin/surveys/charts/HBar`)
- 규칙: 페이지는 `"use client"`. 숫자 표기는 `toLocaleString("ko-KR")`, 비용은 `$` + 소수 2자리. 로딩은 `Loader2` 스핀, 오류는 빨간 문구. 표 정렬은 헤더 클릭(기본 비용 내림차순).

- [ ] **Step 1: `SortableTable.tsx`** — 제네릭 정렬 표

```tsx
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface Column<T> {
  key: string;
  header: string;
  value: (row: T) => number | string | null;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

export default function SortableTable<T>({ rows, columns, rowKey, defaultSort, emptyText = "데이터가 없습니다.", rowClassName }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  defaultSort: { key: string; dir: "asc" | "desc" };
  emptyText?: string;
  rowClassName?: (row: T) => string;
}) {
  const [sort, setSort] = useState(defaultSort);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ko") * dir;
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                onClick={() => toggle(c.key)}
                className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}
              >
                <span className="inline-flex items-center gap-0.5">
                  {c.header}
                  {sort.key === c.key && (sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-2 py-6 text-center text-muted-foreground">{emptyText}</td>
            </tr>
          ) : (
            sorted.map((r) => (
              <tr key={rowKey(r)} className={`border-t ${rowClassName?.(r) ?? ""}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 tabular-nums ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}>
                    {c.render ? c.render(r) : (c.value(r) ?? "—")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: `DailyBars.tsx`** — 일별 막대(SVG, 의존성 없음)

```tsx
"use client";

export default function DailyBars({ data, valueKey, label, format }: {
  data: { day: string; cost_usd: number; sessions: number; active_users: number }[];
  valueKey: "cost_usd" | "sessions" | "active_users";
  label: string;
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  const w = 720;
  const h = 140;
  const pad = 4;
  const bw = data.length ? (w - pad * 2) / data.length : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>최대 {format(max)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h + 16}`} className="w-full h-40" role="img" aria-label={label}>
        {data.map((d, i) => {
          const v = d[valueKey];
          const bh = (v / max) * h;
          return (
            <g key={d.day}>
              <rect x={pad + i * bw + 1} y={h - bh} width={Math.max(1, bw - 2)} height={bh} className="fill-primary/80">
                <title>{`${d.day}: ${format(v)}`}</title>
              </rect>
              {(i === 0 || i === data.length - 1 || data.length <= 14 || i % Math.ceil(data.length / 8) === 0) && (
                <text x={pad + i * bw + bw / 2} y={h + 12} textAnchor="middle" className="fill-muted-foreground" fontSize="9">
                  {d.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: `CodeUsageTab.tsx`** — 필터·KPI·차트·사용자 표·모델별

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Download } from "lucide-react";
import HBar from "@/components/admin/surveys/charts/HBar";
import SortableTable, { type Column } from "./SortableTable";
import DailyBars from "./DailyBars";
import { acceptRate, dateRangePreset, type RangePreset } from "@/lib/claude-usage/aggregate";
import type { UsageSummary, UserUsageRow } from "@/types/claude-usage";

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "7일" }, { key: "30d", label: "30일" }, { key: "90d", label: "90일" },
  { key: "thisMonth", label: "이번 달" }, { key: "lastMonth", label: "지난 달" },
];
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (v: number) => Math.round(v).toLocaleString("ko-KR");
const hours = (sec: number) => `${(sec / 3600).toFixed(1)}h`;

export default function CodeUsageTab() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [range, setRange] = useState(() => dateRangePreset("30d"));
  const [org, setOrg] = useState("all");
  const [q, setQ] = useState("");
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/claude-usage/summary?from=${range.from}&to=${range.to}&org=${encodeURIComponent(org)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as UsageSummary;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range, org]);

  const orgName = useMemo(() => new Map((data?.orgs ?? []).map((o) => [o.id, o.name])), [data]);
  const users = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => !s || u.user_email.includes(s) || (u.name ?? "").toLowerCase().includes(s));
  }, [data, q]);

  const columns: Column<UserUsageRow>[] = [
    { key: "user", header: "사용자", value: (u) => u.user_email, render: (u) => (
      <div><div className="font-medium">{u.name ?? u.user_email}</div>{u.name && <div className="text-muted-foreground">{u.user_email}</div>}</div>) },
    { key: "orgs", header: "조직", value: (u) => u.orgs.join(","), render: (u) => (
      <div className="flex flex-wrap gap-1">{u.orgs.map((o) => <Badge key={o} variant="outline" className="text-[10px]">{orgName.get(o) ?? o.slice(0, 8)}</Badge>)}</div>) },
    { key: "seat", header: "시트", value: (u) => u.seat_tier ?? "" },
    { key: "cost", header: "비용", align: "right", value: (u) => u.cost_usd, render: (u) => usd(u.cost_usd) },
    { key: "sessions", header: "세션", align: "right", value: (u) => u.sessions, render: (u) => int(u.sessions) },
    { key: "prompts", header: "프롬프트", align: "right", value: (u) => u.prompts, render: (u) => int(u.prompts) },
    { key: "days", header: "활성일", align: "right", value: (u) => u.active_days },
    { key: "in", header: "입력 토큰", align: "right", value: (u) => u.input_tokens, render: (u) => int(u.input_tokens) },
    { key: "out", header: "출력 토큰", align: "right", value: (u) => u.output_tokens, render: (u) => int(u.output_tokens) },
    { key: "cache", header: "캐시 읽기", align: "right", value: (u) => u.cache_read_tokens, render: (u) => int(u.cache_read_tokens) },
    { key: "loc", header: "라인 +/−", align: "right", value: (u) => u.loc_added, render: (u) => `${int(u.loc_added)} / ${int(u.loc_removed)}` },
    { key: "accept", header: "수락률", align: "right", value: (u) => acceptRate(u.edits_accepted, u.edits_rejected), render: (u) => { const r = acceptRate(u.edits_accepted, u.edits_rejected); return r === null ? "—" : `${r}%`; } },
    { key: "commits", header: "커밋", align: "right", value: (u) => u.commits, render: (u) => int(u.commits) },
    { key: "prs", header: "PR", align: "right", value: (u) => u.pull_requests, render: (u) => int(u.pull_requests) },
    { key: "active", header: "활성 시간", align: "right", value: (u) => u.active_user_seconds, render: (u) => hours(u.active_user_seconds) },
  ];

  const exportCsv = () => {
    if (!data) return;
    const head = ["email", "name", "orgs", "seat_tier", "cost_usd", "sessions", "prompts", "active_days", "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "loc_added", "loc_removed", "edits_accepted", "edits_rejected", "commits", "pull_requests", "active_user_seconds"];
    const lines = users.map((u) => [u.user_email, u.name ?? "", u.orgs.map((o) => orgName.get(o) ?? o).join("|"), u.seat_tier ?? "", u.cost_usd.toFixed(4), u.sessions, u.prompts, u.active_days, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_creation_tokens, u.loc_added, u.loc_removed, u.edits_accepted, u.edits_rejected, u.commits, u.pull_requests, Math.round(u.active_user_seconds)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `claude-code-usage-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} onClick={() => { setPreset(p.key); setRange(dateRangePreset(p.key)); }}>{p.label}</Button>
        ))}
        <span className="text-xs text-muted-foreground">{range.from} ~ {range.to}</span>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 조직</SelectItem>
            {(data?.orgs ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일/이름 검색" className="h-8 w-[200px] text-xs" />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {[
            ["비용", usd(t.cost_usd)], ["활성 사용자", int(t.active_users)], ["세션", int(t.sessions)],
            ["수락 라인", int(t.loc_added)], ["수락률", (() => { const r = acceptRate(t.edits_accepted, t.edits_rejected); return r === null ? "—" : `${r}%`; })()],
            ["커밋 / PR", `${int(t.commits)} / ${int(t.pull_requests)}`],
          ].map(([k, v]) => (
            <Card key={k}><CardContent className="p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></CardContent></Card>
          ))}
        </div>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2"><CardHeader className="pb-2"><CardTitle className="text-sm">일별 비용</CardTitle></CardHeader>
            <CardContent><DailyBars data={data.daily} valueKey="cost_usd" label="USD / 일" format={usd} /></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">모델별 비용</CardTitle></CardHeader>
            <CardContent>
              <HBar showPct={false} items={data.models.slice(0, 8).map((m) => ({ label: m.model, value: Number(m.cost_usd.toFixed(2)), pct: data.totals.cost_usd ? Math.round((m.cost_usd / data.totals.cost_usd) * 100) : 0 }))} />
            </CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">사용자별 Claude Code 사용량 ({users.length}명)</CardTitle></CardHeader>
        <CardContent>
          <SortableTable rows={users} columns={columns} rowKey={(u) => u.user_email} defaultSort={{ key: "cost", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "아직 수집된 데이터가 없습니다. 조직·설정 탭에서 관리형 설정을 적용하세요."} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: `MembersCsvTab.tsx`** — 업로드·이력·멤버 활동 표

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, Trash2 } from "lucide-react";
import SortableTable, { type Column } from "./SortableTable";
import { isIdleSeat } from "@/lib/claude-usage/aggregate";
import type { ClaudeOrg, CsvImport, MemberActivityRow } from "@/types/claude-usage";

type Row = MemberActivityRow & { org_id: string; import_id: string };
interface MembersResponse { imports: CsvImport[]; rows: Row[] }
interface UploadResult { filename: string; ok: boolean; org_id?: string; period_start?: string; period_end?: string; row_count?: number; error?: string }

export default function MembersCsvTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const [org, setOrg] = useState("all");
  const [importId, setImportId] = useState("latest");
  const [data, setData] = useState<MembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [q, setQ] = useState("");
  const [idleOnly, setIdleOnly] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/claude-usage/members?org=${encodeURIComponent(org)}&importId=${encodeURIComponent(importId)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as MembersResponse; })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [org, importId]);
  useEffect(() => { load(); }, [load]);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setResults(null);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    try {
      const r = await fetch("/api/admin/claude-usage/imports", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResults(j.results as UploadResult[]);
      setImportId("latest");
      load();
    } catch (e) {
      setResults([{ filename: "-", ok: false, error: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    const r = await fetch(`/api/admin/claude-usage/imports/${id}`, { method: "DELETE" });
    if (r.ok) { setImportId("latest"); load(); }
  };

  const orgName = useMemo(() => new Map(orgs.map((o) => [o.id, o.name])), [orgs]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => (!s || r.email.includes(s) || r.name.toLowerCase().includes(s)) && (!idleOnly || isIdleSeat(r)));
  }, [data, q, idleOnly]);
  const idleCount = useMemo(() => (data?.rows ?? []).filter(isIdleSeat).length, [data]);

  const columns: Column<Row>[] = [
    { key: "user", header: "사용자", value: (r) => r.email, render: (r) => (<div><div className="font-medium">{r.name || r.email}</div>{r.name && <div className="text-muted-foreground">{r.email}</div>}</div>) },
    { key: "org", header: "조직", value: (r) => orgName.get(r.org_id) ?? r.org_id, render: (r) => <Badge variant="outline" className="text-[10px]">{orgName.get(r.org_id) ?? r.org_id.slice(0, 8)}</Badge> },
    { key: "role", header: "역할", value: (r) => r.role },
    { key: "tier", header: "시트", value: (r) => r.seat_tier, render: (r) => r.seat_tier || <span className="text-muted-foreground">미할당</span> },
    { key: "last", header: "마지막 활동", value: (r) => r.last_active ?? "" },
    { key: "days", header: "활동일", align: "right", value: (r) => r.days_active },
    { key: "chats", header: "채팅", align: "right", value: (r) => r.chats },
    { key: "msgs", header: "메시지", align: "right", value: (r) => r.messages },
    { key: "code", header: "코드 세션", align: "right", value: (r) => r.code_sessions },
    { key: "prs", header: "PR", align: "right", value: (r) => r.pull_requests },
    { key: "cowork", header: "Cowork 세션", align: "right", value: (r) => r.cowork_sessions },
    { key: "cwmsg", header: "Cowork 메시지", align: "right", value: (r) => r.cowork_messages },
    { key: "proj", header: "프로젝트", align: "right", value: (r) => r.projects_used },
    { key: "art", header: "아티팩트", align: "right", value: (r) => r.artifacts_created },
    { key: "spend", header: "초과 지출", align: "right", value: (r) => r.estimated_spend_usd, render: (r) => `$${r.estimated_spend_usd.toFixed(2)}` },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">멤버 활동 CSV 업로드</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          <p className="text-muted-foreground">claude.ai → 분석 → 개요 → 멤버 <b>모두 보기</b> → 기간 30일 → <b>CSV 내보내기</b>. 파일명 <code>members-analytics-&lt;조직ID&gt;-&lt;시작&gt;-to-&lt;끝&gt;.csv</code>를 그대로 올리면 조직·기간을 자동 인식합니다. 여러 조직 파일을 한 번에 선택할 수 있고, 같은 조직·기간은 교체됩니다.</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 hover:bg-muted">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            파일 선택(여러 개 가능)
            <input type="file" accept=".csv,text/csv" multiple className="hidden" disabled={uploading} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {results && (
            <ul className="space-y-0.5">
              {results.map((r, i) => (
                <li key={i} className={r.ok ? "text-emerald-600" : "text-destructive"}>
                  {r.ok ? `✓ ${r.filename} → ${orgName.get(r.org_id!) ?? r.org_id} ${r.period_start}~${r.period_end}, ${r.row_count}명` : `✗ ${r.filename}: ${r.error}`}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={org} onValueChange={(v) => { setOrg(v); setImportId("latest"); }}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="조직" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 조직(최신 기간)</SelectItem>
            {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={importId} onValueChange={setImportId}>
          <SelectTrigger className="h-8 w-[260px] text-xs"><SelectValue placeholder="기간" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">조직별 최신 업로드</SelectItem>
            {(data?.imports ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{orgName.get(i.org_id) ?? i.org_id.slice(0, 8)} · {i.period_start}~{i.period_end} ({i.row_count}명)</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일/이름 검색" className="h-8 w-[200px] text-xs" />
        <Button size="sm" variant={idleOnly ? "default" : "outline"} onClick={() => setIdleOnly((v) => !v)}>노는 시트만 ({idleCount})</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">멤버 활동 ({rows.length}명) — 노는 시트는 붉게 표시</CardTitle></CardHeader>
        <CardContent>
          <SortableTable rows={rows} columns={columns} rowKey={(r) => `${r.import_id}:${r.email}`} defaultSort={{ key: "chats", dir: "desc" }} rowClassName={(r) => (isIdleSeat(r) ? "bg-destructive/5" : "")} emptyText={loading ? "불러오는 중..." : "업로드된 CSV가 없습니다."} />
        </CardContent>
      </Card>

      {(data?.imports.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">업로드 이력</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {data!.imports.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 border-b py-1 last:border-0">
                  <span>{orgName.get(i.org_id) ?? i.org_id.slice(0, 8)} · {i.period_start} ~ {i.period_end} · {i.row_count}명 · <span className="text-muted-foreground">{i.filename}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => remove(i.id)} aria-label="삭제"><Trash2 className="h-3.5 w-3.5" /></Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `OrgSettingsTab.tsx`** — 조직 편집·관리형 설정 JSON·수집 상태

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, RefreshCw } from "lucide-react";
import { buildManagedSettings } from "@/lib/claude-usage/managed-settings";
import type { ClaudeOrg } from "@/types/claude-usage";

interface Health { tokenConfigured: boolean; serviceKeyConfigured: boolean; lastReceivedAt: string | null; count24h: number; errors24h: number; lastError: string | null; orgLastDay: { org_id: string; last_day: string }[] }

export default function OrgSettingsTab({ orgs, onOrgsChange }: { orgs: ClaudeOrg[]; onOrgsChange: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [edit, setEdit] = useState<Record<string, { name: string; seats: string }>>({});
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "https://inje-playground.vercel.app";
  const json = JSON.stringify(buildManagedSettings(origin), null, 2);

  const loadHealth = () => fetch("/api/admin/claude-usage/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  useEffect(() => { loadHealth(); }, []);

  const save = async (o: ClaudeOrg) => {
    const e = edit[o.id];
    if (!e) return;
    const seats = e.seats.trim() === "" ? null : Number(e.seats);
    const r = await fetch("/api/admin/claude-usage/orgs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: o.id, name: e.name, seats_total: seats }) });
    if (r.ok) { setEdit((s) => { const n = { ...s }; delete n[o.id]; return n; }); onOrgsChange(); }
  };
  const copy = async () => { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const lastDay = new Map((health?.orgLastDay ?? []).map((x) => [x.org_id, x.last_day]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">수집 상태 <Button size="sm" variant="ghost" onClick={loadHealth}><RefreshCw className="h-3.5 w-3.5" /></Button></CardTitle></CardHeader>
        <CardContent className="text-xs space-y-1">
          {!health ? <p className="text-muted-foreground">불러오는 중...</p> : (
            <>
              <p>서비스 키: {health.serviceKeyConfigured ? "✅ 구성됨" : "❌ SUPABASE_SERVICE_ROLE_KEY 없음"} · 수집 토큰: {health.tokenConfigured ? "✅ 구성됨" : "❌ CLAUDE_OTEL_INGEST_TOKEN 없음"}</p>
              <p>최근 수신: {health.lastReceivedAt ? new Date(health.lastReceivedAt).toLocaleString("ko-KR") : "없음"} · 24시간 수신 {health.count24h}건 · 오류 {health.errors24h}건</p>
              {health.lastError && <p className="text-destructive">마지막 오류: {health.lastError}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">조직 ({orgs.length})</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-muted-foreground">조직 ID는 OTel(`organization.id`)·CSV 파일명에서 자동 등록됩니다. 표시 이름과 총 시트 수(결제 페이지 기준)를 입력하세요.</p>
          <table className="w-full text-xs">
            <thead className="bg-muted/50"><tr><th className="px-2 py-1 text-left">조직 ID</th><th className="px-2 py-1 text-left">이름</th><th className="px-2 py-1 text-right">총 시트</th><th className="px-2 py-1 text-left">마지막 데이터</th><th className="px-2 py-1"></th></tr></thead>
            <tbody>
              {orgs.map((o) => {
                const e = edit[o.id] ?? { name: o.name, seats: o.seats_total?.toString() ?? "" };
                return (
                  <tr key={o.id} className="border-t">
                    <td className="px-2 py-1 font-mono text-[10px]">{o.id}</td>
                    <td className="px-2 py-1"><Input className="h-7 text-xs" value={e.name} onChange={(ev) => setEdit((s) => ({ ...s, [o.id]: { ...e, name: ev.target.value } }))} /></td>
                    <td className="px-2 py-1"><Input className="h-7 w-20 text-right text-xs" inputMode="numeric" value={e.seats} onChange={(ev) => setEdit((s) => ({ ...s, [o.id]: { ...e, seats: ev.target.value } }))} /></td>
                    <td className="px-2 py-1">{lastDay.get(o.id) ?? "—"}</td>
                    <td className="px-2 py-1 text-right"><Button size="sm" variant="outline" disabled={!edit[o.id]} onClick={() => save(o)}>저장</Button></td>
                  </tr>
                );
              })}
              {orgs.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">아직 등록된 조직이 없습니다. 관리형 설정을 적용하거나 CSV를 업로드하면 자동 등록됩니다.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Claude Code 관리형 설정 (조직마다 1회 적용)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>claude.ai → 관리자 설정 → Claude Code → <b>관리형 설정 &gt; 관리</b> (Owner/Primary Owner)</li>
            <li>아래 JSON을 붙여 넣고 <code>&lt;CLAUDE_OTEL_INGEST_TOKEN&gt;</code>을 실제 토큰(Vercel 환경변수 값)으로 바꾼 뒤 저장</li>
            <li>구성원은 다음 Claude Code 실행 시 <b>OTEL_EXPORTER_OTLP_ENDPOINT 승인 대화상자</b>를 1회 봅니다(승인 필요). 1시간 이내 수집 상태에 반영됩니다.</li>
          </ol>
          <div className="relative">
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[11px]">{json}</pre>
            <Button size="sm" variant="outline" className="absolute right-2 top-2" onClick={copy}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: `page.tsx` + 네비**

```tsx
// frontend/src/app/admin/claude-usage/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3 } from "lucide-react";
import CodeUsageTab from "@/components/admin/claude-usage/CodeUsageTab";
import MembersCsvTab from "@/components/admin/claude-usage/MembersCsvTab";
import OrgSettingsTab from "@/components/admin/claude-usage/OrgSettingsTab";
import type { ClaudeOrg } from "@/types/claude-usage";

export default function ClaudeUsagePage() {
  const [orgs, setOrgs] = useState<ClaudeOrg[]>([]);
  const loadOrgs = useCallback(() => {
    fetch("/api/admin/claude-usage/orgs").then((r) => r.json()).then((j) => setOrgs(j.orgs ?? [])).catch(() => setOrgs([]));
  }, []);
  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><BarChart3 className="h-5 w-5" />Claude 사용량</h1>
        <p className="text-sm text-muted-foreground">Team 조직 7개의 사용자별 Claude Code 사용량(실시간, OTel)과 채팅·Cowork 활동(월간 CSV)</p>
      </div>
      <Tabs defaultValue="code">
        <TabsList>
          <TabsTrigger value="code">Claude Code</TabsTrigger>
          <TabsTrigger value="members">채팅 · Cowork (CSV)</TabsTrigger>
          <TabsTrigger value="orgs">조직 · 설정</TabsTrigger>
        </TabsList>
        <TabsContent value="code"><CodeUsageTab /></TabsContent>
        <TabsContent value="members"><MembersCsvTab orgs={orgs} /></TabsContent>
        <TabsContent value="orgs"><OrgSettingsTab orgs={orgs} onOrgsChange={loadOrgs} /></TabsContent>
      </Tabs>
    </div>
  );
}
```

`frontend/src/app/admin/layout.tsx`의 네비 배열(11–15행)에 추가하고 `BarChart3`를 lucide import에 추가:
```ts
  { href: "/admin/claude-usage", label: "Claude 사용량", icon: BarChart3 },
```

- [ ] **Step 7: 빌드·린트·전체 테스트**

Run: `cd frontend && npm run lint && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run build 2>&1 | tail -5`
Expected: 린트/타입 오류 없음, 테스트 전부 PASS, 빌드 성공(`/admin/claude-usage`, `/api/otel/v1/metrics`, `/api/otel/v1/logs`, `/api/admin/claude-usage/*` 라우트가 출력에 보임)

- [ ] **Step 8: 로컬 확인** — `./frontend/scripts/restart-frontend.sh` 후 admin 계정으로 `http://localhost:3003/admin/claude-usage` 접속: 탭 3개 렌더, 조직·설정 탭에 수집 상태(환경변수 미설정이면 ❌ 표시)와 관리형 설정 JSON(엔드포인트 `http://localhost:3003/api/otel`) 표시 확인.

- [ ] **Step 9: 커밋**

```bash
git add frontend/src/app/admin/claude-usage frontend/src/components/admin/claude-usage frontend/src/app/admin/layout.tsx
git commit -m "feat(claude-usage): /admin/claude-usage — Claude Code 실시간·멤버 활동 CSV·조직/관리형 설정 탭

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 런북 완성 + 환경변수 + 배포 + 스모크 테스트

**Files:**
- Modify: `docs/claude-usage.md` (§2–§4 채움)
- Modify: `CLAUDE.md` (API Routes·Supabase Tables·환경변수 항목 추가)
- Modify: `docs/superpowers/specs/2026-08-26-claude-usage-analytics-design.md` (상태 → 구현 완료)

**Interfaces:**
- Consumes: 전체 구현. 배포는 `git push` 후 `NODE_OPTIONS= vercel --prod --yes --scope seunguk-kangs-projects`(프로젝트 규칙; `frontend/src/app/api/action-history/route.ts` WIP는 배포 전 stash·후 복원).

- [ ] **Step 1: 런북 §2–§4 작성** — `docs/claude-usage.md`의 `Task 8에서 채움` 세 줄을 아래로 교체

```markdown
## 2. Claude Code 수집 켜기 (조직별 1회)
1. `/admin/claude-usage` → 조직·설정 탭 → "관리형 설정" JSON 복사 → `<CLAUDE_OTEL_INGEST_TOKEN>`을 실제 토큰으로 교체.
2. claude.ai(해당 조직 Owner로 로그인) → 관리자 설정 → Claude Code → 관리형 설정 → 관리 → JSON 붙여넣기 → 저장.
   - 기존 관리형 설정이 있으면 `env` 블록만 병합한다(다른 키 유지).
3. 구성원 안내문(Teams/Dooray 공지): "다음 Claude Code 실행 시 '조직 관리형 설정 승인' 창이 뜹니다. `OTEL_EXPORTER_OTLP_ENDPOINT = https://inje-playground.vercel.app/api/otel` 항목을 확인하고 승인해 주세요. 사용 통계(토큰·비용·세션)만 수집하며 프롬프트/코드 내용은 전송되지 않습니다."
4. 검증: 본인 Claude Code를 재시작해 승인 → 1~2분 후 조직·설정 탭 "24시간 수신"이 1 이상, Claude Code 탭에 본인 이메일 행 등장. 안 되면 §4.
5. 나머지 조직 6개에 같은 JSON 적용(조직 ID는 `organization.id`로 자동 구분·자동 등록되므로 조직·설정 탭에서 이름만 지정).

## 3. 월간 CSV 절차 (매월 1일, 조직당 1분)
1. claude.ai에서 조직 전환 → 분석 → 개요 → 멤버 **모두 보기** → 기간 **30일** → **CSV 내보내기**(`members-analytics-<조직ID>-<시작>-to-<끝>.csv`).
2. 7개 파일을 `/admin/claude-usage` → 채팅·Cowork 탭 → "파일 선택"으로 한 번에 업로드. 결과 줄이 전부 ✓인지 확인.
3. "노는 시트만" 버튼으로 Premium 시트인데 활동 0인 사용자를 확인 → 시트 회수 검토.
- 기간 60/90일 CSV도 업로드 가능(다른 기간 키로 별도 저장). 같은 조직·기간 재업로드는 교체.

## 4. 장애 대응
| 증상 | 확인 | 조치 |
|---|---|---|
| 수집 상태 "24시간 수신 0" | Vercel 로그에서 `/api/otel/v1/metrics` 401 → 토큰 불일치 | 관리형 설정 헤더 토큰과 `CLAUDE_OTEL_INGEST_TOKEN` 일치 확인(양쪽 공백 주의) |
| 415 응답 | 프로토콜이 protobuf | 관리형 설정 `OTEL_EXPORTER_OTLP_PROTOCOL` = `http/json` |
| 500 `store failed` | 조직·설정 탭 "마지막 오류" | `claude_code_ingest` 함수 존재·`SUPABASE_SERVICE_ROLE_KEY` 확인. RPC 오류 `cannot affect row a second time`면 파서 사전집계 버그 → 이슈 |
| 사용자 승인 창에서 거부 | Claude Code 종료됨 | 재실행 후 승인. 승인은 조직당 1회 기록됨 |
| 특정 사용자 데이터 없음 | Bedrock/Vertex/`ANTHROPIC_BASE_URL` 사용자는 관리형 설정을 받지 않음 | 해당 사용자는 OTel 대상 아님(문서상 제약) |
| CSV 업로드 "필수 칼럼 누락" | Anthropic이 헤더를 바꿈 | `frontend/src/lib/claude-usage/members-csv.ts`의 `MEMBERS_CSV_COLUMNS`에 새 헤더 추가 |
- 데이터 보존: `claude_code_requests`는 요청 단위라 커짐 → 필요 시 `delete from claude_code_requests where ts < now() - interval '180 days'`.
```

- [ ] **Step 2: CLAUDE.md 갱신** — API Routes 목록 끝에 추가:
```
- `POST /api/otel/v1/metrics`, `POST /api/otel/v1/logs` — Claude Code OTLP/HTTP JSON 수신(Bearer `CLAUDE_OTEL_INGEST_TOKEN`), RPC `claude_code_ingest`로 일 단위 합산
- `/api/admin/claude-usage/{summary,members,imports,imports/[id],orgs,health}` — Claude 사용량 대시보드(admin). 런북 `docs/claude-usage.md`
```
Supabase Tables 아래에 `claude_orgs, claude_code_daily, claude_code_daily_model, claude_code_requests, claude_ingest_log, claude_csv_imports, claude_member_activity` 한 줄, Environment Variables에 `SUPABASE_SERVICE_ROLE_KEY`, `CLAUDE_OTEL_INGEST_TOKEN` 항목 추가. App Router Pages에 `/admin/claude-usage` 추가.

- [ ] **Step 3: 환경변수** — 토큰 생성·등록(서비스 키는 사용자가 이미 등록했는지 `vercel env ls`로 확인)

```bash
TOKEN=$(openssl rand -hex 32)
cd frontend && printf '%s' "$TOKEN" | NODE_OPTIONS= vercel env add CLAUDE_OTEL_INGEST_TOKEN production --scope seunguk-kangs-projects
grep -q CLAUDE_OTEL_INGEST_TOKEN .env.local || echo "CLAUDE_OTEL_INGEST_TOKEN=$TOKEN" >> .env.local
NODE_OPTIONS= vercel env ls --scope seunguk-kangs-projects | grep -E "SUPABASE_SERVICE_ROLE_KEY|CLAUDE_OTEL_INGEST_TOKEN"
```
Expected: 두 변수 모두 Production에 존재. `SUPABASE_SERVICE_ROLE_KEY`가 없으면 사용자에게 요청(대시보드 Project Settings > API > service_role). 토큰 값은 사용자에게 1회 전달(관리형 설정에 붙일 값).

- [ ] **Step 4: 커밋·푸시·배포**

```bash
git add docs/claude-usage.md CLAUDE.md docs/superpowers/specs/2026-08-26-claude-usage-analytics-design.md
git commit -m "docs(claude-usage): 런북(관리형 설정 적용·월간 CSV·장애 대응)·CLAUDE.md 갱신

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
git stash push frontend/src/app/api/action-history/route.ts -m wip-action-history
cd frontend && NODE_OPTIONS= vercel --prod --yes --scope seunguk-kangs-projects; cd ..
git stash pop
```

- [ ] **Step 5: 스모크 테스트(배포본)**

```bash
BASE=https://inje-playground.vercel.app
# 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST $BASE/api/otel/v1/metrics -H "Content-Type: application/json" -d '{}'
# 200 {} — 합성 페이로드(dev0@example.com, org test-org)
NOW=$(($(date +%s)*1000000000))
curl -s -X POST $BASE/api/otel/v1/metrics -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"resourceMetrics\":[{\"scopeMetrics\":[{\"metrics\":[{\"name\":\"claude_code.session.count\",\"sum\":{\"aggregationTemporality\":1,\"dataPoints\":[{\"attributes\":[{\"key\":\"user.email\",\"value\":{\"stringValue\":\"dev0@example.com\"}},{\"key\":\"organization.id\",\"value\":{\"stringValue\":\"test-org\"}}],\"timeUnixNano\":\"$NOW\",\"asInt\":\"1\"}]}}]}]}]}"
```
Expected: `401` 그리고 `{}`. 이후 `/admin/claude-usage` Claude Code 탭에 `dev0@example.com` 1세션, 조직·설정 탭에 `test-org` 등록·수신 1건. 확인 후 정리:
```sql
delete from claude_code_daily where org_id = 'test-org'; delete from claude_orgs where id = 'test-org';
```

- [ ] **Step 6: 실제 CSV 업로드 검증** — 사용자가 내려받은 `~/Downloads/members-analytics-4ad6b3e9-…-2026-07-27-to-2026-08-25.csv`를 채팅·Cowork 탭에 업로드 → 78명, 노는 시트 개수 표시 확인. 조직·설정 탭에서 `4ad6b3e9…` 이름을 `Innogrid-ax`, 총 시트 97로 저장.

- [ ] **Step 7: 완료 보고** — 사용자에게 (1) 토큰 값, (2) 관리형 설정 적용 절차(런북 §2), (3) 남은 사용자 액션(SUPABASE_SERVICE_ROLE_KEY 미설정 시) 전달. `🕐 현재 시각` 포함.

---

### Task 9: CSV 반자동 수집 — 토큰 인증 업로드 + 업로드 스크립트 + `/claude-usage-csv` 스킬

**Files:**
- Modify: `frontend/src/app/api/admin/claude-usage/imports/route.ts` (POST 인증 분기)
- Create: `frontend/scripts/claude-usage-upload.sh`
- Create: `.claude/skills/claude-usage-csv/SKILL.md`
- Modify: `docs/claude-usage.md` §3 (스킬·스크립트 절차 추가)

**Interfaces:**
- Consumes: `verifyIngestToken` (Task 3), `requireAdmin` (Task 6), `POST /api/admin/claude-usage/imports` 계약(Task 6)
- Produces: `POST /api/admin/claude-usage/imports`가 **관리자 세션 또는 `Authorization: Bearer <CLAUDE_OTEL_INGEST_TOKEN>`** 둘 중 하나로 인증(토큰 인증 시 `uploaded_by = null`). 스크립트 `claude-usage-upload.sh [days=3]`: `~/Downloads/members-analytics-*.csv` 중 최근 N일 파일을 한 요청으로 업로드 후 `~/Downloads/claude-usage-uploaded/`로 이동. 스킬: Chrome 확장으로 7개 조직 순회 → CSV 내보내기 → 스크립트 실행 → 결과 보고.
- 대상 조직(스펙 §2.1.1): Innogrid-ax, Innogrid_AIMS클라우드, Innogrid_AIPaaS, Innogrid_AI반도체Cloud, Innogrid_S1, Innogrid_S2, Innogrid_자율행동체.

- [ ] **Step 1: imports POST 인증 분기** — `frontend/src/app/api/admin/claude-usage/imports/route.ts`의 POST 첫 부분을 아래로 교체(GET/DELETE는 그대로 세션 전용):

```ts
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
// …
export async function POST(request: NextRequest) {
  // 관리자 세션 또는 수집 토큰(스크립트 업로드용) 중 하나
  let uploadedBy: string | null = null;
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    uploadedBy = auth.userId;
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  // … 이하 동일, insert 시 `uploaded_by: uploadedBy`
```

- [ ] **Step 2: 업로드 스크립트** (`frontend/scripts/claude-usage-upload.sh`, `chmod +x`)

```bash
#!/usr/bin/env bash
# ~/Downloads의 members-analytics-*.csv(최근 N일)를 /api/admin/claude-usage/imports에 한 번에 업로드
# 사용: ./frontend/scripts/claude-usage-upload.sh [days=3]
set -euo pipefail
DAYS="${1:-3}"
BASE_URL="${INJE_BASE_URL:-https://inje-playground.vercel.app}"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
TOKEN="${CLAUDE_OTEL_INGEST_TOKEN:-$(grep -E '^CLAUDE_OTEL_INGEST_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)}"
if [ -z "$TOKEN" ]; then echo "CLAUDE_OTEL_INGEST_TOKEN이 없습니다(.env.local 또는 환경변수)." >&2; exit 1; fi
DL="$HOME/Downloads"; DONE_DIR="$DL/claude-usage-uploaded"; mkdir -p "$DONE_DIR"
FILES=()
while IFS= read -r f; do FILES+=("$f"); done < <(find "$DL" -maxdepth 1 -name 'members-analytics-*.csv' -mtime -"$DAYS" | sort)
if [ ${#FILES[@]} -eq 0 ]; then echo "업로드할 CSV가 없습니다(최근 ${DAYS}일)."; exit 0; fi
ARGS=(); for f in "${FILES[@]}"; do ARGS+=(-F "files=@$f"); done
echo "업로드 ${#FILES[@]}개 → $BASE_URL"
RESP=$(curl -sS -X POST "$BASE_URL/api/admin/claude-usage/imports" -H "Authorization: Bearer $TOKEN" "${ARGS[@]}")
echo "$RESP" | python3 -c '
import json,sys
d=json.load(sys.stdin)
if "error" in d: print("실패:", d["error"]); sys.exit(1)
ok=0
for r in d["results"]:
    if r["ok"]: ok+=1; print(f"✓ {r[\"filename\"]} → {r[\"org_id\"][:8]} {r[\"period_start\"]}~{r[\"period_end\"]} {r[\"row_count\"]}명")
    else: print(f"✗ {r[\"filename\"]}: {r[\"error\"]}")
print(f"{ok}/{len(d[\"results\"])} 성공")
sys.exit(0 if ok==len(d["results"]) else 2)'
STATUS=$?
if [ $STATUS -eq 0 ]; then for f in "${FILES[@]}"; do mv "$f" "$DONE_DIR/"; done; echo "업로드 완료 파일을 $DONE_DIR 로 이동"; fi
exit $STATUS
```

- [ ] **Step 3: 스킬** (`.claude/skills/claude-usage-csv/SKILL.md`)

```markdown
---
name: claude-usage-csv
description: claude.ai Team 조직 7개의 멤버 활동 CSV를 Chrome 확장으로 내보내고 /admin/claude-usage에 업로드한다. "CSV 수집해", "클로드 사용량 CSV 갱신" 요청 시 사용.
---

# Claude 사용량 CSV 수집 (반자동)

전제: Chrome에 Claude in Chrome 확장이 연결돼 있고, claude.ai에 7개 조직의 소유자 계정(seunguk.kang@innogrid.com)으로 로그인돼 있다. 연결이 안 되면(`tabs_context_mcp` 오류) 사용자에게 `/mcp` → claude-in-chrome 재연결을 요청하고 중단한다. Cloudflare 확인·로그인 화면이 나오면 사용자가 직접 처리하도록 요청한다(자동 통과 금지).

대상 조직(순서대로): Innogrid-ax, Innogrid_AIMS클라우드, Innogrid_AIPaaS, Innogrid_AI반도체Cloud, Innogrid_S1, Innogrid_S2, Innogrid_자율행동체.

## 절차
1. `tabs_context_mcp` → 새 탭 → `https://claude.ai/analytics/overview` 이동. `get_page_text`로 "개요" 아래 조직명을 읽어 현재 조직을 확인한다.
2. 조직 전환: 좌측 하단 계정/조직 메뉴(현재 조직명이 표시된 버튼)를 `find`로 찾아 클릭 → 조직 목록에서 대상 조직 클릭 → 다시 `https://claude.ai/analytics/overview`로 이동 → 개요의 조직명이 대상과 일치하는지 확인(불일치면 재시도 1회 후 사용자에게 보고).
3. 멤버 카드의 **"모두 보기"** 클릭(`find` → ref 클릭; 대화상자가 안 열리면 스크린샷 좌표로 클릭) → 대화상자 기간 콤보가 **30일**인지 확인(기본값) → **"CSV 내보내기"** 클릭 → 2초 대기 → `ls -t ~/Downloads/members-analytics-*.csv | head -1`로 새 파일 생성 확인(파일명의 조직 ID가 이전 조직과 다른지 확인). Escape 2회로 대화상자 닫기.
4. 7개 조직 반복. 실패한 조직은 건너뛰고 마지막에 목록으로 보고한다.
5. 업로드: `./frontend/scripts/claude-usage-upload.sh 1` 실행 → 출력의 ✓/✗ 줄을 그대로 보고.
6. 확인: 사용자에게 `/admin/claude-usage` 채팅·Cowork 탭에서 "조직별 최신 업로드"가 오늘 날짜 기간으로 갱신됐는지 안내. 사용한 탭은 `tabs_close_mcp`로 닫는다.

## 주의
- 다운로드 버튼 클릭은 파일 다운로드이므로 이 스킬을 사용자가 명시적으로 호출한 경우에만 수행한다.
- 관리자 멤버 CSV(관리자 설정 > 멤버)는 필요 없다(활동 CSV에 Role/Seat Tier 포함).
- 조직 ID는 파일명에서 자동 인식되므로 조직 이름 매핑은 `/admin/claude-usage` 조직·설정 탭에서 1회만 지정한다.
```

- [ ] **Step 4: 런북 §3 갱신** — `docs/claude-usage.md` §3 첫머리에 추가: "가장 쉬운 방법: Claude Code에서 `/claude-usage-csv` 실행(Chrome 확장 연결 필요) → 7개 조직 CSV 내보내기 + 업로드가 자동 진행. 수동으로 받았다면 `./frontend/scripts/claude-usage-upload.sh 3`으로 최근 3일 파일을 일괄 업로드."

- [ ] **Step 5: 검증** — `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint -- src/app/api/admin/claude-usage/imports` 통과; `bash -n frontend/scripts/claude-usage-upload.sh` 통과; 배포 후 `curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/admin/claude-usage/imports -H "Authorization: Bearer wrong"` → `401`(세션도 없으므로 requireAdmin의 401), 올바른 토큰 + 실제 CSV로 스크립트 실행 → ✓ 출력.

- [ ] **Step 6: 커밋·푸시·배포**

```bash
git add frontend/src/app/api/admin/claude-usage/imports/route.ts frontend/scripts/claude-usage-upload.sh .claude/skills/claude-usage-csv/SKILL.md docs/claude-usage.md
git commit -m "feat(claude-usage): CSV 반자동 수집 — 토큰 인증 업로드·일괄 업로드 스크립트·/claude-usage-csv 스킬

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
git stash push frontend/src/app/api/action-history/route.ts -m wip-action-history
cd frontend && NODE_OPTIONS= vercel --prod --yes --scope seunguk-kangs-projects; cd ..
git stash pop
```

---

## Self-Review

- **Spec coverage**: §2.1 OTel 수집(Task 2·3·8) ✓ · §2.2 CSV 수집(Task 4·6·7) ✓ · §2.3 대시보드 3탭(Task 7) ✓ · §2.4 RLS·환경변수·롤아웃(Task 1·8) ✓ · 노는 시트 판정(Task 5·7) ✓ · 이메일 조인(Task 5·6) ✓ · 조직 자동 등록(Task 1 RPC·Task 6 imports) ✓ · Enterprise 전환 대비 소스 불문 테이블(Task 1: import 단위 교체 구조) ✓
- **Placeholder scan**: 없음(Task 8 §3의 실제 파일명 생략부호 `…`는 로컬 파일 참조로 의도적).
- **Type consistency**: `DailyRow`/`ModelRow`/`ApiRequestEvent`/`MemberActivityRow`/`CsvImport`/`ClaudeOrg`/`UserUsageRow`/`UsageSummary`(Task 1) ↔ Task 2 `parseMetricsPayload` 반환 `{daily: DailyRow[]; model: ModelRow[]; dropped}` ↔ Task 3 `storeMetrics(admin, parsed)` ↔ Task 5 `summarize({rows, models, orgs, members, from, to})` ↔ Task 6 summary 라우트 ↔ Task 7 `UsageSummary` 소비. `requireAdmin`/`adminClientOr500`/`isYmd`/`numify`(Task 6 Step 1) 이름을 Task 6 전 라우트에서 동일 사용. `acceptRate`/`isIdleSeat`/`dateRangePreset`/`RangePreset`(Task 5) ↔ Task 7 import 일치. `buildManagedSettings(endpointBase, token?)`(Task 5) ↔ Task 7 OrgSettingsTab 일치.
