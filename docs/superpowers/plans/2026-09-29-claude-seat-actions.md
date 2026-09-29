# Claude 시트 할당·해제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅·Cowork 멤버 표에서 관리자가 시트를 해제·할당하면 요청이 기록되고, 관리자 Mac의 실행기가 claude.ai에 반영하며, 모든 요청·결과가 사람별 이력으로 남는다.

**Architecture:** 서버는 요청 테이블 `claude_seat_actions`와 실행기 하트비트 `claude_seat_executor`를 관리하는 API를 제공한다. 관리자 Mac의 Node 실행기(playwright-core, 전용 브라우저 프로필)가 15초마다 요청을 claim해 claude.ai 내부 API로 티어를 바꾸고 결과를 PATCH한다. 멤버 표 API는 `claude_org_members`의 티어와 최근 요청 요약을 행에 덧붙이고, 화면은 행 액션·상태 배지·실행기 칩·이력 Sheet를 보인다.

**Tech Stack:** Next.js 16 App Router(라우트 핸들러), Supabase(PostgREST + RPC, RLS), React 19 + shadcn/ui(AlertDialog·DropdownMenu·Sheet), vitest, Node 26 + playwright-core 1.61.1(`frontend`에 설치됨), macOS launchd.

**Spec:** `docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md`

## Global Constraints

- 모든 작업은 `frontend/`에서 실행한다(`npm test`, `npx eslint`, `npx tsc --noEmit -p .`). tsc 기존 오류 3건(`.next/types/validator.ts`, `src/lib/marketing/email/normalize.ts` ×2)과 기존 실패 테스트 `marketing-email-network.test.ts`는 이 작업과 무관하다 — 새 오류·새 실패만 본다.
- 커밋은 `main`에 직접, 메시지 끝에 두 줄: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01AduDdkuDZWRPG4WAvyTmjr`. 푸시·배포·SQL 적용은 컨트롤러가 한다(구현자는 커밋까지).
- 티어 표기: DB·화면은 `Standard`·`Premium`·`Unassigned`, claude.ai API는 `team_standard`·`team_tier_1`·`unassigned`. 이메일은 항상 소문자·trim.
- 상태: `requested → running → done | failed`, `requested → cancelled`. 그 외 전이는 409.
- 확정값: 실행기 폴링 15초, 화면 재조회 5초·최대 2분, 하트비트 60초 초과 = "실행기 꺼짐", `running` 10분 초과 = 실패 처리, 이력 요약은 대기·실행 중 또는 최근 24시간 마지막 1건.
- 인증: 관리자 작업은 `requireAdmin()`, 실행기 작업은 `verifyIngestToken(authorization, process.env.CLAUDE_OTEL_INGEST_TOKEN)`. 수집 토큰으로는 요청을 만들 수 없다.
- 감사 로그 category는 `usage`. detail에 비밀 값(토큰·쿠키) 금지.
- 실행기 라우트 응답은 `Cache-Control: no-store`.
- UI 문구는 한국어. 개인 화면 `/usage/chat`은 손대지 않는다.
- 서버에 claude.ai 자격 증명을 저장하지 않는다.

## Review Focus

1. 요청 이메일의 대소문자·공백(`" Kim@Innogrid.com "`)이 `claude_org_members`의 소문자 이메일과 매칭돼야 한다 — Task 3 `parseRequest` 테스트.
2. 같은 이메일이 두 조직에 있을 때 요청은 `org_id`로 구분돼야 하고, 한 조직의 대기 요청이 다른 조직의 요청을 막으면 안 된다 — Task 3 `summarize` 키 테스트, Task 5 overlay 테스트.
3. claude.ai 멤버 API가 배열이 아니라 `{members:[…]}`·`{data:[…]}`로 오거나 `email_address`가 없어도 실행기가 예외 없이 "멤버를 찾지 못했습니다"로 실패 처리해야 한다 — Task 6 `findMember` 테스트.
4. 실행기 프로세스가 죽어 `running`이 남으면 10분 뒤 자동으로 `failed`가 되고 다음 요청을 막지 않아야 한다 — Task 4 claim 핸들러(수동 확인 Task 8), Task 3 `canTransition`.
5. 하트비트가 60초 넘게 없거나 `logged_in=false`면 화면이 각각 "실행기 꺼짐"·"로그인 필요"를 보여야 한다 — Task 3 `executorState` 테스트.

---

## File Structure

| 파일 | 역할 |
|---|---|
| `docs/sql/2026-09-29-claude-seat-actions.sql` | 테이블 2개, claim RPC, RLS, grant (Task 1) |
| `frontend/src/types/claude-seat.ts` | `SeatAction`·`SeatExecutor`·`SeatActionSummary` 타입 (Task 1) |
| `frontend/src/lib/claude-usage/seat-tier.ts` | `TIER_TO_API`, `normalizeTier` (Task 2) |
| `frontend/src/lib/claude-usage/seat-actions.ts` | `parseRequest`·`checkRequest`·`canTransition`·`summarize`·`executorState`·`overlaySeat` 순수 함수 (Task 3) |
| `frontend/src/lib/claude-usage/require-admin.ts` | `requireAdmin`이 `email`도 돌려준다 (Task 3) |
| `frontend/src/app/api/admin/claude-usage/seat-actions/route.ts` | GET·POST·DELETE·PATCH (Task 4) |
| `frontend/src/app/api/admin/claude-usage/seat-actions/heartbeat/route.ts` | PUT (Task 4) |
| `frontend/src/app/api/admin/claude-usage/members/route.ts` | 티어 덮어쓰기·`seat_action`·`executor` 첨부 (Task 5) |
| `frontend/scripts/lib/claude-seat.mjs` | 실행기 순수 부분: `TIER_TO_API`, `findMember`, `parseEnv`, `readToken` (Task 6) |
| `frontend/scripts/claude-seat-executor.mjs` | 실행기 본체(`--login`, `--once`) (Task 6) |
| `frontend/scripts/claude-seat-login.sh` | 로그인 래퍼 (Task 6) |
| `frontend/src/components/admin/claude-usage/SeatActionCell.tsx` | 행 액션(해제/할당 드롭다운·확인 대화상자·상태 배지·취소) (Task 7) |
| `frontend/src/components/admin/claude-usage/SeatHistorySheet.tsx` | 이력 Sheet (Task 7) |
| `frontend/src/components/admin/claude-usage/SeatExecutorChip.tsx` | 실행기 상태 칩 (Task 7) |
| `frontend/src/components/admin/claude-usage/MembersCsvTab.tsx` | 액션 열·칩·이력 버튼·재조회 (Task 7) |
| `~/.claude/hooks/claude-seat-executor.sh`, `~/Library/LaunchAgents/com.innogrid.claude-seat-executor.plist`, `~/.claude/hooks/claude-jobs` | 로컬 launchd 등록 (Task 8, 컨트롤러) |
| `docs/claude-usage.md`, `docs/launchd-jobs.md`, `.claude/rules/claude-usage-cost.md` | 런북·규칙 (Task 8) |
| 테스트 `frontend/src/lib/__tests__/claude-seat-tier.test.ts`, `claude-seat-actions.test.ts`, `claude-seat-executor-lib.test.ts` | Task 2·3·6 |

---

### Task 1: SQL과 타입

**Files:**
- Create: `docs/sql/2026-09-29-claude-seat-actions.sql`
- Create: `frontend/src/types/claude-seat.ts`

**Interfaces:**
- Produces: 테이블 `claude_seat_actions`, `claude_seat_executor`, RPC `claude_seat_action_claim(p_executor text) returns setof claude_seat_actions`; 타입 `SeatActionKind`, `SeatActionStatus`, `SeatTier`, `SeatAction`, `SeatExecutor`, `SeatActionSummary`, `SeatActionInput`.

- [ ] **Step 1: SQL 파일 작성**

```sql
-- 2026-09-29 Claude 시트 할당·해제 — 요청·실행 이력과 실행기 하트비트
-- 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md §4. 멱등(재실행 가능).

create table if not exists public.claude_seat_actions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             text not null references public.claude_orgs(id),
  email              text not null,                                   -- 소문자
  action             text not null check (action in ('unassign', 'assign')),
  target_tier        text check (target_tier in ('Standard', 'Premium')), -- assign만
  status             text not null default 'requested' check (status in ('requested', 'running', 'done', 'failed', 'cancelled')),
  requested_by       uuid not null,
  requested_by_email text not null,
  requested_at       timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  before_tier        text,
  after_tier         text,
  error              text,
  executor           text
);
create index if not exists claude_seat_actions_email_idx on public.claude_seat_actions (email, requested_at desc);
create index if not exists claude_seat_actions_open_idx on public.claude_seat_actions (status) where status in ('requested', 'running');
-- 같은 조직·이메일에 대기·실행 중 요청은 하나만
create unique index if not exists claude_seat_actions_open_uniq on public.claude_seat_actions (org_id, email) where status in ('requested', 'running');

create table if not exists public.claude_seat_executor (
  id           text primary key,             -- 항상 'default'
  last_seen_at timestamptz not null,
  logged_in    boolean not null default false,
  note         text,
  host         text,
  version      text
);

-- 가장 오래된 requested 1건을 running으로 바꿔 돌려준다(동시 실행기 대비 skip locked)
create or replace function public.claude_seat_action_claim(p_executor text)
returns setof public.claude_seat_actions
language sql
security definer
set search_path = public
as $$
  update public.claude_seat_actions a
     set status = 'running', started_at = now(), executor = p_executor
   where a.id = (
     select id from public.claude_seat_actions
      where status = 'requested'
      order by requested_at
      limit 1
      for update skip locked
   )
  returning a.*;
$$;
revoke all on function public.claude_seat_action_claim(text) from public;
grant execute on function public.claude_seat_action_claim(text) to service_role;

-- RLS: 읽기는 admin만, 쓰기 정책 없음(service role) — claude_org_members와 같은 규칙
do $$
begin
  execute 'alter table public.claude_seat_actions enable row level security';
  execute 'drop policy if exists claude_seat_actions_admin_read on public.claude_seat_actions';
  execute 'create policy claude_seat_actions_admin_read on public.claude_seat_actions for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))';
  execute 'alter table public.claude_seat_executor enable row level security';
  execute 'drop policy if exists claude_seat_executor_admin_read on public.claude_seat_executor';
  execute 'create policy claude_seat_executor_admin_read on public.claude_seat_executor for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))';
end $$;

-- 확인:
-- select column_name, data_type from information_schema.columns where table_name = 'claude_seat_actions' order by ordinal_position;
-- select proname from pg_proc where proname = 'claude_seat_action_claim';
```

- [ ] **Step 2: 타입 파일 작성**

```ts
// frontend/src/types/claude-seat.ts
/** Claude 시트 할당·해제 — 요청·실행 이력(claude_seat_actions)과 실행기 하트비트(claude_seat_executor). 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md */

export type SeatActionKind = "unassign" | "assign";
export type SeatActionStatus = "requested" | "running" | "done" | "failed" | "cancelled";
/** DB·화면 표기. claude.ai API 값과의 대응은 lib/claude-usage/seat-tier.ts */
export type SeatTier = "Standard" | "Premium" | "Unassigned";

export interface SeatAction {
  id: string;
  org_id: string;
  email: string;
  action: SeatActionKind;
  target_tier: "Standard" | "Premium" | null;
  status: SeatActionStatus;
  requested_by: string;
  requested_by_email: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  before_tier: string | null;
  after_tier: string | null;
  error: string | null;
  executor: string | null;
}

export interface SeatExecutor {
  id: string;
  last_seen_at: string;
  logged_in: boolean;
  note: string | null;
  host: string | null;
  version: string | null;
}

/** 멤버 표 행에 붙는 요약 — 대기·실행 중이면 그것, 아니면 최근 24시간 마지막 1건 */
export interface SeatActionSummary {
  id: string;
  action: SeatActionKind;
  status: SeatActionStatus;
  target_tier: "Standard" | "Premium" | null;
  requested_at: string;
  error: string | null;
}

/** POST 요청 본문(검증 후) */
export interface SeatActionInput {
  org_id: string;
  email: string;
  action: SeatActionKind;
  target_tier: "Standard" | "Premium" | null;
}
```

- [ ] **Step 3: 타입 검사**

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | grep -v "validator.ts\|normalize.ts" | grep error`
Expected: 출력 없음(새 오류 0)

- [ ] **Step 4: Commit**

```bash
git add docs/sql/2026-09-29-claude-seat-actions.sql frontend/src/types/claude-seat.ts
git commit -m "feat(claude-usage): 시트 할당·해제 테이블·claim RPC·타입"
```

(컨트롤러: 커밋 뒤 Management API로 SQL 적용 → 확인 쿼리 두 개 실행.)

---

### Task 2: 티어 정규화

**Files:**
- Create: `frontend/src/lib/claude-usage/seat-tier.ts`
- Test: `frontend/src/lib/__tests__/claude-seat-tier.test.ts`

**Interfaces:**
- Produces: `TIER_TO_API: Record<SeatTier, "team_standard" | "team_tier_1" | "unassigned">`, `normalizeTier(raw: unknown): string`.
- 주의: `TIER_TO_API`의 내용은 Task 6의 `frontend/scripts/lib/claude-seat.mjs`와 정확히 같아야 한다(Task 6 테스트가 대조).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-seat-tier.test.ts
import { describe, expect, it } from "vitest";
import { TIER_TO_API, normalizeTier } from "@/lib/claude-usage/seat-tier";
import { hasSeat } from "@/lib/claude-usage/aggregate";

describe("seat-tier", () => {
  it("claude.ai API 값·화면 표기·한글을 Standard/Premium/Unassigned로 정규화한다", () => {
    expect(normalizeTier("team_standard")).toBe("Standard");
    expect(normalizeTier(" Standard ")).toBe("Standard");
    expect(normalizeTier("스탠다드")).toBe("Standard");
    expect(normalizeTier("team_tier_1")).toBe("Premium");
    expect(normalizeTier("PREMIUM")).toBe("Premium");
    expect(normalizeTier("프리미엄")).toBe("Premium");
    expect(normalizeTier("unassigned")).toBe("Unassigned");
    expect(normalizeTier("할당되지 않음")).toBe("Unassigned");
    expect(normalizeTier("")).toBe("Unassigned");
    expect(normalizeTier(null)).toBe("Unassigned");
    expect(normalizeTier(undefined)).toBe("Unassigned");
  });
  it("모르는 값은 첫 글자만 대문자로 남긴다(정보 손실 없이)", () => {
    expect(normalizeTier("enterprise")).toBe("Enterprise");
  });
  it("Unassigned는 hasSeat=false, 나머지는 true", () => {
    expect(hasSeat(normalizeTier("unassigned"))).toBe(false);
    expect(hasSeat(normalizeTier("team_standard"))).toBe(true);
  });
  it("API 매핑 표", () => {
    expect(TIER_TO_API).toEqual({ Standard: "team_standard", Premium: "team_tier_1", Unassigned: "unassigned" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-seat-tier.test.ts`
Expected: FAIL — `Cannot find module '@/lib/claude-usage/seat-tier'`

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/claude-usage/seat-tier.ts
import type { SeatTier } from "@/types/claude-seat";

/**
 * 시트 티어 표기 — DB·화면은 Standard/Premium/Unassigned, claude.ai 내부 API는 team_standard/team_tier_1/unassigned.
 * 실행기(scripts/lib/claude-seat.mjs)가 같은 표를 갖는다 — 바꾸면 둘 다 바꾼다(테스트가 대조).
 */
export const TIER_TO_API: Record<SeatTier, "team_standard" | "team_tier_1" | "unassigned"> = {
  Standard: "team_standard",
  Premium: "team_tier_1",
  Unassigned: "unassigned",
};

const CANON: Record<string, SeatTier> = {
  team_standard: "Standard", standard: "Standard", "스탠다드": "Standard",
  team_tier_1: "Premium", premium: "Premium", "프리미엄": "Premium",
  unassigned: "Unassigned", none: "Unassigned", "": "Unassigned", "할당되지 않음": "Unassigned",
};

/** API 값·화면 표기·한글 어느 쪽이 와도 표준 표기로. 모르는 값은 첫 글자만 대문자 */
export function normalizeTier(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const c = CANON[s.toLowerCase()];
  return c ?? s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-seat-tier.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/claude-usage/seat-tier.ts frontend/src/lib/__tests__/claude-seat-tier.test.ts
git commit -m "feat(claude-usage): 시트 티어 정규화·API 매핑"
```

---

### Task 3: 요청 검증·상태 전이·요약·실행기 상태(순수 함수) + requireAdmin 이메일

**Files:**
- Create: `frontend/src/lib/claude-usage/seat-actions.ts`
- Modify: `frontend/src/lib/claude-usage/require-admin.ts:7-18` (`requireAdmin` 반환에 `email` 추가)
- Test: `frontend/src/lib/__tests__/claude-seat-actions.test.ts`

**Interfaces:**
- Consumes: `hasSeat` (`@/lib/claude-usage/aggregate`), `normalizeTier` (Task 2), 타입 (Task 1).
- Produces:
  - `parseRequest(body: unknown): { ok: true; value: SeatActionInput } | { ok: false; error: string }`
  - `checkRequest(input: SeatActionInput, member: { status: string; seat_tier: string | null } | null, hasOpen: boolean): { status: number; error: string } | null`
  - `canTransition(from: SeatActionStatus, to: SeatActionStatus): boolean`
  - `summarize(actions: SeatAction[], now: Date): Map<string, SeatActionSummary>` — 키 `${org_id}|${email}`
  - `executorState(ex: SeatExecutor | null, now: Date): { level: "ok" | "off" | "login"; text: string }`
  - `overlaySeat<T extends { org_id: string; email: string; seat_tier: string }>(rows: T[], orgMembers: { org_id: string; email: string; seat_tier: string | null }[], summaries: Map<string, SeatActionSummary>): (T & { seat_action: SeatActionSummary | null })[]`
  - `requireAdmin()` → `{ ok: true; userId: string; email: string | null }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-seat-actions.test.ts
import { describe, expect, it } from "vitest";
import { canTransition, checkRequest, executorState, overlaySeat, parseRequest, summarize } from "@/lib/claude-usage/seat-actions";
import type { SeatAction } from "@/types/claude-seat";

const base: SeatAction = {
  id: "a1", org_id: "org-1", email: "kim@innogrid.com", action: "unassign", target_tier: null, status: "requested",
  requested_by: "u1", requested_by_email: "admin@innogrid.com", requested_at: "2026-09-29T01:00:00.000Z",
  started_at: null, finished_at: null, before_tier: null, after_tier: null, error: null, executor: null,
};
const now = new Date("2026-09-29T02:00:00.000Z");

describe("parseRequest", () => {
  it("이메일은 소문자·trim, action·target_tier 검증", () => {
    expect(parseRequest({ org_id: " Org-1 ", email: " Kim@Innogrid.com ", action: "unassign" })).toEqual({ ok: true, value: { org_id: "org-1", email: "kim@innogrid.com", action: "unassign", target_tier: null } });
    expect(parseRequest({ org_id: "org-1", email: "kim@innogrid.com", action: "assign", target_tier: "Premium" })).toEqual({ ok: true, value: { org_id: "org-1", email: "kim@innogrid.com", action: "assign", target_tier: "Premium" } });
  });
  it("잘못된 본문은 오류 문구", () => {
    expect(parseRequest(null).ok).toBe(false);
    expect(parseRequest({ org_id: "org-1", email: "nope", action: "unassign" })).toEqual({ ok: false, error: "org_id와 이메일이 필요합니다." });
    expect(parseRequest({ org_id: "org-1", email: "a@b.c", action: "delete" })).toEqual({ ok: false, error: "action은 unassign 또는 assign이어야 합니다." });
    expect(parseRequest({ org_id: "org-1", email: "a@b.c", action: "assign" })).toEqual({ ok: false, error: "할당 티어(Standard 또는 Premium)를 고르세요." });
    expect(parseRequest({ org_id: "org-1", email: "a@b.c", action: "assign", target_tier: "Gold" })).toEqual({ ok: false, error: "할당 티어(Standard 또는 Premium)를 고르세요." });
  });
});

describe("checkRequest", () => {
  const un = { org_id: "org-1", email: "kim@innogrid.com", action: "unassign" as const, target_tier: null };
  const as = { ...un, action: "assign" as const, target_tier: "Standard" as const };
  it("활성 멤버가 아니면 404, 대기 요청 있으면 409", () => {
    expect(checkRequest(un, null, false)).toEqual({ status: 404, error: "이 조직의 활성 멤버가 아닙니다." });
    expect(checkRequest(un, { status: "pending", seat_tier: "Standard" }, false)).toEqual({ status: 404, error: "이 조직의 활성 멤버가 아닙니다." });
    expect(checkRequest(un, { status: "active", seat_tier: "Standard" }, true)).toEqual({ status: 409, error: "이미 대기·실행 중인 요청이 있습니다." });
  });
  it("해제는 시트가 있어야, 할당은 미할당이어야 한다", () => {
    expect(checkRequest(un, { status: "active", seat_tier: "Unassigned" }, false)).toEqual({ status: 400, error: "이미 미할당입니다." });
    expect(checkRequest(un, { status: "active", seat_tier: "Premium" }, false)).toBeNull();
    expect(checkRequest(as, { status: "active", seat_tier: "Premium" }, false)).toEqual({ status: 400, error: "이미 시트가 있습니다(Premium)." });
    expect(checkRequest(as, { status: "active", seat_tier: "team_standard" }, false)).toEqual({ status: 400, error: "이미 시트가 있습니다(Standard)." });
    expect(checkRequest(as, { status: "active", seat_tier: null }, false)).toBeNull();
  });
});

describe("canTransition", () => {
  it("허용 전이만 true", () => {
    expect(canTransition("requested", "running")).toBe(true);
    expect(canTransition("requested", "cancelled")).toBe(true);
    expect(canTransition("running", "done")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(false);
    expect(canTransition("done", "running")).toBe(false);
    expect(canTransition("requested", "done")).toBe(false);
  });
});

describe("summarize", () => {
  it("대기·실행 중이 우선, 없으면 24시간 안의 마지막 1건, 조직별로 따로", () => {
    const old = { ...base, id: "old", status: "done" as const, requested_at: "2026-09-27T00:00:00.000Z" };
    const done = { ...base, id: "d1", status: "done" as const, requested_at: "2026-09-29T00:00:00.000Z", after_tier: "Unassigned" };
    const run = { ...base, id: "r1", status: "running" as const, requested_at: "2026-09-28T23:00:00.000Z" };
    const other = { ...base, id: "o2", org_id: "org-2", status: "failed" as const, error: "x", requested_at: "2026-09-29T01:30:00.000Z" };
    const m = summarize([old, done, run, other], now);
    expect(m.get("org-1|kim@innogrid.com")).toEqual({ id: "r1", action: "unassign", status: "running", target_tier: null, requested_at: "2026-09-28T23:00:00.000Z", error: null });
    expect(m.get("org-2|kim@innogrid.com")).toEqual({ id: "o2", action: "unassign", status: "failed", target_tier: null, requested_at: "2026-09-29T01:30:00.000Z", error: "x" });
    expect(summarize([old], now).size).toBe(0);
    expect(summarize([done], now).get("org-1|kim@innogrid.com")?.id).toBe("d1");
  });
});

describe("executorState", () => {
  it("기록 없음·60초 초과·로그인 필요·정상", () => {
    expect(executorState(null, now).level).toBe("off");
    expect(executorState({ id: "default", last_seen_at: "2026-09-29T01:58:00.000Z", logged_in: true, note: null, host: null, version: null }, now)).toEqual({ level: "off", text: "실행기 꺼짐(마지막 2분 전) — 요청은 켜지면 처리됩니다" });
    expect(executorState({ id: "default", last_seen_at: "2026-09-29T01:59:50.000Z", logged_in: false, note: "로그인 필요", host: null, version: null }, now)).toEqual({ level: "login", text: "claude.ai 로그인 필요 — 관리자 Mac에서 claude-seat-login.sh 실행" });
    expect(executorState({ id: "default", last_seen_at: "2026-09-29T01:59:55.000Z", logged_in: true, note: null, host: "mac", version: "1" }, now)).toEqual({ level: "ok", text: "실행기 정상 · 방금" });
    expect(executorState({ id: "default", last_seen_at: "2026-09-29T01:59:20.000Z", logged_in: true, note: null, host: "mac", version: "1" }, now)).toEqual({ level: "ok", text: "실행기 정상 · 40초 전" });
  });
});

describe("overlaySeat", () => {
  it("claude_org_members 티어가 CSV 티어를 덮고, 요약은 조직·이메일로 붙는다", () => {
    const rows = [
      { org_id: "org-1", email: "kim@innogrid.com", seat_tier: "Standard", chats: 0 },
      { org_id: "org-2", email: "kim@innogrid.com", seat_tier: "Standard", chats: 1 },
      { org_id: "org-1", email: "lee@innogrid.com", seat_tier: "Premium", chats: 2 },
    ];
    const members = [{ org_id: "org-1", email: "kim@innogrid.com", seat_tier: "Unassigned" }, { org_id: "org-1", email: "lee@innogrid.com", seat_tier: null }];
    const out = overlaySeat(rows, members, summarize([base], now));
    expect(out[0]).toEqual({ org_id: "org-1", email: "kim@innogrid.com", seat_tier: "Unassigned", chats: 0, seat_action: { id: "a1", action: "unassign", status: "requested", target_tier: null, requested_at: "2026-09-29T01:00:00.000Z", error: null } });
    expect(out[1].seat_tier).toBe("Standard");
    expect(out[1].seat_action).toBeNull();
    expect(out[2].seat_tier).toBe("Premium");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-seat-actions.test.ts`
Expected: FAIL — `Cannot find module '@/lib/claude-usage/seat-actions'`

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/claude-usage/seat-actions.ts
import { hasSeat } from "@/lib/claude-usage/aggregate";
import { normalizeTier } from "@/lib/claude-usage/seat-tier";
import type { SeatAction, SeatActionInput, SeatActionStatus, SeatActionSummary, SeatExecutor } from "@/types/claude-seat";

/**
 * 시트 할당·해제 요청의 검증·상태 규칙·표 요약 — 라우트와 화면이 같이 쓰는 순수 함수.
 * 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md §4·§5·§7
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRequest(body: unknown): { ok: true; value: SeatActionInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const org_id = typeof b.org_id === "string" ? b.org_id.trim().toLowerCase() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!org_id || !EMAIL_RE.test(email)) return { ok: false, error: "org_id와 이메일이 필요합니다." };
  if (b.action !== "unassign" && b.action !== "assign") return { ok: false, error: "action은 unassign 또는 assign이어야 합니다." };
  if (b.action === "assign") {
    if (b.target_tier !== "Standard" && b.target_tier !== "Premium") return { ok: false, error: "할당 티어(Standard 또는 Premium)를 고르세요." };
    return { ok: true, value: { org_id, email, action: "assign", target_tier: b.target_tier } };
  }
  return { ok: true, value: { org_id, email, action: "unassign", target_tier: null } };
}

/** 현재 멤버 상태에 비춰 요청이 말이 되는지. 문제면 {status, error}, 괜찮으면 null */
export function checkRequest(input: SeatActionInput, member: { status: string; seat_tier: string | null } | null, hasOpen: boolean): { status: number; error: string } | null {
  if (!member || member.status !== "active") return { status: 404, error: "이 조직의 활성 멤버가 아닙니다." };
  if (hasOpen) return { status: 409, error: "이미 대기·실행 중인 요청이 있습니다." };
  const tier = normalizeTier(member.seat_tier);
  if (input.action === "unassign" && !hasSeat(tier)) return { status: 400, error: "이미 미할당입니다." };
  if (input.action === "assign" && hasSeat(tier)) return { status: 400, error: `이미 시트가 있습니다(${tier}).` };
  return null;
}

const TRANSITIONS: Record<SeatActionStatus, SeatActionStatus[]> = {
  requested: ["running", "cancelled"],
  running: ["done", "failed"],
  done: [], failed: [], cancelled: [],
};
export function canTransition(from: SeatActionStatus, to: SeatActionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

const OPEN = new Set<SeatActionStatus>(["requested", "running"]);
const DAY_MS = 86_400_000;

/** 조직|이메일 → 표에 보일 요약. 대기·실행 중이 우선, 없으면 24시간 안의 마지막 1건 */
export function summarize(actions: SeatAction[], now: Date): Map<string, SeatActionSummary> {
  const out = new Map<string, SeatActionSummary>();
  const cutoff = now.getTime() - DAY_MS;
  const sorted = [...actions].sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1)); // 최신 먼저
  for (const a of sorted) {
    const key = `${a.org_id}|${a.email}`;
    const prev = out.get(key);
    if (prev && OPEN.has(prev.status)) continue;
    if (!OPEN.has(a.status) && (prev || Date.parse(a.requested_at) < cutoff)) continue;
    out.set(key, { id: a.id, action: a.action, status: a.status, target_tier: a.target_tier, requested_at: a.requested_at, error: a.error });
  }
  return out;
}

/** 실행기 칩 문구. 60초 넘게 하트비트가 없으면 꺼짐, 세션 없으면 로그인 필요 */
export function executorState(ex: SeatExecutor | null, now: Date): { level: "ok" | "off" | "login"; text: string } {
  if (!ex) return { level: "off", text: "실행기 기록 없음 — 관리자 Mac에서 claude-seat-executor를 켜야 합니다" };
  const sec = Math.max(0, Math.round((now.getTime() - Date.parse(ex.last_seen_at)) / 1000));
  if (sec > 60) {
    const ago = sec < 3600 ? `${Math.round(sec / 60)}분 전` : sec < DAY_MS / 1000 ? `${Math.round(sec / 3600)}시간 전` : `${Math.round(sec / 86400)}일 전`;
    return { level: "off", text: `실행기 꺼짐(마지막 ${ago}) — 요청은 켜지면 처리됩니다` };
  }
  if (!ex.logged_in) return { level: "login", text: "claude.ai 로그인 필요 — 관리자 Mac에서 claude-seat-login.sh 실행" };
  return { level: "ok", text: sec < 20 ? "실행기 정상 · 방금" : `실행기 정상 · ${sec}초 전` };
}

/** 멤버 표 행에 claude_org_members 티어(있으면)와 요청 요약을 붙인다 */
export function overlaySeat<T extends { org_id: string; email: string; seat_tier: string }>(
  rows: T[],
  orgMembers: { org_id: string; email: string; seat_tier: string | null }[],
  summaries: Map<string, SeatActionSummary>,
): (T & { seat_action: SeatActionSummary | null })[] {
  const tier = new Map<string, string>();
  for (const m of orgMembers) if (m.seat_tier) tier.set(`${m.org_id}|${m.email.toLowerCase()}`, normalizeTier(m.seat_tier));
  return rows.map((r) => {
    const key = `${r.org_id}|${r.email.toLowerCase()}`;
    const t = tier.get(key);
    return { ...r, seat_tier: t ?? r.seat_tier, seat_action: summaries.get(key) ?? null };
  });
}
```

- [ ] **Step 4: requireAdmin에 email 추가**

`frontend/src/lib/claude-usage/require-admin.ts`의 `requireAdmin`을 다음으로 바꾼다(반환 타입과 마지막 줄만 바뀐다):

```ts
export async function requireAdmin(): Promise<{ ok: true; userId: string; email: string | null } | { ok: false; response: NextResponse }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  const { data: caller } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  if (caller?.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }) };
  }
  return { ok: true, userId: user.id, email: user.email ?? null };
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-seat-actions.test.ts && npx tsc --noEmit -p . 2>&1 | grep -v "validator.ts\|normalize.ts" | grep error`
Expected: PASS (6 tests), tsc 새 오류 없음

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/claude-usage/seat-actions.ts frontend/src/lib/claude-usage/require-admin.ts frontend/src/lib/__tests__/claude-seat-actions.test.ts
git commit -m "feat(claude-usage): 시트 요청 검증·상태 전이·요약·실행기 상태 순수 함수"
```

---

### Task 4: API 라우트 — seat-actions(GET·POST·DELETE·PATCH)와 heartbeat(PUT)

**Files:**
- Create: `frontend/src/app/api/admin/claude-usage/seat-actions/route.ts`
- Create: `frontend/src/app/api/admin/claude-usage/seat-actions/heartbeat/route.ts`

**Interfaces:**
- Consumes: Task 3 함수, `requireAdmin`(email 포함), `adminClientOr500`, `verifyIngestToken`(`@/lib/claude-usage/ingest-auth`), `logAudit`(`@/lib/audit`), `normalizeTier`(Task 2), RPC `claude_seat_action_claim`(Task 1).
- Produces(실행기가 쓰는 계약, Task 6이 그대로 호출):
  - `GET /api/admin/claude-usage/seat-actions?claim=1&executor=<host>` (Bearer 토큰) → `{ row: SeatAction | null }`
  - `PATCH /api/admin/claude-usage/seat-actions` (Bearer) body `{ id, status: "done"|"failed", before_tier?, after_tier?, error?, executor }` → `{ row }`
  - `PUT /api/admin/claude-usage/seat-actions/heartbeat` (Bearer) body `{ logged_in: boolean, note?: string, host: string, version: string }` → `{ ok: true }`
  - 관리자: `GET ?email=&org=&status=&limit=` → `{ rows: SeatAction[], executor: SeatExecutor | null }`, `POST` body `SeatActionInput` → 201 `{ row }`, `DELETE ?id=` → `{ row }`

- [ ] **Step 1: seat-actions 라우트 작성**

```ts
// frontend/src/app/api/admin/claude-usage/seat-actions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { logAudit } from "@/lib/audit";
import { normalizeTier } from "@/lib/claude-usage/seat-tier";
import { canTransition, checkRequest, parseRequest } from "@/lib/claude-usage/seat-actions";
import type { SeatAction, SeatActionStatus } from "@/types/claude-seat";

export const runtime = "nodejs";

/**
 * Claude 시트 할당·해제 요청(claude_seat_actions). 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md §5
 * 관리자 세션:
 *   GET  ?email=&org=&status=&limit=   이력(requested_at 내림차순) + 실행기 하트비트
 *   POST { org_id, email, action, target_tier? }   요청 생성(활성 멤버·중복·티어 검증) → 201
 *   DELETE ?id=                        requested만 취소
 * 실행기(Bearer CLAUDE_OTEL_INGEST_TOKEN):
 *   GET  ?claim=1&executor=            가장 오래된 requested 1건을 running으로(RPC claude_seat_action_claim). 10분 넘은 running은 먼저 failed 처리
 *   PATCH { id, status: done|failed, before_tier?, after_tier?, error?, executor }   결과 반영. done이면 claude_org_members.seat_tier 갱신
 */

const NO_STORE = { "Cache-Control": "no-store" };
const isExecutor = (req: NextRequest) => verifyIngestToken(req.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN);
const STATUSES = new Set<string>(["requested", "running", "done", "failed", "cancelled"]);

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  if (sp.get("claim") === "1") {
    if (!isExecutor(request)) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers: NO_STORE });
    // 실행기가 죽어 running으로 남은 행은 10분 뒤 실패 처리해 다음 요청을 막지 않는다
    await admin.from("claude_seat_actions").update({ status: "failed", finished_at: new Date().toISOString(), error: "실행기 재시작(10분 초과)" })
      .eq("status", "running").lt("started_at", new Date(Date.now() - 600_000).toISOString());
    const r = await admin.rpc("claude_seat_action_claim", { p_executor: (sp.get("executor") ?? "unknown").slice(0, 80) });
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500, headers: NO_STORE });
    const row = (Array.isArray(r.data) ? r.data[0] : null) ?? null;
    return NextResponse.json({ row }, { headers: NO_STORE });
  }

  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const email = (sp.get("email") ?? "").trim().toLowerCase();
  const org = (sp.get("org") ?? "").trim();
  const status = sp.get("status") ?? "";
  const limit = Math.min(1000, Math.max(1, Number(sp.get("limit") ?? 200) || 200));
  let q = admin.from("claude_seat_actions").select("*").order("requested_at", { ascending: false }).limit(limit);
  if (email) q = q.eq("email", email);
  if (org && org !== "all") q = q.eq("org_id", org);
  if (STATUSES.has(status)) q = q.eq("status", status);
  const [rows, ex] = await Promise.all([q, admin.from("claude_seat_executor").select("*").eq("id", "default").maybeSingle()]);
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });
  return NextResponse.json({ rows: rows.data ?? [], executor: ex.error ? null : ex.data ?? null }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const parsed = parseRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const [org, member, open] = await Promise.all([
    admin.from("claude_orgs").select("id").eq("id", input.org_id).maybeSingle(),
    admin.from("claude_org_members").select("status, seat_tier").eq("org_id", input.org_id).eq("email", input.email).maybeSingle(),
    admin.from("claude_seat_actions").select("id").eq("org_id", input.org_id).eq("email", input.email).in("status", ["requested", "running"]).limit(1),
  ]);
  if (!org.data) return NextResponse.json({ error: "모르는 Claude 조직입니다." }, { status: 404 });
  const problem = checkRequest(input, member.data ?? null, (open.data?.length ?? 0) > 0);
  if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status });

  const ins = await admin.from("claude_seat_actions").insert({ ...input, requested_by: auth.userId, requested_by_email: auth.email ?? "" }).select("*").single();
  if (ins.error) {
    // 부분 유니크 인덱스에 걸리면(동시 클릭) 409
    const dup = ins.error.code === "23505";
    return NextResponse.json({ error: dup ? "이미 대기·실행 중인 요청이 있습니다." : ins.error.message }, { status: dup ? 409 : 500 });
  }
  const row = ins.data as SeatAction;
  await logAudit(admin, request, { userId: auth.userId, userEmail: auth.email, action: input.action === "unassign" ? "시트 해제 요청" : "시트 할당 요청", category: "usage", detail: { action_id: row.id, org_id: row.org_id, email: row.email, action: row.action, target_tier: row.target_tier } });
  return NextResponse.json({ row }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  const cur = await admin.from("claude_seat_actions").select("*").eq("id", id).maybeSingle();
  if (!cur.data) return NextResponse.json({ error: "요청이 없습니다." }, { status: 404 });
  const row = cur.data as SeatAction;
  if (!canTransition(row.status, "cancelled")) return NextResponse.json({ error: `취소할 수 없는 상태입니다(${row.status}).` }, { status: 409 });
  const upd = await admin.from("claude_seat_actions").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", id).eq("status", "requested").select("*").maybeSingle();
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  if (!upd.data) return NextResponse.json({ error: "이미 실행이 시작됐습니다." }, { status: 409 });
  await logAudit(admin, request, { userId: auth.userId, userEmail: auth.email, action: "시트 작업 취소", category: "usage", detail: { action_id: id, org_id: row.org_id, email: row.email, action: row.action } });
  return NextResponse.json({ row: upd.data });
}

export async function PATCH(request: NextRequest) {
  if (!isExecutor(request)) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers: NO_STORE });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const b = (await request.json().catch(() => null)) as { id?: unknown; status?: unknown; before_tier?: unknown; after_tier?: unknown; error?: unknown; executor?: unknown } | null;
  const id = typeof b?.id === "string" ? b.id : "";
  const status = b?.status === "done" || b?.status === "failed" ? (b.status as SeatActionStatus) : null;
  if (!id || !status) return NextResponse.json({ error: "id와 status(done|failed)가 필요합니다." }, { status: 400, headers: NO_STORE });

  const cur = await admin.from("claude_seat_actions").select("*").eq("id", id).maybeSingle();
  if (!cur.data) return NextResponse.json({ error: "요청이 없습니다." }, { status: 404, headers: NO_STORE });
  const row = cur.data as SeatAction;
  if (!canTransition(row.status, status)) return NextResponse.json({ error: `${row.status}에서 ${status}로 바꿀 수 없습니다.` }, { status: 409, headers: NO_STORE });

  const s = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const before = b?.before_tier == null ? null : normalizeTier(b.before_tier);
  const after = b?.after_tier == null ? null : normalizeTier(b.after_tier);
  const upd = await admin.from("claude_seat_actions")
    .update({ status, finished_at: new Date().toISOString(), before_tier: before, after_tier: after, error: status === "failed" ? s(b?.error, 500) ?? "실패" : null, executor: s(b?.executor, 80) })
    .eq("id", id).eq("status", "running").select("*").maybeSingle();
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500, headers: NO_STORE });
  if (!upd.data) return NextResponse.json({ error: "이미 끝난 요청입니다." }, { status: 409, headers: NO_STORE });

  if (status === "done" && after) {
    await admin.from("claude_org_members").update({ seat_tier: after }).eq("org_id", row.org_id).eq("email", row.email);
  }
  const what = row.action === "unassign" ? "시트 해제" : "시트 할당";
  await logAudit(admin, request, {
    userId: row.requested_by, userEmail: row.requested_by_email,
    action: status === "done" ? `${what} 완료` : `${what} 실패`, category: "usage",
    detail: { action_id: id, org_id: row.org_id, email: row.email, action: row.action, target_tier: row.target_tier, before_tier: before, after_tier: after, error: status === "failed" ? s(b?.error, 500) : undefined },
  });
  return NextResponse.json({ row: upd.data }, { headers: NO_STORE });
}
```

- [ ] **Step 2: heartbeat 라우트 작성**

```ts
// frontend/src/app/api/admin/claude-usage/seat-actions/heartbeat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import os from "node:os";

export const runtime = "nodejs";

/** PUT { logged_in, note?, host, version } — 관리자 Mac 실행기 하트비트(claude_seat_executor 행 1개, Bearer 수집 토큰) */
export async function PUT(request: NextRequest) {
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const b = (await request.json().catch(() => null)) as { logged_in?: unknown; note?: unknown; host?: unknown; version?: unknown } | null;
  const s = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const { error } = await c.admin.from("claude_seat_executor").upsert({
    id: "default", last_seen_at: new Date().toISOString(), logged_in: b?.logged_in === true,
    note: s(b?.note, 200), host: s(b?.host, 80) ?? os.hostname(), version: s(b?.version, 40),
  }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 3: 타입·린트**

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | grep -v "validator.ts\|normalize.ts" | grep error; npx eslint src/app/api/admin/claude-usage/seat-actions`
Expected: 출력 없음

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/admin/claude-usage/seat-actions
git commit -m "feat(claude-usage): 시트 요청 API(관리자 생성·취소·이력, 실행기 claim·결과·하트비트)"
```

---

### Task 5: 멤버 표 API에 티어 덮어쓰기·요청 요약·실행기 첨부

**Files:**
- Modify: `frontend/src/app/api/admin/claude-usage/members/route.ts:1-12` (헤더 주석·import), `:86-90` (`withTeam` 뒤)

**Interfaces:**
- Consumes: `overlaySeat`, `summarize` (Task 3), 타입 `SeatAction`·`SeatExecutor` (Task 1).
- Produces: 응답 `{ imports, rows: (Row & { seat_action: SeatActionSummary | null })[], period, executor: SeatExecutor | null }`. 행의 `seat_tier`는 `claude_org_members`(active) 값이 있으면 그 값.

- [ ] **Step 1: import 추가**

파일 상단 `import { selectAll } from "@/lib/work-metrics/common";` 아래에:

```ts
import { overlaySeat, summarize } from "@/lib/claude-usage/seat-actions";
import type { SeatAction, SeatExecutor } from "@/types/claude-seat";
```

헤더 주석 마지막 줄(` * office_turns(...) …`) 뒤에 한 줄 추가:

```ts
 * 행의 seat_tier는 claude_org_members(active, 매일 갱신 + 시트 작업 완료 시 즉시 갱신)가 있으면 그 값으로 덮고, seat_action(대기·실행 중 또는 24시간 안의 마지막 요청)과 executor(실행기 하트비트)를 붙인다.
```

- [ ] **Step 2: `withTeam` 계산 뒤, `return NextResponse.json({ imports: all, rows: withTeam, period });`를 다음으로 바꾼다**

```ts
  // 시트 작업: claude_org_members 티어로 덮고(CSV는 최대 하루 낡음), 요청 요약·실행기 상태를 붙인다. 표가 없거나 실패해도 표는 내려준다
  const orgIds = [...new Set(withTeam.map((r) => String(r.org_id)))];
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [om, acts, ex] = orgIds.length
    ? await Promise.all([
        admin.from("claude_org_members").select("org_id, email, seat_tier").in("org_id", orgIds).eq("status", "active").limit(2000),
        admin.from("claude_seat_actions").select("*").in("org_id", orgIds).or(`status.in.(requested,running),requested_at.gte.${since}`).order("requested_at", { ascending: false }).limit(2000),
        admin.from("claude_seat_executor").select("*").eq("id", "default").maybeSingle(),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: null, error: null }];
  if (om.error) console.warn("[claude-usage] org_members 조인 실패:", om.error.message);
  if (acts.error) console.warn("[claude-usage] seat_actions 조인 실패:", acts.error.message);
  type SeatRow = { org_id: string; email: string; seat_tier: string };
  const rowsOut = overlaySeat(
    withTeam as unknown as SeatRow[],
    (om.error ? [] : om.data ?? []) as { org_id: string; email: string; seat_tier: string | null }[],
    summarize((acts.error ? [] : acts.data ?? []) as SeatAction[], new Date()),
  );
  const executor = (ex.error ? null : ex.data ?? null) as SeatExecutor | null;
  return NextResponse.json({ imports: all, rows: rowsOut, period, executor });
```

- [ ] **Step 3: 타입·린트·전체 테스트**

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | grep -v "validator.ts\|normalize.ts" | grep error; npx eslint src/app/api/admin/claude-usage/members/route.ts; npm test 2>&1 | tail -6`
Expected: 새 오류 없음, 테스트는 기존 실패 1개(`marketing-email-network.test.ts`) 외 모두 통과

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/admin/claude-usage/members/route.ts
git commit -m "feat(claude-usage): 멤버 표에 claude_org_members 티어·시트 요청 요약·실행기 상태 첨부"
```

---

### Task 6: 실행기(관리자 Mac) — 순수 라이브러리·본체·로그인 래퍼

**Files:**
- Create: `frontend/scripts/lib/claude-seat.mjs`
- Create: `frontend/scripts/claude-seat-executor.mjs`
- Create: `frontend/scripts/claude-seat-login.sh` (실행 권한)
- Test: `frontend/src/lib/__tests__/claude-seat-executor-lib.test.ts`

**Interfaces:**
- Consumes: Task 4 API 계약(claim·PATCH·heartbeat), `TIER_TO_API`(Task 2와 같은 값).
- Produces: `frontend/scripts/lib/claude-seat.mjs` exports `TIER_TO_API`, `findMember(payload, email)`, `parseEnv(text)`, `readToken(paths)`; 실행기 CLI `node scripts/claude-seat-executor.mjs [--login] [--once]`, 환경 `CLAUDE_OTEL_INGEST_TOKEN`·`APP_URL`(기본 `https://inje-playground.vercel.app`)·`SEAT_PROFILE_DIR`(기본 `~/.claude-seat/profile`)·`SEAT_HEADLESS`(기본 `1`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-seat-executor-lib.test.ts
import { describe, expect, it } from "vitest";
import { TIER_TO_API } from "@/lib/claude-usage/seat-tier";
// 실행기는 TS를 못 읽으므로 같은 규칙을 .mjs에 따로 갖는다 — 여기서 대조한다
import { TIER_TO_API as MJS_TIER_TO_API, findMember, parseEnv } from "../../../scripts/lib/claude-seat.mjs";

describe("claude-seat.mjs", () => {
  it("티어 매핑 표가 TS와 같다", () => {
    expect(MJS_TIER_TO_API).toEqual(TIER_TO_API);
  });
  it("멤버 응답이 배열·{members}·{data} 어느 모양이어도 이메일로 찾고, 없으면 null", () => {
    const m = { account: { uuid: "u-1", email_address: "Kim@Innogrid.com", full_name: "김" }, role: "user", seat_tier: "team_standard" };
    expect(findMember([m], "kim@innogrid.com")).toEqual({ uuid: "u-1", seat_tier: "team_standard", role: "user" });
    expect(findMember({ members: [m] }, " KIM@innogrid.com ")).toEqual({ uuid: "u-1", seat_tier: "team_standard", role: "user" });
    expect(findMember({ data: [m] }, "kim@innogrid.com")?.uuid).toBe("u-1");
    expect(findMember([{ role: "user" }], "kim@innogrid.com")).toBeNull();
    expect(findMember(null, "kim@innogrid.com")).toBeNull();
    expect(findMember("oops", "kim@innogrid.com")).toBeNull();
  });
  it("env 파일에서 따옴표·주석을 벗기고 키를 읽는다", () => {
    expect(parseEnv('# c\nCLAUDE_OTEL_INGEST_TOKEN="abc"\nAPP_URL=https://x\n\nBAD\n')).toEqual({ CLAUDE_OTEL_INGEST_TOKEN: "abc", APP_URL: "https://x" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-seat-executor-lib.test.ts`
Expected: FAIL — `Failed to resolve import "../../../scripts/lib/claude-seat.mjs"`

- [ ] **Step 3: 순수 라이브러리 작성**

```js
// frontend/scripts/lib/claude-seat.mjs
// 시트 실행기의 순수 부분 — 브라우저·네트워크 없음(vitest가 직접 import해 TS와 대조한다)
import fs from "node:fs";

/** DB 표기 → claude.ai API 값. src/lib/claude-usage/seat-tier.ts의 TIER_TO_API와 같아야 한다 */
export const TIER_TO_API = { Standard: "team_standard", Premium: "team_tier_1", Unassigned: "unassigned" };

/** GET /api/organizations/<org>/members 응답(배열 또는 {members}|{data})에서 이메일로 멤버를 찾는다 */
export function findMember(payload, email) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.members) ? payload.members : Array.isArray(payload?.data) ? payload.data : [];
  const want = String(email ?? "").trim().toLowerCase();
  for (const m of list) {
    const a = m?.account ?? m;
    const got = String(a?.email_address ?? a?.email ?? "").trim().toLowerCase();
    if (got && got === want) return { uuid: String(a?.uuid ?? m?.uuid ?? m?.id ?? ""), seat_tier: String(m?.seat_tier ?? ""), role: String(m?.role ?? "") };
  }
  return null;
}

/** KEY=value 줄만 읽는다(따옴표 제거, # 주석·빈 줄·잘못된 줄 무시) */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
}

/** 환경변수 → 파일 순서로 토큰을 찾는다 */
export function readToken(paths, env = process.env) {
  if (env.CLAUDE_OTEL_INGEST_TOKEN) return env.CLAUDE_OTEL_INGEST_TOKEN.trim();
  for (const p of paths) {
    try {
      const v = parseEnv(fs.readFileSync(p, "utf8")).CLAUDE_OTEL_INGEST_TOKEN;
      if (v) return v;
    } catch { /* 다음 후보 */ }
  }
  return null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-seat-executor-lib.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 실행기 본체 작성**

```js
#!/usr/bin/env node
// frontend/scripts/claude-seat-executor.mjs
// Claude 시트 할당·해제 실행기 — 관리자 Mac에서 상시 실행(launchd com.innogrid.claude-seat-executor).
//   node scripts/claude-seat-executor.mjs            # 15초마다 대기 요청을 claim해 claude.ai에 반영
//   node scripts/claude-seat-executor.mjs --login    # 창을 띄워 소유자 계정으로 직접 로그인(1회). 창을 닫으면 끝
//   node scripts/claude-seat-executor.mjs --once     # 한 바퀴만(점검용)
// 환경: CLAUDE_OTEL_INGEST_TOKEN(없으면 frontend/.env.local → ~/.config/inje-playground/work-metrics.env),
//       APP_URL(기본 프로덕션), SEAT_PROFILE_DIR(기본 ~/.claude-seat/profile), SEAT_HEADLESS(기본 1)
// 서버 계약: GET ?claim=1 → {row}, PATCH {id,status,before_tier,after_tier,error,executor}, PUT heartbeat — src/app/api/admin/claude-usage/seat-actions
// 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md §6
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TIER_TO_API, findMember, readToken } from "./lib/claude-seat.mjs";

const VERSION = "2026-09-29.1";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = (process.env.APP_URL || "https://inje-playground.vercel.app").replace(/\/$/, "");
const PROFILE = process.env.SEAT_PROFILE_DIR || path.join(os.homedir(), ".claude-seat", "profile");
const HEADLESS = process.env.SEAT_HEADLESS !== "0";
const POLL_MS = 15_000;
const HOST = os.hostname();
const API = `${APP_URL}/api/admin/claude-usage/seat-actions`;

const log = (obj) => console.log(JSON.stringify({ t: new Date().toISOString(), ...obj }));

const token = readToken([path.join(HERE, "..", ".env.local"), path.join(os.homedir(), ".config", "inje-playground", "work-metrics.env")]);
if (!token) { console.error("CLAUDE_OTEL_INGEST_TOKEN이 없습니다(env 또는 frontend/.env.local)"); process.exit(1); }

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 본문이 JSON이 아님 */ }
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${json?.error ?? text.slice(0, 200)}`);
  return json;
}
const heartbeat = (logged_in, note) => api("PUT", `${API}/heartbeat`, { logged_in, note: note ?? null, host: HOST, version: VERSION }).catch((e) => log({ heartbeat_error: e.message }));

async function launch(headless) {
  fs.mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  const opts = { headless, args: ["--disable-blink-features=AutomationControlled"], viewport: { width: 1280, height: 900 } };
  try { return await chromium.launchPersistentContext(PROFILE, { ...opts, channel: "chrome" }); } // 로컬 Chrome 우선
  catch { return chromium.launchPersistentContext(PROFILE, opts); }                                  // 없으면 Playwright Chromium
}

/** claude.ai 페이지 안에서 fetch — 소유자 세션 쿠키가 붙는다. 반환은 {status, json|text} */
async function claudeFetch(page, url, init) {
  return page.evaluate(async ({ url, init }) => {
    const r = await fetch(url, { credentials: "include", ...init });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text: text.slice(0, 200) };
  }, { url, init: init ?? {} });
}

async function ensureClaudePage(ctx) {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  if (!page.url().startsWith("https://claude.ai")) await page.goto("https://claude.ai/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const r = await claudeFetch(page, "/api/organizations");
  return { page, loggedIn: r.status === 200 };
}

async function process1(page, row) {
  const org = row.org_id;
  const target = row.action === "unassign" ? "unassigned" : TIER_TO_API[row.target_tier];
  if (!target) return { status: "failed", error: `모르는 목표 티어: ${row.target_tier}` };
  const before = await claudeFetch(page, `/api/organizations/${org}/members?limit=500`);
  if (before.status !== 200) return { status: "failed", error: `claude.ai members ${before.status}: ${before.text}` };
  const m = findMember(before.json, row.email);
  if (!m || !m.uuid) return { status: "failed", error: "조직에서 멤버를 찾지 못했습니다" };
  const put = await claudeFetch(page, `/api/organizations/${org}/members/${m.uuid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seat_tier: target }) });
  if (put.status < 200 || put.status >= 300) return { status: "failed", before_tier: m.seat_tier, error: `claude.ai ${put.status}: ${put.text}` };
  const after = await claudeFetch(page, `/api/organizations/${org}/members?limit=500`);
  const m2 = after.status === 200 ? findMember(after.json, row.email) : null;
  if (!m2) return { status: "failed", before_tier: m.seat_tier, error: "적용 뒤 멤버를 다시 읽지 못했습니다" };
  if (m2.seat_tier !== target) return { status: "failed", before_tier: m.seat_tier, after_tier: m2.seat_tier, error: `적용 후 티어가 ${m2.seat_tier}입니다` };
  return { status: "done", before_tier: m.seat_tier, after_tier: m2.seat_tier };
}

async function loop(ctx, once) {
  for (;;) {
    let page, loggedIn;
    try { ({ page, loggedIn } = await ensureClaudePage(ctx)); }
    catch (e) { log({ page_error: e.message }); await heartbeat(false, `페이지 오류: ${e.message.slice(0, 120)}`); if (once) return; await sleep(POLL_MS); continue; }
    if (!loggedIn) { log({ logged_in: false }); await heartbeat(false, "로그인 필요 — claude-seat-login.sh 실행"); if (once) return; await sleep(POLL_MS); continue; }
    await heartbeat(true, null);
    let claimed;
    try { claimed = await api("GET", `${API}?claim=1&executor=${encodeURIComponent(HOST)}`); }
    catch (e) { log({ claim_error: e.message }); if (once) return; await sleep(POLL_MS); continue; }
    const row = claimed?.row;
    if (row) {
      log({ claim: row.id, org: row.org_id, email: row.email, action: row.action, target: row.target_tier });
      let result;
      try { result = await process1(page, row); } catch (e) { result = { status: "failed", error: `실행기 예외: ${e.message.slice(0, 200)}` }; }
      try { await api("PATCH", API, { id: row.id, executor: HOST, ...result }); } catch (e) { log({ patch_error: e.message }); }
      log({ done: row.id, ...result });
      continue; // 대기 요청이 더 있을 수 있으니 바로 다음 claim
    }
    if (once) return;
    await sleep(POLL_MS);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const login = process.argv.includes("--login");
  const once = process.argv.includes("--once");
  const ctx = await launch(login ? false : HEADLESS);
  if (login) {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://claude.ai/login", { waitUntil: "domcontentloaded" });
    console.log("브라우저에서 소유자 계정으로 로그인(Cloudflare 확인 포함)한 뒤 창을 닫으세요. 프로필:", PROFILE);
    await new Promise((r) => ctx.on("close", r));
    return;
  }
  log({ start: VERSION, host: HOST, app: APP_URL, headless: HEADLESS });
  const stop = async () => { log({ stop: true }); await ctx.close().catch(() => {}); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  await loop(ctx, once);
  await ctx.close().catch(() => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 6: 로그인 래퍼 작성**

```bash
#!/usr/bin/env bash
# frontend/scripts/claude-seat-login.sh — claude.ai 소유자 계정 로그인(1회). 전용 브라우저 프로필 ~/.claude-seat/profile 에 세션이 남는다.
# 실행기(claude-seat-executor.mjs, launchd com.innogrid.claude-seat-executor)가 이 프로필로 시트 할당·해제를 claude.ai에 반영한다.
# 로그인·Cloudflare 확인은 사용자가 직접 한다. 창을 닫으면 끝. 런북 docs/claude-usage.md §9
set -e
cd "$(dirname "$0")/.."
exec node scripts/claude-seat-executor.mjs --login
```

Run: `chmod +x frontend/scripts/claude-seat-login.sh frontend/scripts/claude-seat-executor.mjs`

- [ ] **Step 7: 구문 검사와 린트**

Run: `cd frontend && node --check scripts/claude-seat-executor.mjs && node --check scripts/lib/claude-seat.mjs && npx eslint scripts/claude-seat-executor.mjs scripts/lib/claude-seat.mjs src/lib/__tests__/claude-seat-executor-lib.test.ts && npx vitest run src/lib/__tests__/claude-seat-executor-lib.test.ts`
Expected: 오류 없음, 테스트 PASS (3)

(eslint이 `scripts/`를 무시하도록 설정돼 있으면 출력이 없어도 통과로 본다.)

- [ ] **Step 8: Commit**

```bash
git add frontend/scripts/lib/claude-seat.mjs frontend/scripts/claude-seat-executor.mjs frontend/scripts/claude-seat-login.sh frontend/src/lib/__tests__/claude-seat-executor-lib.test.ts
git commit -m "feat(claude-usage): 시트 할당·해제 실행기(관리자 Mac, playwright-core)와 로그인 래퍼"
```

---

### Task 7: 화면 — 행 액션·확인 대화상자·상태 배지·실행기 칩·이력 Sheet

**Files:**
- Create: `frontend/src/components/admin/claude-usage/SeatActionCell.tsx`
- Create: `frontend/src/components/admin/claude-usage/SeatHistorySheet.tsx`
- Create: `frontend/src/components/admin/claude-usage/SeatExecutorChip.tsx`
- Modify: `frontend/src/components/admin/claude-usage/MembersCsvTab.tsx` (import, `Row`·`MembersResponse` 타입, 상태·재조회, 액션 열, 칩·이력 버튼)

**Interfaces:**
- Consumes: 응답 `rows[].seat_tier`·`rows[].seat_action`·`executor` (Task 5), API POST·DELETE·GET (Task 4), `executorState`·`hasSeat`·`normalizeTier`, 타입 (Task 1). UI: `@/components/ui/alert-dialog`(`AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle`), `@/components/ui/dropdown-menu`(`DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger`), `@/components/ui/sheet`(`Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription`), `SortableTable`·`Column`(`./SortableTable`), `fmtDateTime`(`./format`).
- Produces: `SeatActionCell({ row, orgName, onChanged })`, `SeatHistorySheet({ open, onOpenChange, email, orgName })`, `SeatExecutorChip({ executor })`.

- [ ] **Step 1: SeatExecutorChip 작성**

```tsx
// frontend/src/components/admin/claude-usage/SeatExecutorChip.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { executorState } from "@/lib/claude-usage/seat-actions";
import type { SeatExecutor } from "@/types/claude-seat";

/** 관리자 Mac 실행기 상태 — 하트비트 60초 초과면 꺼짐, 세션 없으면 로그인 필요 */
export default function SeatExecutorChip({ executor }: { executor: SeatExecutor | null | undefined }) {
  const s = executorState(executor ?? null, new Date());
  const cls = s.level === "ok" ? "border-emerald-300 text-emerald-700 dark:text-emerald-300" : s.level === "login" ? "border-red-300 text-red-700 dark:text-red-300" : "border-amber-300 text-amber-700 dark:text-amber-300";
  return <Badge variant="outline" className={`text-[10px] font-normal ${cls}`} title={executor ? `${executor.host ?? ""} ${executor.version ?? ""} ${executor.note ?? ""}`.trim() : "실행기가 한 번도 보고하지 않았습니다"}>{s.text}</Badge>;
}
```

- [ ] **Step 2: SeatActionCell 작성**

```tsx
// frontend/src/components/admin/claude-usage/SeatActionCell.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Loader2 } from "lucide-react";
import { hasSeat } from "@/lib/claude-usage/aggregate";
import { normalizeTier } from "@/lib/claude-usage/seat-tier";
import type { SeatActionSummary } from "@/types/claude-seat";

export interface SeatActionRow { org_id: string; email: string; name: string; seat_tier: string; seat_action: SeatActionSummary | null }
type Pending = { action: "unassign"; target: null } | { action: "assign"; target: "Standard" | "Premium" };

/**
 * 멤버 행의 시트 액션 — 시트 있으면 "해제", 미할당이면 "할당 ▾". 대기·실행 중이면 배지(+취소), 최근 결과가 있으면 결과 배지 뒤에 버튼.
 * 요청은 POST /api/admin/claude-usage/seat-actions, 실제 반영은 관리자 Mac 실행기가 한다(스펙 §6·§7).
 */
export default function SeatActionCell({ row, orgName, onChanged }: { row: SeatActionRow; orgName: string; onChanged: () => void }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = normalizeTier(row.seat_tier);
  const a = row.seat_action;

  const submit = async () => {
    if (!pending) return;
    setBusy(true); setError(null);
    const r = await fetch("/api/admin/claude-usage/seat-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: row.org_id, email: row.email, action: pending.action, target_tier: pending.target }) });
    const j = await r.json().catch(() => ({}) as { error?: string });
    setBusy(false);
    if (!r.ok) { setError(j.error ?? `HTTP ${r.status}`); return; }
    setPending(null); onChanged();
  };
  const cancel = async () => {
    if (!a) return;
    setBusy(true);
    const r = await fetch(`/api/admin/claude-usage/seat-actions?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) onChanged();
  };

  const open = a && (a.status === "requested" || a.status === "running");
  const label = (s: SeatActionSummary) => (s.action === "unassign" ? "해제" : `할당 → ${s.target_tier}`);

  return (
    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
      {open && a ? (
        <>
          <Badge variant="secondary" className="text-[10px]">{a.status === "running" ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />적용 중 · {label(a)}</> : <>대기 · {label(a)}</>}</Badge>
          {a.status === "requested" && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy} onClick={cancel}>취소</Button>}
        </>
      ) : (
        <>
          {a && a.status === "done" && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 dark:text-emerald-300" title={`${label(a)} 완료`}>완료</Badge>}
          {a && a.status === "failed" && <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 dark:text-red-300" title={a.error ?? "실패"}>실패</Badge>}
          {hasSeat(current) ? (
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => { setError(null); setPending({ action: "unassign", target: null }); }}>해제</Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="h-6 px-2 text-xs">할당 ▾</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => { setError(null); setPending({ action: "assign", target: "Standard" }); }}>Standard</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setError(null); setPending({ action: "assign", target: "Premium" }); }}>Premium</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(o) => { if (!o && !busy) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.action === "unassign" ? "시트 해제" : "시트 할당"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p><b>{row.name || row.email}</b> ({row.email}) · {orgName}</p>
                <p>현재 <b>{current}</b> → <b>{pending?.action === "unassign" ? "Unassigned" : pending?.target}</b></p>
                <p className="text-muted-foreground">{pending?.action === "unassign"
                  ? "회수한 시트는 다른 멤버에게 줄 수 있습니다. 구매 좌석 수는 바뀌지 않으며 claude.ai 결제 설정에서 줄여야 합니다. 멤버는 조직에 남습니다."
                  : "빈 좌석이 없으면 실패합니다. 좌석 추가는 claude.ai 결제 설정에서 합니다."}</p>
                <p className="text-muted-foreground">요청은 관리자 Mac의 실행기가 보통 1분 안에 claude.ai에 반영합니다. 실행기가 꺼져 있으면 켜질 때까지 대기합니다.</p>
                {error && <p className="text-destructive">{error}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void submit(); }}>{busy ? "요청 중…" : "확인"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: SeatHistorySheet 작성**

```tsx
// frontend/src/components/admin/claude-usage/SeatHistorySheet.tsx
"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import SortableTable, { type Column } from "./SortableTable";
import { fmtDateTime } from "./format";
import type { SeatAction } from "@/types/claude-seat";

const STATUS_KO: Record<SeatAction["status"], string> = { requested: "대기", running: "적용 중", done: "완료", failed: "실패", cancelled: "취소" };

/** 시트 작업 이력 — email이 있으면 그 사람만, 없으면 전체(검색 가능). GET /api/admin/claude-usage/seat-actions */
export default function SeatHistorySheet({ open, onOpenChange, email, orgName }: { open: boolean; onOpenChange: (o: boolean) => void; email: string | null; orgName: Map<string, string> }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SeatAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null); setError(null); setQ(email ?? "");
    fetch(`/api/admin/claude-usage/seat-actions?limit=500${email ? `&email=${encodeURIComponent(email)}` : ""}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j.rows as SeatAction[]; })
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [open, email]);

  const s = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !s || r.email.includes(s) || r.requested_by_email.toLowerCase().includes(s));
  const columns: Column<SeatAction>[] = [
    { key: "at", header: "요청 시각", value: (r) => r.requested_at, render: (r) => fmtDateTime(r.requested_at) },
    { key: "org", header: "조직", value: (r) => orgName.get(r.org_id) ?? r.org_id, render: (r) => <Badge variant="outline" className="text-[10px]">{orgName.get(r.org_id) ?? r.org_id.slice(0, 8)}</Badge> },
    { key: "email", header: "대상", value: (r) => r.email },
    { key: "action", header: "작업", value: (r) => r.action, render: (r) => (r.action === "unassign" ? "해제" : `할당 → ${r.target_tier}`) },
    { key: "tier", header: "전 → 후", value: (r) => `${r.before_tier ?? ""}→${r.after_tier ?? ""}`, render: (r) => (r.before_tier || r.after_tier ? `${r.before_tier ?? "?"} → ${r.after_tier ?? "?"}` : <span className="text-muted-foreground">—</span>) },
    { key: "by", header: "요청자", value: (r) => r.requested_by_email },
    { key: "status", header: "상태", value: (r) => r.status, render: (r) => <span title={r.error ?? (r.finished_at ? fmtDateTime(r.finished_at) : "")} className={r.status === "failed" ? "text-destructive" : r.status === "done" ? "text-emerald-700 dark:text-emerald-300" : ""}>{STATUS_KO[r.status]}</span> },
    { key: "err", header: "사유", value: (r) => r.error ?? "", render: (r) => <span className="text-muted-foreground">{r.error ?? ""}</span> },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>시트 작업 이력{email ? ` — ${email}` : ""}</SheetTitle>
          <SheetDescription>해제·할당 요청과 실행 결과. 삭제되지 않고 남습니다(감사 로그에도 기록).</SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-3 px-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="대상·요청자 이메일 검색" className="h-8 w-[260px] text-xs" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {rows === null && !error ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <SortableTable rows={shown} columns={columns} rowKey={(r) => r.id} defaultSort={{ key: "at", dir: "desc" }} emptyText="이력이 없습니다." />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: MembersCsvTab 수정**

(a) import에 추가:

```tsx
import SeatActionCell from "./SeatActionCell";
import SeatHistorySheet from "./SeatHistorySheet";
import SeatExecutorChip from "./SeatExecutorChip";
import { History } from "lucide-react";
import type { SeatActionSummary, SeatExecutor } from "@/types/claude-seat";
```

(b) 타입 두 줄을 바꾼다:

```tsx
type Row = MemberActivityRow & { org_id: string; import_id: string; employee_name?: string | null; team?: string | null; parent_unit?: string | null; headquarters?: string | null; division?: string | null; code_prompts?: number; code_prompts_auto?: number; office_turns?: number; seat_action?: SeatActionSummary | null };
interface MembersResponse { imports: CsvImport[]; rows: Row[]; period: { start: string; end: string } | null; executor?: SeatExecutor | null }
```

(c) `const [idleOnly, setIdleOnly] = useState(false);` 아래에 상태 추가:

```tsx
  const [history, setHistory] = useState<{ open: boolean; email: string | null }>({ open: false, email: null });
  const pollUntil = useRef(0);
  /** 요청·취소 직후 5초 간격으로 다시 읽는다(대기·실행 중이 남아 있고 2분이 안 지났으면) */
  const onSeatChanged = () => { pollUntil.current = Date.now() + 120_000; setTick((t) => t + 1); };
  useEffect(() => {
    const pending = (data?.rows ?? []).some((r) => r.seat_action && (r.seat_action.status === "requested" || r.seat_action.status === "running"));
    if (!pending || Date.now() > pollUntil.current) return;
    const id = setTimeout(() => setTick((t) => t + 1), 5_000);
    return () => clearTimeout(id);
  }, [data]);
```

`import { useEffect, useMemo, useState } from "react";`를 `import { useEffect, useMemo, useRef, useState } from "react";`로 바꾼다.

(d) `columns` 배열의 `spend` 항목 뒤에 액션 열을 추가한다:

```tsx
    { key: "seat_action", header: "시트 작업", align: "right", value: (r) => r.seat_action?.status ?? "", render: (r) => <SeatActionCell row={{ org_id: r.org_id, email: r.email, name: r.name, seat_tier: r.seat_tier, seat_action: r.seat_action ?? null }} orgName={orgName.get(r.org_id) ?? r.org_id.slice(0, 8)} onChanged={onSeatChanged} /> },
```

그리고 `user` 열의 render를 이메일 아래 "이력" 링크가 붙도록 바꾼다:

```tsx
    { key: "user", header: "사용자 (Claude)", value: (r) => r.email, render: (r) => (<div><div className="font-medium">{r.name || r.email}</div>{r.name && <div className="text-muted-foreground">{r.email}</div>}<button type="button" className="text-[10px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setHistory({ open: true, email: r.email })}>이력</button></div>) },
```

(e) "마지막 CSV 수집" 문단의 `<span className="ml-2 text-xs …">— 수집·업로드는 …</span>` 뒤에 칩과 이력 버튼을 추가한다:

```tsx
        <span className="ml-2 inline-flex items-center gap-2 align-middle">
          <SeatExecutorChip executor={data?.executor} />
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setHistory({ open: true, email: null })}><History className="mr-1 h-3.5 w-3.5" />시트 작업 이력</Button>
        </span>
```

(f) 컴포넌트 반환 JSX의 맨 마지막(닫는 `</div>` 바로 앞)에:

```tsx
      <SeatHistorySheet open={history.open} onOpenChange={(o) => setHistory((h) => ({ ...h, open: o }))} email={history.email} orgName={orgName} />
```

(g) 표 제목 문구를 "멤버 활동 (N명) — 노는 시트는 붉게 표시"에서 "멤버 활동 (N명) — 노는 시트는 붉게 표시 · 시트 열의 티어는 멤버 스냅샷 기준"으로 바꾸지 않는다(문구 유지). 대신 `tier` 열에 hint를 붙인다:

```tsx
    { key: "tier", header: "시트", hint: "claude.ai 멤버 스냅샷(매일 09:05, 시트 작업 완료 시 즉시)의 티어. 없으면 CSV의 티어", value: (r) => r.seat_tier, render: (r) => (hasSeat(r.seat_tier) ? r.seat_tier : <span className="text-muted-foreground">미할당</span>) },
```

- [ ] **Step 5: 타입·린트·전체 테스트**

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | grep -v "validator.ts\|normalize.ts" | grep error; npx eslint src/components/admin/claude-usage; npm test 2>&1 | tail -6`
Expected: 새 오류 없음(React Compiler 린트가 `useRef` 사용을 지적하면 `pollUntil`을 `useState`로 바꾸고 `onSeatChanged`에서 set), 기존 실패 1개 외 통과

- [ ] **Step 6: 로컬 렌더 확인(선택)**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: 빌드 성공

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/admin/claude-usage/SeatActionCell.tsx frontend/src/components/admin/claude-usage/SeatHistorySheet.tsx frontend/src/components/admin/claude-usage/SeatExecutorChip.tsx frontend/src/components/admin/claude-usage/MembersCsvTab.tsx
git commit -m "feat(claude-usage): 멤버 표 시트 해제·할당 버튼, 확인 대화상자, 상태 배지, 실행기 칩, 작업 이력"
```

---

### Task 8: 운영 — 배포, launchd 등록, 런북·규칙, 실제 1건 확인 (컨트롤러 + 사용자)

**Files:**
- Create(로컬, 저장소 밖): `~/.claude/hooks/claude-seat-executor.sh`, `~/Library/LaunchAgents/com.innogrid.claude-seat-executor.plist`
- Modify(로컬): `~/.claude/hooks/claude-jobs` (`PRIMARY_LOG`·`PURPOSE`에 한 줄씩)
- Modify: `docs/claude-usage.md` (새 절 "## 9. 시트 할당·해제 (2026-09-29)"), `docs/launchd-jobs.md` (작업 목록 표에 한 줄), `.claude/rules/claude-usage-cost.md` (API·테이블 bullet)

- [ ] **Step 1: 배포(컨트롤러)** — Task 1 SQL이 운영에 적용돼 있어야 한다.

```bash
git fetch origin && git push origin main
cd frontend && NODE_OPTIONS= vercel deploy --prod --yes
NODE_OPTIONS= vercel inspect https://inje-playground.vercel.app | grep url   # innogrid-playground-… 새 배포인지
```

- [ ] **Step 2: launchd 래퍼·plist(컨트롤러, 로컬)**

`~/.claude/hooks/claude-seat-executor.sh`:

```bash
#!/usr/bin/env bash
# 상시: Claude 시트 할당·해제 실행기 (launchd: com.innogrid.claude-seat-executor, KeepAlive)
# - 전제: ./frontend/scripts/claude-seat-login.sh로 소유자 계정 로그인 1회(프로필 ~/.claude-seat/profile), Mac 깨어 있음
# - 로그: ~/Library/Logs/claude-seat-executor.log · 상태: claude-jobs status · 런북 docs/claude-usage.md §9
# - 수동 중지/재개: claude-jobs disable seat / claude-jobs enable seat
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="${LANG:-en_US.UTF-8}"
cd "$HOME/Repos/inje-playground/frontend"
exec node scripts/claude-seat-executor.mjs
```

`~/Library/LaunchAgents/com.innogrid.claude-seat-executor.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.innogrid.claude-seat-executor</string>
	<key>ProgramArguments</key>
	<array>
		<string>/Users/seunguk.kang/.claude/hooks/claude-seat-executor.sh</string>
	</array>
	<key>KeepAlive</key>
	<true/>
	<key>RunAtLoad</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>30</integer>
	<key>StandardOutPath</key>
	<string>/Users/seunguk.kang/Library/Logs/claude-seat-executor.log</string>
	<key>StandardErrorPath</key>
	<string>/Users/seunguk.kang/Library/Logs/claude-seat-executor.log</string>
</dict>
</plist>
```

```bash
chmod +x ~/.claude/hooks/claude-seat-executor.sh
plutil -lint ~/Library/LaunchAgents/com.innogrid.claude-seat-executor.plist
```

`~/.claude/hooks/claude-jobs`의 `PRIMARY_LOG`에 `"com.innogrid.claude-seat-executor": f"{HOME}/Library/Logs/claude-seat-executor.log",`, `PURPOSE`에 `"com.innogrid.claude-seat-executor": "Claude 시트 할당·해제 실행기(상시, claude.ai 소유자 프로필)",` 추가.

- [ ] **Step 3: 로그인(사용자)** — 컨트롤러가 안내하고 기다린다.

```bash
./frontend/scripts/claude-seat-login.sh
```

브라우저 창에서 소유자 계정으로 로그인(Cloudflare 확인 포함) 후 창을 닫는다.

- [ ] **Step 4: 점검 1바퀴 → 등록(컨트롤러)**

```bash
cd frontend && node scripts/claude-seat-executor.mjs --once     # {"logged_in":false}가 아니고 heartbeat 오류가 없어야 한다
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.innogrid.claude-seat-executor.plist
claude-jobs status | grep -A 3 seat-executor
```

화면 `/admin/claude-chat` 채팅·Cowork 탭의 칩이 "실행기 정상 · 방금"인지 확인. 헤드리스에서 로그인이 안 잡히면 `SEAT_HEADLESS=0`로 래퍼를 고쳐 창을 띄운 채 돌린다(런북에 적는다).

- [ ] **Step 5: 실제 1건 확인(사용자 지정 멤버)** — 컨트롤러가 사용자에게 대상 1명을 묻고, 화면에서 해제 → 1분 안에 "완료"·티어 Unassigned → claude.ai 멤버 화면에서 확인 → 다시 할당(원래 티어) → 이력 Sheet에 2건. 실패하면 사유(`error`)와 실행기 로그로 원인을 본다.

- [ ] **Step 6: 런북·규칙(구현자 또는 컨트롤러)**

`docs/claude-usage.md` 끝에:

```markdown
## 9. 시트 할당·해제 (2026-09-29)

채팅·Cowork 탭 멤버 표에서 관리자가 **해제**(시트 → Unassigned, 멤버는 남음)·**할당**(Standard/Premium)을 누르면 `claude_seat_actions`에 요청이 남고, 관리자 Mac의 실행기가 15초 안에 claim해 claude.ai 내부 API(`PUT /api/organizations/<org>/members/<uuid>` `{seat_tier}`)로 반영한다. 공식 API는 없다(도움말은 화면 조작만 안내). 스펙 `docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md`.

- **설치(1회)**: SQL `docs/sql/2026-09-29-claude-seat-actions.sql` → `./frontend/scripts/claude-seat-login.sh`로 소유자 로그인(프로필 `~/.claude-seat/profile`) → launchd `com.innogrid.claude-seat-executor`(`~/.claude/hooks/claude-seat-executor.sh`, KeepAlive) 등록. 상태는 `claude-jobs status`, 로그 `~/Library/Logs/claude-seat-executor.log`(한 줄 JSON).
- **화면**: 행의 해제/할당 → 확인 → 배지 대기 → 적용 중 → 완료/실패(사유 title). 상단 칩: 실행기 정상 / 꺼짐(하트비트 60초 초과) / 로그인 필요. "시트 작업 이력" 버튼 = 전체, 행의 "이력" = 그 사람. 완료되면 `claude_org_members.seat_tier`가 바로 바뀌고 다음 09:05 스냅샷이 claude.ai 원본으로 덮는다.
- **이력·감사**: `claude_seat_actions`는 삭제하지 않는다. 감사 로그(category usage): 시트 해제/할당 요청, 취소, 완료, 실패(완료·실패도 요청자 명의).
- **장애**: "로그인 필요" → 로그인 스크립트 다시 실행(세션 만료). 실행기 꺼짐 → `claude-jobs enable seat` 또는 Mac 깨우기; 대기 요청은 켜지면 처리된다. `running`이 10분 넘으면 서버가 "실행기 재시작(10분 초과)"로 실패 처리. 헤드리스에서 Cloudflare에 걸리면 래퍼에 `SEAT_HEADLESS=0`. 구매 좌석 수는 바뀌지 않는다 — claude.ai 결제 설정에서 조정.
```

`docs/launchd-jobs.md` 작업 목록 표에:

```markdown
| `com.innogrid.claude-seat-executor` | 상시(KeepAlive) | Claude 시트 할당·해제 요청을 claude.ai에 반영(전용 브라우저 프로필, 15초 폴링) | `~/.claude/hooks/claude-seat-executor.sh` → `frontend/scripts/claude-seat-executor.mjs` | `~/Library/Logs/claude-seat-executor.log` |
```

`.claude/rules/claude-usage-cost.md`의 API 목록 bullet(`/api/admin/claude-usage/{summary,…}`)에 `seat-actions`·`seat-actions/heartbeat`를 넣고, 테이블 bullet 끝에 `claude_seat_actions(시트 해제·할당 요청·실행 이력, 삭제 안 함)·claude_seat_executor(관리자 Mac 실행기 하트비트) — SQL 2026-09-29-claude-seat-actions.sql, 런북 docs/claude-usage.md §9`를 추가한다.

- [ ] **Step 7: Commit·푸시(문서)**

```bash
git add docs/claude-usage.md docs/launchd-jobs.md .claude/rules/claude-usage-cost.md
git commit -m "docs(claude-usage): 시트 할당·해제 런북·launchd 작업·규칙"
git push origin main
```
