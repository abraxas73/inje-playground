I have everything I need. Here is the finalized Phase 1 implementation plan with all critique issues resolved.

---

# Phase 1 — 기반 + 응답 수집 + 첫 설문 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. 각 Task는 순서대로 독립 실행 가능하며, 모든 스텝은 체크박스(`- [ ]`)로 추적한다. 코드 스텝은 블록 전문을 그대로 적용하고, 테스트 스텝은 명령어와 기대 출력을 그대로 검증한다. TDD 순서(실패 테스트 → 실패 확인 → 최소 구현 → 통과 → 커밋)를 엄수한다.

**Goal**: 로그인(user 이상) 사용자가 `/survey/claude-code-productivity`에서 첫 설문(25문항)에 응답하고, `submit_survey_response` RPC를 통해 DB에 원자적으로 저장하며, 재진입 시 중복 제출이 차단되는 것까지 독립 출하 가능한 수직 슬라이스를 완성한다.

**Architecture**: Next.js 16 App Router(React 19) `"use client"` 페이지 + API Route Handler가 `createServerSupabase()`로 Supabase에 접근. 쓰기는 `submit_survey_response` RPC 단일 경로. 정규화 4테이블(`surveys`/`survey_questions`/`survey_responses`/`survey_answers`) + RLS + SECURITY DEFINER RPC. 순수 로직(`lib/survey.ts`)은 Vitest TDD, 응답 폼 플로우는 Playwright E2E.

**Tech Stack**: Next.js 16.1.6, React 19.2, TypeScript strict, Tailwind CSS 4, shadcn/ui(radix-ui), lucide-react, Supabase(@supabase/ssr), Vitest + @testing-library/react + jsdom, @playwright/test.

## Global Constraints

- config 키는 **snake_case만** 사용 (`min_label`/`allow_other`/`analysis_metric`/`top_box`/`segment`/`target`/`option_midpoints`/`before_label`/`after_label`).
- 쓰기는 **`submit_survey_response` RPC 단일 경로**, 집계는 **`get_survey_aggregate` RPC 단일 경로**. 클라 TS 집계 금지(CSV 후처리만 허용).
- row 타입은 전부 `updated_at` 포함, timestamptz는 ISO `string`, nullable은 `| null`.
- 분석 출력에 `respondent_user_id`/`respondent_hash` **절대 미포함**. CSV는 `includeIdentity=true`만 예외.
- n<5 세그먼트 셀 **마스킹**, pre_post Δ는 **pairwise만**(결측 0/평균대체 금지).
- admin 게이트는 `app/api/admin/chat-history/route.ts` 패턴 그대로(`auth.getUser()` 없음 → 401, `user_profiles.role !== "admin"` → 403). 동적 라우트는 `{ params }: { params: Promise<{...}> }` + `await params` 필수.
- 신규 차트/dnd/엑셀 라이브러리 **0개로 시작**(CSS/SVG + HTML5 native drag + BOM CSV).
- `is_user` 단일 정의 = `isUserResponse()`(S0Q3='사용한 적 없음'=`"never"` OR S0Q4='거의 사용 안 함'=`"rarely"` → 비사용자). **value-key 기준** 단일 출처. Phase1 Task6에 1회만 정의하고 **이후 어떤 Phase에서도 재정의·라벨 기준 재구현 금지**(중복 정의 금지). 후속 Phase의 `survey-metrics.ts` 확장은 신규 산식 함수만 append하고 `isUserResponse` 블록은 손대지 않는다.
- **진입점 소유권 분리**: 홈 카드(`page.tsx`)·역할 접근(`roles.ts`)·미들웨어 화이트리스트(`supabase-middleware.ts`)는 Phase1 Task8이 소유. **어드민 네비(`admin/layout.tsx`의 `ADMIN_NAV` + `ClipboardList` import)는 설문 관리 페이지가 생성되는 Phase2 Task5가 단독 소유**(Phase1에서는 미수정 — 데드 링크·Edit 앵커 충돌 방지).
- `private.is_admin()`은 `auth.uid()` DEFAULT를 보유 → **인자 없이** 호출. `public.update_updated_at()` 재사용.
- 마이그레이션은 `mcp__supabase__apply_migration` 적용 후 `mcp__supabase__get_advisors(security)` 확인. 적용 전 트랜잭션 내 실행→롤백 사전검증.
- 모든 npm 명령은 `frontend/` 기준. 작업 루트 = `/Users/seunguk.kang/Repos/inje-playground/frontend`.
- 첫 설문: `slug=claude-code-productivity`, `access_mode=authenticated`, `is_anonymous=true`, 25문항(S0:7·S1:5·S2:4·S3:3·S4:6).

---

## Task 0: 테스트 인프라 셋업 (Vitest + Playwright)

독립 산출물: `npm run test`가 샘플 단위테스트를 통과하고, `npm run test:e2e`가 Playwright 설정을 인식한다.

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/vitest.config.ts`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/vitest.setup.ts`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/playwright.config.ts`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/__tests__/sample.test.ts`
- Modify `/Users/seunguk.kang/Repos/inje-playground/frontend/package.json` (scripts + devDeps)
- Modify `/Users/seunguk.kang/Repos/inje-playground/frontend/tsconfig.json` (exclude e2e, types)

**Interfaces**
- Produces: `npm run test`(vitest run), `npm run test:watch`, `npm run test:e2e`(playwright test).
- Consumes: 없음.

**Steps**

- [ ] devDependencies 설치
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm install -D vitest@^3 @vitest/coverage-v8@^3 @vitejs/plugin-react@^5 jsdom@^25 @testing-library/react@^16 @testing-library/jest-dom@^6 @playwright/test@^1
  ```
  기대 출력: `added N packages` 종료코드 0.

- [ ] Playwright Chromium 브라우저 설치
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npx playwright install chromium
  ```
  기대 출력: chromium 다운로드 완료.

- [ ] `vitest.config.ts` 작성
  ```typescript
  import { defineConfig } from "vitest/config";
  import react from "@vitejs/plugin-react";
  import { fileURLToPath } from "node:url";

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      exclude: ["node_modules", "e2e", ".next"],
      coverage: {
        provider: "v8",
        include: ["src/lib/survey.ts", "src/lib/survey-metrics.ts", "src/lib/survey-csv.ts"],
      },
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  });
  ```

- [ ] `vitest.setup.ts` 작성
  ```typescript
  import "@testing-library/jest-dom/vitest";
  ```

- [ ] `playwright.config.ts` 작성
  ```typescript
  import { defineConfig, devices } from "@playwright/test";

  export default defineConfig({
    testDir: "./e2e",
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,
    retries: 0,
    workers: 1,
    reporter: [["list"]],
    use: {
      baseURL: "http://localhost:3003",
      trace: "on-first-retry",
    },
    projects: [
      { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ],
    webServer: {
      command: "npm run dev -- --port 3003",
      url: "http://localhost:3003",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  });
  ```

- [ ] 샘플 통과 테스트 작성 `src/lib/__tests__/sample.test.ts`
  ```typescript
  import { describe, it, expect } from "vitest";

  describe("test infra", () => {
    it("runs vitest", () => {
      expect(1 + 1).toBe(2);
    });
  });
  ```

- [ ] `package.json` scripts 추가
  ```json
  {
    "name": "coneplus-workshop",
    "version": "0.1.0",
    "private": true,
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "eslint",
      "test": "vitest run",
      "test:watch": "vitest",
      "test:e2e": "playwright test"
    }
  }
  ```
  (기존 `dependencies`/`devDependencies` 블록은 그대로 두고 `scripts`만 위와 같이 교체. install 스텝이 devDeps를 이미 추가했다.)

- [ ] `tsconfig.json`의 `exclude`에 e2e/playwright 제외 추가 (tsc가 Playwright 전용 타입을 빌드 대상에 넣지 않도록)
  ```json
  "exclude": ["node_modules", "e2e", "playwright.config.ts"]
  ```
  (`compilerOptions.types`는 추가하지 않는다. vitest globals는 `vitest/config`가 `vitest.config.ts`에서만 쓰이고, 테스트 파일은 `import { describe, it, expect } from "vitest"`로 명시 import하므로 전역 타입 오염이 없다.)

- [ ] 단위테스트 통과 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run test
  ```
  기대 출력: `✓ src/lib/__tests__/sample.test.ts (1 test)` / `Test Files  1 passed`.

- [ ] 타입/린트 무결성 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build && npm run lint
  ```
  기대 출력: 빌드 성공, 린트 에러 0.

- [ ] 커밋
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && git checkout -b feat/survey-system && git add frontend/vitest.config.ts frontend/vitest.setup.ts frontend/playwright.config.ts frontend/src/lib/__tests__/sample.test.ts frontend/package.json frontend/package-lock.json frontend/tsconfig.json && git commit -m "test: Vitest+Playwright 인프라 도입

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 1: DB 마이그레이션 `survey_system_init`

독립 산출물: 4테이블 + RLS + 트리거 + 보조함수 + 2 RPC가 라이브 DB에 반영되고 security advisor가 통과한다.

**Files**
- Create(인메모리 SQL) 마이그레이션 `survey_system_init` (apply_migration으로 직접 적용; 파일 산출물 없음, 스펙 §3.2 + §3.3 합본)

**Interfaces**
- Produces: 테이블 `public.surveys/survey_questions/survey_responses/survey_answers`, 함수 `private.survey_response_is_writable(uuid)`, `public.submit_survey_response(uuid,jsonb,jsonb,text)→uuid`, `public.get_survey_aggregate(uuid,jsonb)→jsonb`.
- Consumes: 기존 `private.is_admin(uuid DEFAULT auth.uid())`, `public.update_updated_at()`.

**Steps**

- [ ] 기존 스키마 사전 점검 (테이블/함수 충돌 없음 확인)
  ```
  mcp__supabase__list_tables  (schemas: ["public"])
  ```
  기대: `surveys` 등 4테이블 미존재.

- [ ] 사전검증: 트랜잭션 내 실행→롤백. `mcp__supabase__execute_sql`로 아래를 1회 실행(BEGIN … ROLLBACK)하여 문법/제약 위반 0 확인. (RPC 본문 포함 전체를 한 번 실행 후 롤백)
  ```sql
  begin;
  -- (다음 스텝의 마이그레이션 SQL 전문을 여기에 붙여 실행)
  rollback;
  ```
  기대: 에러 0, 영구 반영 0.

- [ ] 마이그레이션 적용: `mcp__supabase__apply_migration` (name: `survey_system_init`) 에 아래 SQL 전문을 적용
  ```sql
  -- 1. surveys
  create table if not exists public.surveys (
    id           uuid primary key default gen_random_uuid(),
    slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
    title        text not null,
    description  text,
    status       text not null default 'draft' check (status in ('draft','open','closed')),
    access_mode  text not null default 'authenticated' check (access_mode in ('authenticated','public')),
    is_anonymous boolean not null default false,
    opens_at     timestamptz,
    closes_at    timestamptz,
    created_by   uuid references auth.users(id) on delete set null,
    sort_order   integer not null default 0,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
  );
  create index if not exists surveys_status_idx     on public.surveys (status);
  create index if not exists surveys_sort_order_idx  on public.surveys (sort_order);
  create index if not exists surveys_access_mode_idx on public.surveys (access_mode);

  -- 2. survey_questions
  create table if not exists public.survey_questions (
    id          uuid primary key default gen_random_uuid(),
    survey_id   uuid not null references public.surveys(id) on delete cascade,
    section     text,
    order_index integer not null default 0,
    type        text not null check (type in ('single_choice','multi_choice','scale','nps','number','text','textarea','pre_post_scale')),
    title       text not null,
    description text,
    required    boolean not null default false,
    config      jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
  );
  create index if not exists survey_questions_survey_id_idx    on public.survey_questions (survey_id);
  create index if not exists survey_questions_survey_order_idx on public.survey_questions (survey_id, order_index);

  -- 3. survey_responses
  create table if not exists public.survey_responses (
    id                 uuid primary key default gen_random_uuid(),
    survey_id          uuid not null references public.surveys(id) on delete cascade,
    respondent_user_id uuid references auth.users(id) on delete set null,
    respondent_hash    text,
    is_complete        boolean not null default false,
    submitted_at       timestamptz,
    meta               jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
  );
  create index if not exists survey_responses_survey_id_idx on public.survey_responses (survey_id);
  create index if not exists survey_responses_user_id_idx   on public.survey_responses (respondent_user_id);
  create index if not exists survey_responses_hash_idx      on public.survey_responses (respondent_hash);
  create unique index if not exists survey_responses_unique_user
    on public.survey_responses (survey_id, respondent_user_id)
    where respondent_user_id is not null;
  create unique index if not exists survey_responses_unique_hash
    on public.survey_responses (survey_id, respondent_hash)
    where respondent_user_id is null and respondent_hash is not null;

  -- 4. survey_answers
  create table if not exists public.survey_answers (
    id           uuid primary key default gen_random_uuid(),
    response_id  uuid not null references public.survey_responses(id) on delete cascade,
    question_id  uuid not null references public.survey_questions(id) on delete cascade,
    value_text   text,
    value_number numeric,
    value_json   jsonb,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (response_id, question_id)
  );
  create index if not exists survey_answers_response_id_idx on public.survey_answers (response_id);
  create index if not exists survey_answers_question_id_idx on public.survey_answers (question_id);

  -- 5. 보조 함수
  create or replace function private.survey_response_is_writable(p_response_id uuid)
  returns boolean language sql stable security definer
  set search_path = public, pg_temp as $$
    select exists (
      select 1 from public.survey_responses r
      join public.surveys s on s.id = r.survey_id
      where r.id = p_response_id
        and s.status = 'open'
        and r.is_complete = false
        and (r.respondent_user_id = auth.uid()
          or (r.respondent_user_id is null and s.access_mode = 'public'))
    );
  $$;

  -- 6. updated_at 트리거
  drop trigger if exists surveys_updated_at on public.surveys;
  create trigger surveys_updated_at before update on public.surveys
    for each row execute function public.update_updated_at();
  drop trigger if exists survey_questions_updated_at on public.survey_questions;
  create trigger survey_questions_updated_at before update on public.survey_questions
    for each row execute function public.update_updated_at();
  drop trigger if exists survey_responses_updated_at on public.survey_responses;
  create trigger survey_responses_updated_at before update on public.survey_responses
    for each row execute function public.update_updated_at();
  drop trigger if exists survey_answers_updated_at on public.survey_answers;
  create trigger survey_answers_updated_at before update on public.survey_answers
    for each row execute function public.update_updated_at();

  -- 7. RLS + grant
  alter table public.surveys          enable row level security;
  alter table public.survey_questions enable row level security;
  alter table public.survey_responses enable row level security;
  alter table public.survey_answers   enable row level security;
  grant select on public.surveys, public.survey_questions to anon, authenticated;
  grant insert on public.survey_responses, public.survey_answers to anon;
  grant select, insert, update, delete
    on public.surveys, public.survey_questions, public.survey_responses, public.survey_answers
    to authenticated;

  -- 8. RLS 정책
  drop policy if exists surveys_select on public.surveys;
  create policy surveys_select on public.surveys for select to authenticated
    using (status = 'open' or private.is_admin());
  drop policy if exists surveys_select_public on public.surveys;
  create policy surveys_select_public on public.surveys for select to anon
    using (status = 'open' and access_mode = 'public');
  drop policy if exists surveys_insert on public.surveys;
  create policy surveys_insert on public.surveys for insert to authenticated
    with check (private.is_admin());
  drop policy if exists surveys_update on public.surveys;
  create policy surveys_update on public.surveys for update to authenticated
    using (private.is_admin()) with check (private.is_admin());
  drop policy if exists surveys_delete on public.surveys;
  create policy surveys_delete on public.surveys for delete to authenticated
    using (private.is_admin());

  drop policy if exists survey_questions_select on public.survey_questions;
  create policy survey_questions_select on public.survey_questions for select to authenticated
    using (private.is_admin()
      or exists (select 1 from public.surveys s where s.id = survey_id and s.status = 'open'));
  drop policy if exists survey_questions_select_public on public.survey_questions;
  create policy survey_questions_select_public on public.survey_questions for select to anon
    using (exists (select 1 from public.surveys s
                   where s.id = survey_id and s.status = 'open' and s.access_mode = 'public'));
  drop policy if exists survey_questions_write on public.survey_questions;
  create policy survey_questions_write on public.survey_questions for all to authenticated
    using (private.is_admin()) with check (private.is_admin());

  drop policy if exists survey_responses_select on public.survey_responses;
  create policy survey_responses_select on public.survey_responses for select to authenticated
    using (respondent_user_id = auth.uid() or private.is_admin());
  drop policy if exists survey_responses_insert on public.survey_responses;
  create policy survey_responses_insert on public.survey_responses for insert to authenticated
    with check (respondent_user_id = auth.uid()
      and exists (select 1 from public.surveys s where s.id = survey_id and s.status = 'open'));
  drop policy if exists survey_responses_insert_public on public.survey_responses;
  create policy survey_responses_insert_public on public.survey_responses for insert to anon
    with check (respondent_user_id is null
      and exists (select 1 from public.surveys s
                  where s.id = survey_id and s.status = 'open' and s.access_mode = 'public'));
  drop policy if exists survey_responses_update on public.survey_responses;
  create policy survey_responses_update on public.survey_responses for update to authenticated
    using ((respondent_user_id = auth.uid() and is_complete = false) or private.is_admin())
    with check ((respondent_user_id = auth.uid() and is_complete in (true, false)) or private.is_admin());
  drop policy if exists survey_responses_delete on public.survey_responses;
  create policy survey_responses_delete on public.survey_responses for delete to authenticated
    using (private.is_admin());

  drop policy if exists survey_answers_select on public.survey_answers;
  create policy survey_answers_select on public.survey_answers for select to authenticated
    using (private.is_admin()
      or exists (select 1 from public.survey_responses r
                 where r.id = response_id and r.respondent_user_id = auth.uid()));
  drop policy if exists survey_answers_insert on public.survey_answers;
  create policy survey_answers_insert on public.survey_answers for insert to authenticated
    with check (private.survey_response_is_writable(response_id));
  drop policy if exists survey_answers_insert_public on public.survey_answers;
  create policy survey_answers_insert_public on public.survey_answers for insert to anon
    with check (private.survey_response_is_writable(response_id));
  drop policy if exists survey_answers_update on public.survey_answers;
  create policy survey_answers_update on public.survey_answers for update to authenticated
    using (private.survey_response_is_writable(response_id) or private.is_admin())
    with check (private.survey_response_is_writable(response_id) or private.is_admin());
  drop policy if exists survey_answers_delete on public.survey_answers;
  create policy survey_answers_delete on public.survey_answers for delete to authenticated
    using (private.is_admin() or private.survey_response_is_writable(response_id));

  -- 9. RPC: submit_survey_response (유일 쓰기 경로)
  create or replace function public.submit_survey_response(
    p_survey_id uuid, p_answers jsonb, p_meta jsonb default '{}'::jsonb,
    p_respondent_hash text default null
  ) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
  declare
    v_survey   public.surveys;
    v_uid      uuid := auth.uid();
    v_resp_id  uuid;
    v_ans      jsonb;
  begin
    select * into v_survey from public.surveys where id = p_survey_id;
    if v_survey.id is null or v_survey.status <> 'open' then
      raise exception 'survey_not_open';
    end if;
    if v_survey.access_mode = 'authenticated' and v_uid is null then
      raise exception 'auth_required';
    end if;

    if v_uid is not null then
      insert into public.survey_responses(survey_id, respondent_user_id, is_complete, meta)
        values (p_survey_id, v_uid, false, coalesce(p_meta,'{}'::jsonb))
      on conflict (survey_id, respondent_user_id) where respondent_user_id is not null
        do update set meta = excluded.meta, updated_at = now()
      returning id into v_resp_id;
      if exists (select 1 from public.survey_responses
                 where id = v_resp_id and is_complete = true) then
        raise exception 'already_submitted';
      end if;
    else
      insert into public.survey_responses(survey_id, respondent_hash, is_complete, meta)
        values (p_survey_id, p_respondent_hash, false, coalesce(p_meta,'{}'::jsonb))
      on conflict (survey_id, respondent_hash) where respondent_user_id is null and respondent_hash is not null
        do nothing
      returning id into v_resp_id;
      if v_resp_id is null then raise exception 'already_submitted'; end if;
    end if;

    for v_ans in select * from jsonb_array_elements(p_answers) loop
      insert into public.survey_answers(response_id, question_id, value_text, value_number, value_json)
        values (v_resp_id, (v_ans->>'question_id')::uuid,
                v_ans->>'value_text',
                nullif(v_ans->>'value_number','')::numeric,
                v_ans->'value_json')
      on conflict (response_id, question_id)
        do update set value_text = excluded.value_text,
                      value_number = excluded.value_number,
                      value_json = excluded.value_json, updated_at = now();
    end loop;

    update public.survey_responses
      set is_complete = true, submitted_at = now(), updated_at = now()
      where id = v_resp_id;
    return v_resp_id;
  end;
  $$;
  grant execute on function public.submit_survey_response(uuid, jsonb, jsonb, text) to authenticated, anon;

  -- 10. RPC: get_survey_aggregate (스텁 — Phase 2/3에서 본문 채움)
  create or replace function public.get_survey_aggregate(
    p_survey_id uuid, p_segments jsonb default '[]'::jsonb
  ) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
  declare v_out jsonb;
  begin
    if not private.is_admin() then raise exception 'forbidden'; end if;
    select jsonb_build_object('survey_id', p_survey_id, 'questions', '[]'::jsonb)
      into v_out;
    return v_out;
  end;
  $$;
  grant execute on function public.get_survey_aggregate(uuid, jsonb) to authenticated;
  ```

- [ ] security advisor 검토
  ```
  mcp__supabase__get_advisors  (type: "security")
  ```
  기대: 신규 테이블/함수 관련 ERROR 0. (SECURITY DEFINER 함수 2건은 `set search_path` 명시로 경고 회피. 잔여 WARN은 사유 기록.)

- [ ] 적용 확인
  ```
  mcp__supabase__list_tables  (schemas: ["public"])
  ```
  기대: `surveys`, `survey_questions`, `survey_responses`, `survey_answers` 존재.

- [ ] 마이그레이션은 DB 측 적용물이므로 코드 커밋 없음. 진행 메모만 남긴다(다음 Task로).

---

## Task 2: `types/survey.ts` 타입 계약

독립 산출물: 동결 타입 계약 전체가 컴파일된다.

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/types/survey.ts`

**Interfaces**
- Produces: 계약 §1 전체(열거형/row 인터페이스/DTO/AnswerValue 유니온/Submit·Aggregate DTO).
- Consumes: 없음.

**Steps**

- [ ] `src/types/survey.ts` 작성 (계약 §1 전문)
  ```typescript
  // =====================================================================
  // 설문 시스템 타입 계약 (스펙 §4.5). snake_case 통일. 모든 row 인터페이스 updated_at 포함.
  // =====================================================================

  export type SurveyStatus = "draft" | "open" | "closed";
  export type SurveyAccessMode = "authenticated" | "public";
  export type QuestionType =
    | "single_choice"
    | "multi_choice"
    | "scale"
    | "nps"
    | "number"
    | "text"
    | "textarea"
    | "pre_post_scale";

  export interface QuestionOption {
    value: string;
    label: string;
  }

  export interface QuestionConfig {
    options?: QuestionOption[];
    allow_other?: boolean;
    min?: number;
    max?: number;
    step?: number;
    min_label?: string;
    mid_label?: string;
    max_label?: string;
    before_label?: string;
    after_label?: string;
    unit?: string;
    placeholder?: string;
    max_length?: number;
    segment?: boolean;
    ordinal?: boolean;
    analysis_metric?: string;
    top_box?: string[];
    target?: number;
    option_midpoints?: Record<string, number>;
  }

  export interface Survey {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    status: SurveyStatus;
    access_mode: SurveyAccessMode;
    is_anonymous: boolean;
    opens_at: string | null;
    closes_at: string | null;
    created_by: string | null;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }

  export interface SurveyQuestion {
    id: string;
    survey_id: string;
    section: string | null;
    order_index: number;
    type: QuestionType;
    title: string;
    description: string | null;
    required: boolean;
    config: QuestionConfig;
    created_at: string;
    updated_at: string;
  }

  export interface SurveyResponse {
    id: string;
    survey_id: string;
    respondent_user_id: string | null;
    respondent_hash: string | null;
    is_complete: boolean;
    submitted_at: string | null;
    meta: ResponseMeta;
    created_at: string;
    updated_at: string;
  }

  export interface SurveyAnswer {
    id: string;
    response_id: string;
    question_id: string;
    value_text: string | null;
    value_number: number | null;
    value_json: unknown | null;
    created_at: string;
    updated_at: string;
  }

  export interface ResponseMeta {
    duration_sec?: number;
    ua?: string;
    [k: string]: unknown;
  }

  export interface SurveyWithQuestions extends Survey {
    questions: SurveyQuestion[];
  }

  export interface PrePostValue {
    before: number | null;
    after: number | null;
  }
  export type AnswerValue =
    | { type: "single_choice"; value: string | null }
    | { type: "multi_choice"; value: string[] }
    | { type: "scale"; value: number | null }
    | { type: "nps"; value: number | null }
    | { type: "number"; value: number | null }
    | { type: "text"; value: string }
    | { type: "textarea"; value: string }
    | { type: "pre_post_scale"; value: PrePostValue };

  export interface AnswerColumns {
    question_id: string;
    value_text: string | null;
    value_number: number | null;
    value_json: unknown | null;
  }
  export interface SubmitResponsePayload {
    answers: AnswerColumns[];
    meta?: ResponseMeta;
    respondent_hash?: string | null;
  }

  export interface OptionCount {
    value: string;
    label: string;
    n: number;
    pct: number;
  }
  export interface ScaleStats {
    n: number;
    mean: number | null;
    median: number | null;
    sd: number | null;
    min: number | null;
    max: number | null;
    distribution: { value: number; n: number }[];
    top_box_pct?: number | null;
  }
  export interface NpsStats {
    n: number;
    score: number | null;
    promoters_pct: number;
    passives_pct: number;
    detractors_pct: number;
  }
  export interface PrePostStats {
    n_pairwise: number;
    before_mean: number | null;
    after_mean: number | null;
    delta_mean: number | null;
    improvement_pct: number | null;
    before_distribution: { value: number; n: number }[];
    after_distribution: { value: number; n: number }[];
  }
  export interface NumberStats {
    n: number;
    mean: number | null;
    median: number | null;
    sum: number | null;
    min: number | null;
    max: number | null;
    mean_trimmed: number | null;
    zero_pct: number | null;
    unit: string | null;
  }

  export type QuestionAggregate = {
    question_id: string;
    section: string | null;
    order_index: number;
    type: QuestionType;
    title: string;
    n: number;
    masked: boolean;
  } & (
    | { type: "single_choice"; options: OptionCount[] }
    | { type: "multi_choice"; options: OptionCount[]; respondent_n: number }
    | { type: "scale"; stats: ScaleStats }
    | { type: "nps"; stats: NpsStats }
    | { type: "number"; stats: NumberStats }
    | { type: "pre_post_scale"; stats: PrePostStats }
    | { type: "text" | "textarea"; text_n: number }
  );

  export interface SegmentFilter {
    question_id: string;
    values: string[];
  }
  export interface SurveyResultSummary {
    survey_id: string;
    total_responses: number;
    complete_rate: number;
    avg_duration_sec: number | null;
    segments_applied: SegmentFilter[];
    questions: QuestionAggregate[];
  }
  ```

- [ ] 타입 컴파일 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build
  ```
  기대: 빌드 성공(미사용 타입은 export라 에러 없음).

- [ ] 커밋
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/types/survey.ts && git commit -m "feat(survey): 타입 계약 추가 (types/survey.ts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 3: `lib/survey.ts` 순수 로직 (Vitest TDD)

독립 산출물: `validateAnswer`/`answerToColumns`/`columnsToAnswer`/`emptyAnswer`/`QUESTION_TYPE_META`/`default_config_for`가 단위테스트로 검증된다.

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/__tests__/survey.test.ts`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/survey.ts`

**Interfaces**
- Consumes: `@/types/survey` (`QuestionType`, `SurveyQuestion`, `QuestionConfig`, `AnswerValue`, `AnswerColumns`, `PrePostValue`).
- Produces: 계약 §2 전체 시그니처. 저장 컨벤션 매핑표(§3.1)대로 `answerToColumns`. exclusive 옵션 규칙: `value === "none" || value === "dont_know"` 단독 선택.

> **선택 상한 처리 메모**: S4Q4의 '(최대 3개)'는 동결된 `QuestionConfig`에 `max_select` 키가 없으므로(키 집합 동결) Phase1에서는 **타이틀 안내문 기준 권고**로만 처리하고 `validateAnswer`/`MultiChoiceField`에 강제 상한을 적용하지 않는다. 강제 상한이 필요해지면 먼저 동결 계약(`QuestionConfig` 키 + §6 props)을 개정한 뒤 도입한다.

**Steps**

- [ ] 실패 테스트 작성 `src/lib/__tests__/survey.test.ts`
  ```typescript
  import { describe, it, expect } from "vitest";
  import {
    validateAnswer,
    answerToColumns,
    columnsToAnswer,
    emptyAnswer,
    default_config_for,
    QUESTION_TYPE_META,
  } from "@/lib/survey";
  import type { SurveyQuestion } from "@/types/survey";

  function q(partial: Partial<SurveyQuestion> & Pick<SurveyQuestion, "type">): SurveyQuestion {
    return {
      id: "q1",
      survey_id: "s1",
      section: "S0",
      order_index: 0,
      title: "문항",
      description: null,
      required: true,
      config: {},
      created_at: "2026-06-26T00:00:00Z",
      updated_at: "2026-06-26T00:00:00Z",
      ...partial,
    };
  }

  describe("QUESTION_TYPE_META", () => {
    it("8종 모두 정의", () => {
      const keys = Object.keys(QUESTION_TYPE_META);
      expect(keys.sort()).toEqual(
        ["multi_choice", "nps", "number", "pre_post_scale", "scale", "single_choice", "text", "textarea"].sort(),
      );
    });
    it("value_column 매핑이 저장 컨벤션과 일치", () => {
      expect(QUESTION_TYPE_META.single_choice.value_column).toBe("value_text");
      expect(QUESTION_TYPE_META.multi_choice.value_column).toBe("value_json");
      expect(QUESTION_TYPE_META.scale.value_column).toBe("value_number");
      expect(QUESTION_TYPE_META.pre_post_scale.value_column).toBe("value_json");
    });
  });

  describe("default_config_for", () => {
    it("scale 기본 1~5", () => {
      const c = default_config_for("scale");
      expect(c.min).toBe(1);
      expect(c.max).toBe(5);
    });
    it("pre_post_scale 기본 라벨", () => {
      const c = default_config_for("pre_post_scale");
      expect(c.before_label).toBe("도입 전");
      expect(c.after_label).toBe("현재");
    });
    it("single_choice 빈 옵션 배열", () => {
      expect(default_config_for("single_choice").options).toEqual([]);
    });
  });

  describe("validateAnswer — required", () => {
    it("single_choice 미선택 실패", () => {
      const r = validateAnswer(
        q({ type: "single_choice", config: { options: [{ value: "a", label: "A" }] } }),
        { type: "single_choice", value: null },
      );
      expect(r.ok).toBe(false);
      expect(r.error).toContain("필수");
    });
    it("선택형 required=false 미선택 통과", () => {
      const r = validateAnswer(
        q({ type: "single_choice", required: false, config: { options: [{ value: "a", label: "A" }] } }),
        { type: "single_choice", value: null },
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("validateAnswer — single_choice", () => {
    it("옵션 외 값 실패", () => {
      const r = validateAnswer(
        q({ type: "single_choice", config: { options: [{ value: "a", label: "A" }] } }),
        { type: "single_choice", value: "x" },
      );
      expect(r.ok).toBe(false);
    });
    it("유효 옵션 통과", () => {
      const r = validateAnswer(
        q({ type: "single_choice", config: { options: [{ value: "a", label: "A" }] } }),
        { type: "single_choice", value: "a" },
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("validateAnswer — multi_choice exclusive", () => {
    const mq = q({
      type: "multi_choice",
      config: { options: [{ value: "none", label: "없음" }, { value: "a", label: "A" }, { value: "b", label: "B" }] },
    });
    it("none 단독 통과", () => {
      expect(validateAnswer(mq, { type: "multi_choice", value: ["none"] }).ok).toBe(true);
    });
    it("none + 다른 보기 동시 선택 실패", () => {
      const r = validateAnswer(mq, { type: "multi_choice", value: ["none", "a"] });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("단독");
    });
    it("required 미선택 실패", () => {
      expect(validateAnswer(mq, { type: "multi_choice", value: [] }).ok).toBe(false);
    });
  });

  describe("validateAnswer — scale / nps / number", () => {
    it("scale 범위 밖 실패", () => {
      const r = validateAnswer(q({ type: "scale", config: { min: 1, max: 5 } }), { type: "scale", value: 6 });
      expect(r.ok).toBe(false);
    });
    it("nps 0~10 경계 통과", () => {
      expect(validateAnswer(q({ type: "nps" }), { type: "nps", value: 0 }).ok).toBe(true);
      expect(validateAnswer(q({ type: "nps" }), { type: "nps", value: 10 }).ok).toBe(true);
    });
    it("nps 11 실패", () => {
      expect(validateAnswer(q({ type: "nps" }), { type: "nps", value: 11 }).ok).toBe(false);
    });
    it("number min 미만 실패", () => {
      const r = validateAnswer(q({ type: "number", config: { min: 0 } }), { type: "number", value: -1 });
      expect(r.ok).toBe(false);
    });
    it("number 0 통과", () => {
      expect(validateAnswer(q({ type: "number", config: { min: 0 } }), { type: "number", value: 0 }).ok).toBe(true);
    });
  });

  describe("validateAnswer — textarea max_length", () => {
    it("초과 실패", () => {
      const r = validateAnswer(
        q({ type: "textarea", required: false, config: { max_length: 3 } }),
        { type: "textarea", value: "abcd" },
      );
      expect(r.ok).toBe(false);
    });
  });

  describe("validateAnswer — pre_post_scale", () => {
    const pq = q({ type: "pre_post_scale", config: { min: 1, max: 5 } });
    it("both 존재 + 범위 내 통과", () => {
      expect(validateAnswer(pq, { type: "pre_post_scale", value: { before: 2, after: 4 } }).ok).toBe(true);
    });
    it("after 누락 실패", () => {
      const r = validateAnswer(pq, { type: "pre_post_scale", value: { before: 2, after: null } });
      expect(r.ok).toBe(false);
    });
    it("before 범위 밖 실패", () => {
      const r = validateAnswer(pq, { type: "pre_post_scale", value: { before: 0, after: 4 } });
      expect(r.ok).toBe(false);
    });
  });

  describe("answerToColumns — 저장 컨벤션 §3.1", () => {
    it("single_choice → value_text", () => {
      expect(answerToColumns(q({ type: "single_choice" }), { type: "single_choice", value: "a" })).toEqual({
        question_id: "q1", value_text: "a", value_number: null, value_json: null,
      });
    });
    it("multi_choice → value_json 배열", () => {
      expect(answerToColumns(q({ type: "multi_choice" }), { type: "multi_choice", value: ["a", "c"] })).toEqual({
        question_id: "q1", value_text: null, value_number: null, value_json: ["a", "c"],
      });
    });
    it("scale → value_number", () => {
      expect(answerToColumns(q({ type: "scale" }), { type: "scale", value: 4 })).toEqual({
        question_id: "q1", value_text: null, value_number: 4, value_json: null,
      });
    });
    it("nps → value_number", () => {
      expect(answerToColumns(q({ type: "nps" }), { type: "nps", value: 9 }).value_number).toBe(9);
    });
    it("text → value_text", () => {
      expect(answerToColumns(q({ type: "text" }), { type: "text", value: "hi" }).value_text).toBe("hi");
    });
    it("pre_post_scale → value_json {before,after}", () => {
      expect(answerToColumns(q({ type: "pre_post_scale" }), { type: "pre_post_scale", value: { before: 2, after: 5 } })).toEqual({
        question_id: "q1", value_text: null, value_number: null, value_json: { before: 2, after: 5 },
      });
    });
    it("빈 값은 null 컬럼", () => {
      expect(answerToColumns(q({ type: "single_choice" }), { type: "single_choice", value: null })).toEqual({
        question_id: "q1", value_text: null, value_number: null, value_json: null,
      });
      expect(answerToColumns(q({ type: "text" }), { type: "text", value: "" }).value_text).toBe(null);
    });
  });

  describe("columnsToAnswer / emptyAnswer 왕복", () => {
    it("single_choice 왕복", () => {
      const a = answerToColumns(q({ type: "single_choice" }), { type: "single_choice", value: "a" });
      expect(columnsToAnswer(q({ type: "single_choice" }), a)).toEqual({ type: "single_choice", value: "a" });
    });
    it("pre_post_scale 왕복", () => {
      const v = { type: "pre_post_scale" as const, value: { before: 1, after: 3 } };
      const a = answerToColumns(q({ type: "pre_post_scale" }), v);
      expect(columnsToAnswer(q({ type: "pre_post_scale" }), a)).toEqual(v);
    });
    it("emptyAnswer 타입별 초기값", () => {
      expect(emptyAnswer(q({ type: "multi_choice" }))).toEqual({ type: "multi_choice", value: [] });
      expect(emptyAnswer(q({ type: "pre_post_scale" }))).toEqual({ type: "pre_post_scale", value: { before: null, after: null } });
      expect(emptyAnswer(q({ type: "text" }))).toEqual({ type: "text", value: "" });
    });
  });
  ```

- [ ] 실행해 실패 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run test -- survey.test
  ```
  기대: `Cannot find module '@/lib/survey'` 또는 export 부재로 실패.

- [ ] 최소 구현 `src/lib/survey.ts`
  ```typescript
  import type {
    QuestionType,
    SurveyQuestion,
    QuestionConfig,
    AnswerValue,
    AnswerColumns,
    PrePostValue,
  } from "@/types/survey";

  // exclusive 옵션(단독 선택 강제) value 규칙 — 시드는 이 키를 사용한다.
  const EXCLUSIVE_VALUES = new Set(["none", "dont_know"]);

  export interface QuestionTypeMeta {
    type: QuestionType;
    label: string;
    description: string;
    icon: string;
    value_column: "value_text" | "value_number" | "value_json";
    supports_options: boolean;
    supports_other: boolean;
    is_numeric: boolean;
  }

  export const QUESTION_TYPE_META: Record<QuestionType, QuestionTypeMeta> = {
    single_choice: {
      type: "single_choice", label: "객관식 단일", description: "보기 중 하나 선택",
      icon: "CircleDot", value_column: "value_text", supports_options: true, supports_other: true, is_numeric: false,
    },
    multi_choice: {
      type: "multi_choice", label: "객관식 복수", description: "보기 중 복수 선택",
      icon: "ListChecks", value_column: "value_json", supports_options: true, supports_other: true, is_numeric: false,
    },
    scale: {
      type: "scale", label: "척도(Likert)", description: "1~5 등 척도 평가",
      icon: "SlidersHorizontal", value_column: "value_number", supports_options: false, supports_other: false, is_numeric: true,
    },
    nps: {
      type: "nps", label: "NPS(0~10)", description: "추천 의향 0~10",
      icon: "Gauge", value_column: "value_number", supports_options: false, supports_other: false, is_numeric: true,
    },
    number: {
      type: "number", label: "숫자", description: "수치 입력(단위)",
      icon: "Hash", value_column: "value_number", supports_options: false, supports_other: false, is_numeric: true,
    },
    text: {
      type: "text", label: "단문", description: "한 줄 텍스트",
      icon: "Type", value_column: "value_text", supports_options: false, supports_other: false, is_numeric: false,
    },
    textarea: {
      type: "textarea", label: "장문", description: "여러 줄 텍스트",
      icon: "AlignLeft", value_column: "value_text", supports_options: false, supports_other: false, is_numeric: false,
    },
    pre_post_scale: {
      type: "pre_post_scale", label: "도입 전/현재", description: "두 시점 척도 비교",
      icon: "GitCompareArrows", value_column: "value_json", supports_options: false, supports_other: false, is_numeric: false,
    },
  };

  export function default_config_for(type: QuestionType): QuestionConfig {
    switch (type) {
      case "single_choice":
      case "multi_choice":
        return { options: [], allow_other: false };
      case "scale":
        return { min: 1, max: 5, min_label: "매우 낮음", mid_label: "보통", max_label: "매우 높음" };
      case "nps":
        return { min: 0, max: 10 };
      case "number":
        return { min: 0, unit: "" };
      case "text":
        return { placeholder: "", max_length: 200 };
      case "textarea":
        return { placeholder: "", max_length: 2000 };
      case "pre_post_scale":
        return { min: 1, max: 5, min_label: "매우 낮음", mid_label: "보통", max_label: "매우 높음", before_label: "도입 전", after_label: "현재" };
    }
  }

  export interface ValidationResult {
    ok: boolean;
    error?: string;
  }

  function isEmptyText(s: string): boolean {
    return s.trim().length === 0;
  }

  export function validateAnswer(question: SurveyQuestion, value: AnswerValue): ValidationResult {
    const cfg = question.config ?? {};
    const required = question.required;

    switch (value.type) {
      case "single_choice": {
        if (value.value === null || value.value === "") {
          return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
        }
        const opts = cfg.options ?? [];
        const known = opts.some((o) => o.value === value.value);
        if (!known && !cfg.allow_other) {
          return { ok: false, error: "허용되지 않은 선택지입니다." };
        }
        return { ok: true };
      }
      case "multi_choice": {
        const vals = value.value;
        if (vals.length === 0) {
          return required ? { ok: false, error: "최소 1개 이상 선택해 주세요." } : { ok: true };
        }
        const opts = cfg.options ?? [];
        for (const v of vals) {
          if (!opts.some((o) => o.value === v) && !cfg.allow_other) {
            return { ok: false, error: "허용되지 않은 선택지가 포함되어 있습니다." };
          }
        }
        const exclusiveSelected = vals.filter((v) => EXCLUSIVE_VALUES.has(v));
        if (exclusiveSelected.length > 0 && vals.length > 1) {
          return { ok: false, error: "해당 보기는 단독으로만 선택할 수 있습니다." };
        }
        return { ok: true };
      }
      case "scale": {
        if (value.value === null) {
          return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
        }
        const min = cfg.min ?? 1;
        const max = cfg.max ?? 5;
        if (value.value < min || value.value > max) {
          return { ok: false, error: `${min}~${max} 범위로 응답해 주세요.` };
        }
        return { ok: true };
      }
      case "nps": {
        if (value.value === null) {
          return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
        }
        if (value.value < 0 || value.value > 10 || !Number.isInteger(value.value)) {
          return { ok: false, error: "0~10 사이 정수로 응답해 주세요." };
        }
        return { ok: true };
      }
      case "number": {
        if (value.value === null) {
          return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
        }
        if (Number.isNaN(value.value)) {
          return { ok: false, error: "숫자를 입력해 주세요." };
        }
        const min = cfg.min;
        const max = cfg.max;
        if (typeof min === "number" && value.value < min) {
          return { ok: false, error: `${min} 이상 입력해 주세요.` };
        }
        if (typeof max === "number" && value.value > max) {
          return { ok: false, error: `${max} 이하로 입력해 주세요.` };
        }
        return { ok: true };
      }
      case "text":
      case "textarea": {
        if (isEmptyText(value.value)) {
          return required ? { ok: false, error: "필수 응답 문항입니다." } : { ok: true };
        }
        const maxLen = cfg.max_length;
        if (typeof maxLen === "number" && value.value.length > maxLen) {
          return { ok: false, error: `${maxLen}자 이내로 입력해 주세요.` };
        }
        return { ok: true };
      }
      case "pre_post_scale": {
        const { before, after } = value.value;
        if (before === null || after === null) {
          if (!required && before === null && after === null) return { ok: true };
          return { ok: false, error: "도입 전·현재 두 시점 모두 응답해 주세요." };
        }
        const min = cfg.min ?? 1;
        const max = cfg.max ?? 5;
        if (before < min || before > max || after < min || after > max) {
          return { ok: false, error: `${min}~${max} 범위로 응답해 주세요.` };
        }
        return { ok: true };
      }
    }
  }

  export function answerToColumns(question: SurveyQuestion, value: AnswerValue): AnswerColumns {
    const base = { question_id: question.id, value_text: null as string | null, value_number: null as number | null, value_json: null as unknown };
    switch (value.type) {
      case "single_choice":
        return { ...base, value_text: value.value && value.value !== "" ? value.value : null };
      case "multi_choice":
        return { ...base, value_json: value.value.length > 0 ? value.value : null };
      case "scale":
      case "nps":
      case "number":
        return { ...base, value_number: value.value };
      case "text":
      case "textarea":
        return { ...base, value_text: isEmptyText(value.value) ? null : value.value };
      case "pre_post_scale": {
        const { before, after } = value.value;
        if (before === null && after === null) return { ...base };
        return { ...base, value_json: { before, after } };
      }
    }
  }

  export function columnsToAnswer(
    question: SurveyQuestion,
    columns: Pick<AnswerColumns, "value_text" | "value_number" | "value_json">,
  ): AnswerValue {
    switch (question.type) {
      case "single_choice":
        return { type: "single_choice", value: columns.value_text ?? null };
      case "multi_choice":
        return { type: "multi_choice", value: Array.isArray(columns.value_json) ? (columns.value_json as string[]) : [] };
      case "scale":
        return { type: "scale", value: columns.value_number ?? null };
      case "nps":
        return { type: "nps", value: columns.value_number ?? null };
      case "number":
        return { type: "number", value: columns.value_number ?? null };
      case "text":
        return { type: "text", value: columns.value_text ?? "" };
      case "textarea":
        return { type: "textarea", value: columns.value_text ?? "" };
      case "pre_post_scale": {
        const j = (columns.value_json ?? {}) as Partial<PrePostValue>;
        return { type: "pre_post_scale", value: { before: j.before ?? null, after: j.after ?? null } };
      }
    }
  }

  export function emptyAnswer(question: SurveyQuestion): AnswerValue {
    switch (question.type) {
      case "single_choice":
        return { type: "single_choice", value: null };
      case "multi_choice":
        return { type: "multi_choice", value: [] };
      case "scale":
        return { type: "scale", value: null };
      case "nps":
        return { type: "nps", value: null };
      case "number":
        return { type: "number", value: null };
      case "text":
        return { type: "text", value: "" };
      case "textarea":
        return { type: "textarea", value: "" };
      case "pre_post_scale":
        return { type: "pre_post_scale", value: { before: null, after: null } };
    }
  }
  ```

- [ ] 통과 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run test -- survey.test
  ```
  기대: 모든 테스트 통과(`Test Files  1 passed`).

- [ ] 타입/린트 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build && npm run lint
  ```
  기대: 성공, 에러 0.

- [ ] 커밋
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/lib/survey.ts frontend/src/lib/__tests__/survey.test.ts && git commit -m "feat(survey): lib/survey.ts 검증·매핑 로직 + 단위테스트

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 4: `GET /api/surveys/[slug]` (공개 조회)

독립 산출물: 로그인 사용자가 slug로 설문+문항을 받고, 비로그인/비공개/마감 분기가 동작한다.

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/surveys/[slug]/route.ts`

**Interfaces**
- Consumes: `createServerSupabase()`, `@/types/survey`(`Survey`, `SurveyQuestion`, `SurveyWithQuestions`).
- Produces: `GET` → 200 `SurveyWithQuestions` / 404 / 410 / 401. 에러 shape `{ error: string }`. `{ params }: { params: Promise<{ slug: string }> }`.

**Steps**

- [ ] `src/app/api/surveys/[slug]/route.ts` 작성
  ```typescript
  import { NextResponse } from "next/server";
  import { createServerSupabase } from "@/lib/supabase-server";
  import type { Survey, SurveyQuestion } from "@/types/survey";

  /** GET /api/surveys/[slug] — 공개 조회(access_mode 재확인) */
  export async function GET(
    _request: Request,
    { params }: { params: Promise<{ slug: string }> },
  ) {
    try {
      const { slug } = await params;
      const supabase = await createServerSupabase();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: survey, error } = await supabase
        .from("surveys")
        .select("*")
        .eq("slug", slug)
        .maybeSingle<Survey>();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!survey) {
        return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
      }
      if (survey.status === "closed") {
        return NextResponse.json({ error: "마감된 설문입니다." }, { status: 410 });
      }
      if (survey.status !== "open") {
        return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
      }
      if (survey.access_mode === "authenticated" && !user) {
        return NextResponse.json({ error: "로그인이 필요한 설문입니다." }, { status: 401 });
      }

      const { data: questions, error: qError } = await supabase
        .from("survey_questions")
        .select("*")
        .eq("survey_id", survey.id)
        .order("order_index", { ascending: true })
        .returns<SurveyQuestion[]>();

      if (qError) {
        return NextResponse.json({ error: qError.message }, { status: 500 });
      }

      return NextResponse.json({ ...survey, questions: questions ?? [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "설문 조회에 실패했습니다.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  ```

- [ ] 타입/린트 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build && npm run lint
  ```
  기대: 성공, 에러 0.

- [ ] 커밋
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/app/api/surveys && git commit -m "feat(survey): GET /api/surveys/[slug] 공개 조회 라우트

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 5: `POST /api/surveys/[slug]/responses` (제출 RPC)

독립 산출물: 폼 페이로드를 `submit_survey_response` RPC로 제출하고, 중복/마감/인증 에러가 HTTP로 매핑된다.

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/surveys/[slug]/responses/route.ts`

**Interfaces**
- Consumes: `createServerSupabase()`, `@/types/survey`(`Survey`, `SubmitResponsePayload`).
- Produces: `POST` → 200 `{ response_id: string }` / 400 / 401 / 409 / 410. RPC 에러 매핑: `survey_not_open`→409, `auth_required`→401, `already_submitted`→409, 미존재 설문→410.

**Steps**

- [ ] `src/app/api/surveys/[slug]/responses/route.ts` 작성
  ```typescript
  import { NextResponse } from "next/server";
  import { createServerSupabase } from "@/lib/supabase-server";
  import type { Survey, SubmitResponsePayload } from "@/types/survey";

  /** POST /api/surveys/[slug]/responses — submit_survey_response RPC */
  export async function POST(
    request: Request,
    { params }: { params: Promise<{ slug: string }> },
  ) {
    try {
      const { slug } = await params;
      const supabase = await createServerSupabase();

      const { data: survey, error: sError } = await supabase
        .from("surveys")
        .select("id, access_mode, status")
        .eq("slug", slug)
        .maybeSingle<Pick<Survey, "id" | "access_mode" | "status">>();

      if (sError) {
        return NextResponse.json({ error: sError.message }, { status: 500 });
      }
      if (!survey) {
        return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 410 });
      }

      let payload: SubmitResponsePayload;
      try {
        payload = (await request.json()) as SubmitResponsePayload;
      } catch {
        return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
      }
      if (!payload || !Array.isArray(payload.answers)) {
        return NextResponse.json({ error: "answers 필드가 필요합니다." }, { status: 400 });
      }

      const { data: responseId, error } = await supabase.rpc("submit_survey_response", {
        p_survey_id: survey.id,
        p_answers: payload.answers,
        p_meta: payload.meta ?? {},
        p_respondent_hash: payload.respondent_hash ?? null,
      });

      if (error) {
        const msg = error.message || "";
        if (msg.includes("auth_required")) {
          return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
        }
        if (msg.includes("already_submitted")) {
          return NextResponse.json({ error: "이미 제출한 설문입니다." }, { status: 409 });
        }
        if (msg.includes("survey_not_open")) {
          return NextResponse.json({ error: "현재 응답할 수 없는 설문입니다." }, { status: 409 });
        }
        return NextResponse.json({ error: msg || "제출에 실패했습니다." }, { status: 500 });
      }

      return NextResponse.json({ response_id: responseId as string });
    } catch (err) {
      const message = err instanceof Error ? err.message : "제출에 실패했습니다.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  ```

- [ ] 타입/린트 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build && npm run lint
  ```
  기대: 성공, 에러 0.

- [ ] 커밋
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/app/api/surveys/[slug]/responses && git commit -m "feat(survey): POST responses — submit_survey_response RPC 라우트

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 6: 문항 렌더러 8종 + `QuestionRenderer` + `isUserResponse`

독립 산출물: 8개 타입 필드 + 디스패처가 컴파일되고, `isUserResponse`가 단위테스트로 검증된다.

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/survey-metrics.ts` (Phase 1은 `isUserResponse`만; KPI 레지스트리·산식은 후속 Phase에서 **append**)
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/__tests__/survey-metrics.test.ts`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/survey/renderers/SingleChoiceField.tsx`
- Create `.../components/survey/renderers/MultiChoiceField.tsx`
- Create `.../components/survey/renderers/ScaleField.tsx`
- Create `.../components/survey/renderers/NpsField.tsx`
- Create `.../components/survey/renderers/NumberField.tsx`
- Create `.../components/survey/renderers/TextField.tsx`
- Create `.../components/survey/renderers/TextareaField.tsx`
- Create `.../components/survey/renderers/PrePostScaleField.tsx`
- Create `.../components/survey/QuestionRenderer.tsx`

**Interfaces**
- Consumes: `@/types/survey`, `@/components/ui/*`, `@/lib/utils`(`cn`).
- Produces: 계약 §6 `FieldRendererProps<V>`, `QuestionRendererProps`, `isUserResponse({s0q3_value, s0q4_value})`.

> **`isUserResponse` 단일 출처 계약 (중복 정의 금지)**: 본 Task가 `is_user` 판정을 **value-key 기준**(`s0q3_value === "never"` OR `s0q4_value === "rarely"` → 비사용자)으로 **유일하게** 정의한다. 소비자(`SurveyForm.tsx`)는 `single_choice`의 option `value`(= `value_text` 저장값, 시드 Task9가 `"never"`/`"rarely"`로 저장)를 그대로 전달하므로 **한글 라벨 비교로 재구현 금지**. 후속 Phase가 `survey-metrics.ts`에 KPI 산식(`npsFromScores` 등)을 추가할 때도 이 `isUserResponse` 블록은 손대지 않고 신규 함수만 append한다.

> **PrePost 제시 순서 무작위화 메모(Phase1 범위 외)**: 스펙 §6은 before/after 제시 순서의 응답자 간 무작위화를 언급하나, 동결 계약의 `FieldRendererProps`/`QuestionConfig`에는 순서 무작위화 신호가 없다. 계약 동결 유지를 위해 Phase1에서는 `before→after` 고정 순서로 렌더하고, 무작위화는 **계약 개정 후** 별도 도입한다(현 단계 미구현 명시).

**Steps**

- [ ] `isUserResponse` 실패 테스트 작성 `src/lib/__tests__/survey-metrics.test.ts` (value-key 기준)
  ```typescript
  import { describe, it, expect } from "vitest";
  import { isUserResponse } from "@/lib/survey-metrics";

  describe("isUserResponse (value-key 기준)", () => {
    it("S0Q3 '사용한 적 없음'(never) → 비사용자", () => {
      expect(isUserResponse({ s0q3_value: "never", s0q4_value: "w3_4" })).toBe(false);
    });
    it("S0Q4 '거의 사용 안 함'(rarely) → 비사용자", () => {
      expect(isUserResponse({ s0q3_value: "1_3m", s0q4_value: "rarely" })).toBe(false);
    });
    it("둘 다 사용 신호('1_3m','w3_4') → 사용자", () => {
      expect(isUserResponse({ s0q3_value: "1_3m", s0q4_value: "w3_4" })).toBe(true);
    });
    it("미응답(null) → 사용자 가정(스킵 안 함)", () => {
      expect(isUserResponse({ s0q3_value: null, s0q4_value: null })).toBe(true);
    });
  });
  ```

- [ ] 실행해 실패 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run test -- survey-metrics.test
  ```
  기대: 모듈 부재로 실패.

- [ ] 최소 구현 `src/lib/survey-metrics.ts`
  ```typescript
  // Phase 1 범위: is_user 단일 정의만 제공한다.
  // KPI 레지스트리/순수 산식(npsFromScores 등)은 분석 대시보드 Phase에서 이 파일에 append한다.
  // 아래 isUserResponse는 단일 출처이며(중복 정의 금지) value-key 기준으로만 판정한다.

  // S0Q3 '사용한 적 없음' = "never", S0Q4 '거의 사용 안 함' = "rarely" (시드 옵션 value 규약)
  export function isUserResponse(args: {
    s0q3_value: string | null;
    s0q4_value: string | null;
  }): boolean {
    if (args.s0q3_value === "never") return false;
    if (args.s0q4_value === "rarely") return false;
    return true;
  }
  ```

- [ ] 통과 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run test -- survey-metrics.test
  ```
  기대: 4 passed.

- [ ] `SingleChoiceField.tsx` 작성
  ```typescript
  "use client";

  import type { SurveyQuestion } from "@/types/survey";
  import { cn } from "@/lib/utils";

  export interface FieldRendererProps<V> {
    question: SurveyQuestion;
    value: V;
    onChange: (value: V) => void;
    error?: string;
    disabled?: boolean;
  }

  export default function SingleChoiceField({
    question,
    value,
    onChange,
    disabled,
  }: FieldRendererProps<{ type: "single_choice"; value: string | null }>) {
    const options = question.config.options ?? [];
    return (
      <div className="flex flex-col gap-2">
        {options.map((opt) => {
          const selected = value.value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ type: "single_choice", value: opt.value })}
              className={cn(
                "text-left rounded-lg border px-3 py-2.5 text-sm transition-colors",
                selected ? "border-primary bg-primary/5 font-medium" : "border-input hover:bg-muted/40",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }
  ```

- [ ] `MultiChoiceField.tsx` 작성 (exclusive `none`/`dont_know` 단독 처리)
  ```typescript
  "use client";

  import type { FieldRendererProps } from "./SingleChoiceField";
  import { cn } from "@/lib/utils";

  const EXCLUSIVE_VALUES = new Set(["none", "dont_know"]);

  export default function MultiChoiceField({
    question,
    value,
    onChange,
    disabled,
  }: FieldRendererProps<{ type: "multi_choice"; value: string[] }>) {
    const options = question.config.options ?? [];

    function toggle(optValue: string) {
      const selected = value.value.includes(optValue);
      let next: string[];
      if (selected) {
        next = value.value.filter((v) => v !== optValue);
      } else if (EXCLUSIVE_VALUES.has(optValue)) {
        next = [optValue];
      } else {
        next = [...value.value.filter((v) => !EXCLUSIVE_VALUES.has(v)), optValue];
      }
      onChange({ type: "multi_choice", value: next });
    }

    return (
      <div className="flex flex-col gap-2">
        {options.map((opt) => {
          const selected = value.value.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => toggle(opt.value)}
              className={cn(
                "flex items-center gap-2 text-left rounded-lg border px-3 py-2.5 text-sm transition-colors",
                selected ? "border-primary bg-primary/5 font-medium" : "border-input hover:bg-muted/40",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              <span
                className={cn(
                  "h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px]",
                  selected ? "bg-primary border-primary text-primary-foreground" : "border-input",
                )}
              >
                {selected ? "✓" : ""}
              </span>
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }
  ```

- [ ] `ScaleField.tsx` 작성
  ```typescript
  "use client";

  import type { FieldRendererProps } from "./SingleChoiceField";
  import { cn } from "@/lib/utils";

  export default function ScaleField({
    question,
    value,
    onChange,
    disabled,
  }: FieldRendererProps<{ type: "scale"; value: number | null }>) {
    const min = question.config.min ?? 1;
    const max = question.config.max ?? 5;
    const points: number[] = [];
    for (let i = min; i <= max; i++) points.push(i);

    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          {points.map((p) => {
            const selected = value.value === p;
            return (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ type: "scale", value: p })}
                className={cn(
                  "flex-1 rounded-lg border py-2.5 text-sm font-medium transition-colors",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted/40",
                  disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                {p}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{question.config.min_label ?? min}</span>
          {question.config.mid_label && <span>{question.config.mid_label}</span>}
          <span>{question.config.max_label ?? max}</span>
        </div>
      </div>
    );
  }
  ```

- [ ] `NpsField.tsx` 작성
  ```typescript
  "use client";

  import type { FieldRendererProps } from "./SingleChoiceField";
  import { cn } from "@/lib/utils";

  export default function NpsField({
    value,
    onChange,
    disabled,
  }: FieldRendererProps<{ type: "nps"; value: number | null }>) {
    const points = Array.from({ length: 11 }, (_, i) => i);
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-11 gap-1">
          {points.map((p) => {
            const selected = value.value === p;
            return (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ type: "nps", value: p })}
                className={cn(
                  "rounded-md border py-2 text-xs font-medium transition-colors",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted/40",
                  disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                {p}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>전혀 추천 안 함</span>
          <span>적극 추천</span>
        </div>
      </div>
    );
  }
  ```

- [ ] `NumberField.tsx` 작성
  ```typescript
  "use client";

  import type { FieldRendererProps } from "./SingleChoiceField";
  import { Input } from "@/components/ui/input";

  export default function NumberField({
    question,
    value,
    onChange,
    disabled,
  }: FieldRendererProps<{ type: "number"; value: number | null }>) {
    const unit = question.config.unit;
    return (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          min={question.config.min}
          max={question.config.max}
          step={question.config.step}
          disabled={disabled}
          value={value.value === null ? "" : String(value.value)}
          placeholder={question.config.placeholder}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({ type: "number", value: raw === "" ? null : Number(raw) });
          }}
          className="max-w-[160px]"
        />
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
    );
  }
  ```

- [ ] `TextField.tsx` 작성
  ```typescript
  "use client";

  import type { FieldRendererProps } from "./SingleChoiceField";
  import { Input } from "@/components/ui/input";

  export default function TextField({
    question,
    value,
    onChange,
    disabled,
  }: FieldRendererProps<{ type: "text"; value: string }>) {
    return (
      <Input
        type="text"
        disabled={disabled}
        maxLength={question.config.max_length}
        placeholder={question.config.placeholder}
        value={value.value}
        onChange={(e) => onChange({ type: "text", value: e.target.value })}
      />
    );
  }
  ```

- [ ] `TextareaField.tsx` 작성
  ```typescript
  "use client";

  import type { FieldRendererProps } from "./SingleChoiceField";
  import { Textarea } from "@/components/ui/textarea";

  export default function TextareaField({
    question,
    value,
    onChange,
    disabled,
  }: FieldRendererProps<{ type: "textarea"; value: string }>) {
    const maxLen = question.config.max_length;
    return (
      <div className="flex flex-col gap-1">
        <Textarea
          rows={4}
          disabled={disabled}
          maxLength={maxLen}
          placeholder={question.config.placeholder}
          value={value.value}
          onChange={(e) => onChange({ type: "textarea", value: e.target.value })}
        />
        {typeof maxLen === "number" && (
          <span className="text-[11px] text-muted-foreground self-end">
            {value.value.length} / {maxLen}
          </span>
        )}
      </div>
    );
  }
  ```

- [ ] `PrePostScaleField.tsx` 작성 (2열 레이아웃, before→after 고정 순서 — 무작위화는 계약 개정 후 도입)
  ```typescript
  "use client";

  import type { FieldRendererProps } from "./SingleChoiceField";
  import type { PrePostValue } from "@/types/survey";
  import { cn } from "@/lib/utils";

  export default function PrePostScaleField({
    question,
    value,
    onChange,
    disabled,
  }: FieldRendererProps<{ type: "pre_post_scale"; value: PrePostValue }>) {
    const min = question.config.min ?? 1;
    const max = question.config.max ?? 5;
    const beforeLabel = question.config.before_label ?? "도입 전";
    const afterLabel = question.config.after_label ?? "현재";
    const points: number[] = [];
    for (let i = min; i <= max; i++) points.push(i);

    function setSide(side: "before" | "after", p: number) {
      onChange({ type: "pre_post_scale", value: { ...value.value, [side]: p } });
    }

    function Row({ side, label }: { side: "before" | "after"; label: string }) {
      const current = value.value[side];
      return (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <div className="flex gap-1.5">
            {points.map((p) => {
              const selected = current === p;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSide(side, p)}
                  className={cn(
                    "flex-1 rounded-lg border py-2 text-sm font-medium transition-colors",
                    selected
                      ? side === "before"
                        ? "border-slate-500 bg-slate-500 text-white"
                        : "border-primary bg-primary text-primary-foreground"
                      : "border-input hover:bg-muted/40",
                    disabled && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
        <Row side="before" label={beforeLabel} />
        <Row side="after" label={afterLabel} />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{question.config.min_label ?? min}</span>
          {question.config.mid_label && <span>{question.config.mid_label}</span>}
          <span>{question.config.max_label ?? max}</span>
        </div>
      </div>
    );
  }
  ```

- [ ] `QuestionRenderer.tsx` 작성 (type 분기 디스패처)
  ```typescript
  "use client";

  import type { SurveyQuestion, AnswerValue, PrePostValue } from "@/types/survey";
  import SingleChoiceField from "./renderers/SingleChoiceField";
  import MultiChoiceField from "./renderers/MultiChoiceField";
  import ScaleField from "./renderers/ScaleField";
  import NpsField from "./renderers/NpsField";
  import NumberField from "./renderers/NumberField";
  import TextField from "./renderers/TextField";
  import TextareaField from "./renderers/TextareaField";
  import PrePostScaleField from "./renderers/PrePostScaleField";

  export interface QuestionRendererProps {
    question: SurveyQuestion;
    value: AnswerValue;
    onChange: (value: AnswerValue) => void;
    error?: string;
    disabled?: boolean;
  }

  export default function QuestionRenderer({
    question,
    value,
    onChange,
    error,
    disabled,
  }: QuestionRendererProps) {
    function body() {
      switch (value.type) {
        case "single_choice":
          return <SingleChoiceField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
        case "multi_choice":
          return <MultiChoiceField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
        case "scale":
          return <ScaleField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
        case "nps":
          return <NpsField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
        case "number":
          return <NumberField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
        case "text":
          return <TextField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
        case "textarea":
          return <TextareaField question={question} value={value} onChange={onChange} error={error} disabled={disabled} />;
        case "pre_post_scale":
          return (
            <PrePostScaleField
              question={question}
              value={value as { type: "pre_post_scale"; value: PrePostValue }}
              onChange={onChange}
              error={error}
              disabled={disabled}
            />
          );
      }
    }

    return (
      <div className="flex flex-col gap-2">
        <div>
          <p className="text-sm font-medium">
            {question.title}
            {question.required && <span className="text-destructive ml-1">*</span>}
          </p>
          {question.description && (
            <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">{question.description}</p>
          )}
        </div>
        {body()}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }
  ```

- [ ] 타입/린트 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build && npm run lint
  ```
  기대: 성공, 에러 0.

- [ ] 커밋
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/lib/survey-metrics.ts frontend/src/lib/__tests__/survey-metrics.test.ts frontend/src/components/survey && git commit -m "feat(survey): 문항 렌더러 8종 + QuestionRenderer + isUserResponse(단일 정의)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 7: `SurveyForm` + 응답 페이지 + 목록 페이지

독립 산출물: `/survey`(목록)와 `/survey/[slug]`(폼)이 동작하며, 섹션 그룹핑·진행률·미사용자 스킵·완료/중복/마감 분기가 화면에 반영된다.

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/survey/SurveyForm.tsx`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/survey/[slug]/page.tsx`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/survey/page.tsx`

**Interfaces**
- Consumes: `@/types/survey`, `@/lib/survey`(`validateAnswer`/`answerToColumns`/`emptyAnswer`), `@/lib/survey-metrics`(`isUserResponse`), `@/components/survey/QuestionRenderer`, `@/components/ui/*`.
- Produces: 계약 §6 `SurveyFormProps`(`survey`, `isAuthenticated`, `onSubmitted?`). 페이지는 GET 조회 → 401/404/410 분기 + 폼 호스트.
- 스킵 규칙: 비사용자(`isUserResponse=false`)면 section이 `S1`/`S2`/`S3`로 시작하는 문항 제외. S0Q3=`analysis_metric:"s0q3_duration"`, S0Q4=`analysis_metric:"s0q4_frequency"` 문항의 선택 value로 판정.

**Steps**

- [ ] `SurveyForm.tsx` 작성
  ```typescript
  "use client";

  import { useMemo, useState } from "react";
  import { Button } from "@/components/ui/button";
  import { Card, CardContent } from "@/components/ui/card";
  import { Loader2, CheckCircle2 } from "lucide-react";
  import type { SurveyWithQuestions, SurveyQuestion, AnswerValue } from "@/types/survey";
  import { validateAnswer, answerToColumns, emptyAnswer } from "@/lib/survey";
  import { isUserResponse } from "@/lib/survey-metrics";
  import QuestionRenderer from "./QuestionRenderer";

  export interface SurveyFormProps {
    survey: SurveyWithQuestions;
    isAuthenticated: boolean;
    onSubmitted?: (responseId: string) => void;
  }

  const SKIP_SECTIONS = ["S1", "S2", "S3"];

  export default function SurveyForm({ survey, isAuthenticated, onSubmitted }: SurveyFormProps) {
    const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => {
      const init: Record<string, AnswerValue> = {};
      for (const q of survey.questions) init[q.id] = emptyAnswer(q);
      return init;
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState<string | null>(null);
    const [duplicate, setDuplicate] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const s0q3 = survey.questions.find((q) => q.config.analysis_metric === "s0q3_duration");
    const s0q4 = survey.questions.find((q) => q.config.analysis_metric === "s0q4_frequency");

    const nonUser = useMemo(() => {
      const v3 = s0q3 ? answers[s0q3.id] : undefined;
      const v4 = s0q4 ? answers[s0q4.id] : undefined;
      const s3 = v3 && v3.type === "single_choice" ? v3.value : null;
      const s4 = v4 && v4.type === "single_choice" ? v4.value : null;
      return !isUserResponse({ s0q3_value: s3, s0q4_value: s4 });
    }, [answers, s0q3, s0q4]);

    function isVisible(q: SurveyQuestion): boolean {
      if (!nonUser) return true;
      const sec = q.section ?? "";
      return !SKIP_SECTIONS.some((p) => sec.startsWith(p));
    }

    const visibleQuestions = survey.questions.filter(isVisible);

    const grouped = useMemo(() => {
      const map = new Map<string, SurveyQuestion[]>();
      for (const q of visibleQuestions) {
        const key = q.section ?? "기타";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(q);
      }
      return Array.from(map.entries());
    }, [visibleQuestions]);

    const answeredCount = visibleQuestions.filter((q) => {
      const r = validateAnswer(q, answers[q.id]);
      return r.ok && hasValue(answers[q.id]);
    }).length;
    const progress = visibleQuestions.length === 0 ? 0 : Math.round((answeredCount / visibleQuestions.length) * 100);

    function update(q: SurveyQuestion, v: AnswerValue) {
      setAnswers((prev) => ({ ...prev, [q.id]: v }));
      setErrors((prev) => {
        if (!prev[q.id]) return prev;
        const next = { ...prev };
        delete next[q.id];
        return next;
      });
    }

    async function handleSubmit() {
      setFormError(null);
      const nextErrors: Record<string, string> = {};
      for (const q of visibleQuestions) {
        const r = validateAnswer(q, answers[q.id]);
        if (!r.ok) nextErrors[q.id] = r.error ?? "응답을 확인해 주세요.";
      }
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        setFormError("응답하지 않았거나 잘못된 문항이 있습니다.");
        return;
      }

      setSubmitting(true);
      try {
        const payloadAnswers = visibleQuestions.map((q) => answerToColumns(q, answers[q.id]));
        const res = await fetch(`/api/surveys/${survey.slug}/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: payloadAnswers,
            meta: { ua: typeof navigator !== "undefined" ? navigator.userAgent : "" },
          }),
        });
        if (res.status === 409) {
          setDuplicate(true);
          return;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setFormError(err.error || "제출에 실패했습니다.");
          return;
        }
        const data = await res.json();
        setDone(data.response_id);
        onSubmitted?.(data.response_id);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "제출에 실패했습니다.");
      } finally {
        setSubmitting(false);
      }
    }

    if (duplicate) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-sm font-medium">이미 제출한 설문입니다.</p>
            <p className="text-xs text-muted-foreground">소중한 응답에 감사드립니다.</p>
          </CardContent>
        </Card>
      );
    }

    if (done) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-sm font-medium">응답이 제출되었습니다.</p>
            <p className="text-xs text-muted-foreground">참여해 주셔서 감사합니다.</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="flex flex-col gap-6">
        <div className="sticky top-0 z-10 bg-background/90 backdrop-blur py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>진행률</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {grouped.map(([section, qs]) => (
          <Card key={section}>
            <CardContent className="flex flex-col gap-6 py-5">
              <h2 className="text-base font-semibold">{section}</h2>
              {qs.map((q) => (
                <QuestionRenderer
                  key={q.id}
                  question={q}
                  value={answers[q.id]}
                  onChange={(v) => update(q, v)}
                  error={errors[q.id]}
                  disabled={submitting}
                />
              ))}
            </CardContent>
          </Card>
        ))}

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <Button onClick={handleSubmit} disabled={submitting} className="w-full" data-testid="survey-submit">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          제출하기
        </Button>
      </div>
    );
  }

  function hasValue(v: AnswerValue): boolean {
    switch (v.type) {
      case "single_choice":
        return v.value !== null && v.value !== "";
      case "multi_choice":
        return v.value.length > 0;
      case "scale":
      case "nps":
      case "number":
        return v.value !== null;
      case "text":
      case "textarea":
        return v.value.trim().length > 0;
      case "pre_post_scale":
        return v.value.before !== null && v.value.after !== null;
    }
  }
  ```

  > **`isAuthenticated` prop 사용 메모**: 컨테이너 분기는 서버 라우트(401/404/410)와 RPC 에러로 일원화되어 있어 Phase1에서는 `isAuthenticated`를 직접 분기에 쓰지 않는다. ESLint no-unused-vars 위반을 피하려면 props 구조분해에서 `isAuthenticated`를 받되 미사용 경고가 발생하면 `void isAuthenticated;` 한 줄 또는 진행률 영역의 접근성 메시지로 소비한다(빌드/린트 에러 0 유지).

- [ ] `app/survey/[slug]/page.tsx` 작성
  ```typescript
  "use client";

  import { use, useEffect, useState } from "react";
  import Link from "next/link";
  import { Loader2, ArrowLeft } from "lucide-react";
  import { Card, CardContent } from "@/components/ui/card";
  import { Button } from "@/components/ui/button";
  import type { SurveyWithQuestions } from "@/types/survey";
  import SurveyForm from "@/components/survey/SurveyForm";

  export default function SurveyRespondPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = use(params);
    const [survey, setSurvey] = useState<SurveyWithQuestions | null>(null);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<number | null>(null);

    useEffect(() => {
      let cancelled = false;
      fetch(`/api/surveys/${slug}`)
        .then(async (res) => {
          if (cancelled) return;
          setStatus(res.status);
          if (res.ok) {
            setSurvey(await res.json());
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [slug]);

    if (loading) {
      return (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
        </div>
      );
    }

    if (!survey) {
      const message =
        status === 401
          ? "로그인이 필요한 설문입니다."
          : status === 410
            ? "마감된 설문입니다."
            : "설문을 찾을 수 없습니다.";
      return (
        <Card className="max-w-2xl mx-auto mt-10">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{message}</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/survey">설문 목록으로</Link>
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="max-w-2xl mx-auto py-6">
        <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
          <Link href="/survey">
            <ArrowLeft className="h-4 w-4 mr-1" /> 설문 목록
          </Link>
        </Button>
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{survey.title}</h1>
          {survey.description && (
            <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">{survey.description}</p>
          )}
        </div>
        <SurveyForm survey={survey} isAuthenticated={status !== 401} />
      </div>
    );
  }
  ```

- [ ] `app/survey/page.tsx` 작성 (진행중 설문 목록)
  ```typescript
  "use client";

  import { useEffect, useState } from "react";
  import Link from "next/link";
  import { ClipboardList, Loader2, ArrowRight } from "lucide-react";
  import { Card, CardContent } from "@/components/ui/card";
  import { createBrowserClient } from "@supabase/ssr";
  import type { Survey } from "@/types/survey";

  export default function SurveyListPage() {
    const [surveys, setSurveys] = useState<Survey[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      supabase
        .from("surveys")
        .select("*")
        .eq("status", "open")
        .order("sort_order", { ascending: true })
        .returns<Survey[]>()
        .then(({ data }) => {
          setSurveys(data ?? []);
          setLoading(false);
        });
    }, []);

    return (
      <div className="max-w-2xl mx-auto py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <ClipboardList className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">설문</h1>
            <p className="text-sm text-muted-foreground">진행 중인 설문에 참여해 주세요.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
          </div>
        ) : surveys.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              진행 중인 설문이 없습니다.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {surveys.map((s) => (
              <Link key={s.id} href={`/survey/${s.slug}`}>
                <Card className="group hover-glow cursor-pointer">
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <p className="text-sm font-semibold">{s.title}</p>
                      {s.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 ml-3 group-hover:translate-x-0.5 transition-transform" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] 타입/린트 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build && npm run lint
  ```
  기대: 성공, 에러 0. (`@supabase/ssr`의 `createBrowserClient`는 기존 의존성에 존재.)

- [ ] 커밋
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/components/survey/SurveyForm.tsx frontend/src/app/survey && git commit -m "feat(survey): SurveyForm + 응답/목록 페이지 (스킵·진행률·완료/중복 분기)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 8: 진입점 3파일 등록

독립 산출물: `/survey`가 미들웨어를 통과하고, 홈 카드/역할 접근에 노출된다.

> **소유권 분리(중복 편집 방지)**: 어드민 네비(`admin/layout.tsx`의 `ADMIN_NAV` + `ClipboardList` import) 등록은 **설문 관리 페이지가 생성되는 Phase2 Task5가 단독 소유**한다. Phase1은 `admin/layout.tsx`를 수정하지 않는다(데드 링크 방지 + Phase2의 exact-string Edit 앵커 불일치 방지).

**Files**
- Modify `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/roles.ts`
- Modify `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/page.tsx`
- Modify `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/supabase-middleware.ts`

**Interfaces**
- Produces: `ROLE_ACCESS` 전 역할에 `/survey`, 홈 `FEATURES` 설문 카드(`ClipboardList`), 미들웨어 `/survey` 화이트리스트.
- Consumes: 기존 패턴.

**Steps**

- [ ] `roles.ts`의 `ROLE_ACCESS`에 `/survey` 추가
  ```typescript
  const ROLE_ACCESS: Record<UserRole, string[]> = {
    guest: ["/food", "/ladder", "/team", "/survey"],
    user: ["/food", "/ladder", "/team", "/guide", "/survey"],
    admin: ["/food", "/ladder", "/team", "/guide", "/survey", "/admin"],
  };
  ```

- [ ] `page.tsx` import에 `ClipboardList` 추가
  ```typescript
  import { Dice5, Users, ArrowRight, UtensilsCrossed, HelpCircle, Shield, Coffee, ClipboardList } from "lucide-react";
  ```

- [ ] `page.tsx` `FEATURES`에 설문 카드 추가 (어드민 카드 앞)
  ```typescript
    {
      href: "/survey",
      title: "설문 참여",
      description: "진행 중인 사내 설문에 참여하고 의견을 들려주세요.",
      icon: ClipboardList,
      gradient: "from-emerald-500 to-teal-600",
      bgAccent: "bg-emerald-50",
      iconColor: "text-emerald-600",
      delay: "delay-[450ms]",
    },
    {
      href: "/admin",
      title: "어드민",
      description: "사용자 관리, 시스템 설정, 가이드 관리 등 관리자 기능.",
      icon: Shield,
      gradient: "from-slate-500 to-slate-700",
      bgAccent: "bg-slate-100",
      iconColor: "text-slate-600",
      delay: "delay-[500ms]",
    },
  ```
  (기존 어드민 카드 객체를 위 두 객체로 교체. 설문 카드를 어드민 카드 직전에 삽입.)

- [ ] `supabase-middleware.ts` 비로그인 리다이렉트 예외에 `/survey` 추가 (`PROTECTED_ROUTES`는 미수정)
  ```typescript
      // 로그인 안 된 경우 /login으로 리다이렉트 (API, login, privacy, survey 등 공개 페이지 제외)
      if (
        !user &&
        !pathname.startsWith("/login") &&
        !pathname.startsWith("/auth") &&
        !pathname.startsWith("/api") &&
        !pathname.startsWith("/privacy") &&
        !pathname.startsWith("/survey")
      ) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        return NextResponse.redirect(url);
      }
  ```

- [ ] 타입/린트 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build && npm run lint
  ```
  기대: 성공, 에러 0.

- [ ] 커밋
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/lib/roles.ts frontend/src/app/page.tsx frontend/src/lib/supabase-middleware.ts && git commit -m "feat(survey): 진입점 등록 (역할·홈카드·미들웨어 화이트리스트)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 9: 첫 설문 시드 (25문항)

독립 산출물: `claude-code-productivity` 설문 + 25문항이 `status='open'`으로 DB에 삽입되어 응답 가능 상태가 된다.

**Files**
- Create(인메모리 SQL) 마이그레이션 `claude_code_productivity_survey` (apply_migration). 옵션 value 규약: exclusive='none'/'dont_know', S0Q3 '사용한 적 없음'='never', S0Q4 '거의 사용 안 함'='rarely'. section은 `"S0. 응답자 배경"`~`"S4. 향후 기대 및 도구 활용 방향"`. S0Q3 config `analysis_metric:"s0q3_duration"`, S0Q4 `analysis_metric:"s0q4_frequency"`.

> **S4Q4 '최대 3개' 메모**: 동결 `QuestionConfig`에 `max_select` 키가 없으므로 시드에도 해당 키를 넣지 않는다. '(최대 3개)'는 타이틀 안내문(권고)으로만 표현하고 강제 상한은 적용하지 않는다(Task3 메모와 동일). 강제가 필요하면 동결 계약 개정이 선행되어야 한다.

**Interfaces**
- Consumes: Task 1 테이블.
- Produces: surveys 1행 + survey_questions 25행.

**Steps**

- [ ] 사전검증: 트랜잭션 내 실행→롤백. `mcp__supabase__execute_sql`로 아래 시드 SQL을 `begin; … rollback;`로 1회 검증(중복 slug·체크제약 위반 0 확인).

- [ ] 시드 적용: `mcp__supabase__apply_migration` (name: `claude_code_productivity_survey`) 에 아래 SQL 적용
  ```sql
  do $$
  declare v_survey_id uuid;
  begin
    insert into public.surveys (slug, title, description, status, access_mode, is_anonymous, sort_order)
    values (
      'claude-code-productivity',
      'Claude Code 활용 실태·개선점 설문',
      E'본 조사는 업무 도구(Claude Code) 활용 실태와 개선점을 파악하기 위한 것입니다. 도구가 도움이 안 되었거나 불편했던 점도 똑같이 중요합니다.\n응답은 개인 식별 없이 직무·경력 등 그룹 단위로만 집계되며, 로그인 정보는 중복 제출 방지·도입 전후 매칭에만 쓰입니다. 분석·보고 단계에서는 응답이 개인정보와 분리되어 누가 무엇을 답했는지 관리자도 확인할 수 없습니다. (예상 소요 7~10분)',
      'open', 'authenticated', true, 0
    )
    returning id into v_survey_id;

    insert into public.survey_questions (survey_id, section, order_index, type, title, description, required, config) values
    -- S0 (7)
    (v_survey_id, 'S0. 응답자 배경', 0, 'single_choice', '현재 담당하시는 주 직무 분야는?', null, true,
      '{"ordinal":false,"segment":true,"analysis_metric":"s0q1_role","options":[
        {"value":"dev","label":"개발/엔지니어링"},{"value":"data","label":"데이터/AI/ML"},
        {"value":"infra","label":"인프라/DevOps/SRE"},{"value":"qa","label":"QA/품질"},
        {"value":"pm","label":"기획/PM"},{"value":"design","label":"디자인/UX"},
        {"value":"biz","label":"경영지원(HR·총무·재무 등)"},{"value":"etc","label":"기타"}]}'::jsonb),
    (v_survey_id, 'S0. 응답자 배경', 1, 'single_choice', '전체 직장 경력은?', null, true,
      '{"ordinal":true,"segment":true,"analysis_metric":"s0q2_tenure","options":[
        {"value":"lt1","label":"1년 미만"},{"value":"1_3","label":"1~3년"},
        {"value":"4_7","label":"4~7년"},{"value":"8_12","label":"8~12년"},{"value":"ge13","label":"13년 이상"}]}'::jsonb),
    (v_survey_id, 'S0. 응답자 배경', 2, 'single_choice', 'Claude Code 사용 기간은?', null, true,
      '{"ordinal":true,"segment":true,"analysis_metric":"s0q3_duration","options":[
        {"value":"never","label":"사용한 적 없음"},{"value":"lt1m","label":"1개월 미만"},
        {"value":"1_3m","label":"1~3개월"},{"value":"4_6m","label":"4~6개월"},
        {"value":"7_12m","label":"7~12개월"},{"value":"ge1y","label":"1년 이상"}]}'::jsonb),
    (v_survey_id, 'S0. 응답자 배경', 3, 'single_choice', '최근 1개월 사용 빈도는?', null, true,
      '{"ordinal":true,"segment":true,"analysis_metric":"s0q4_frequency","options":[
        {"value":"rarely","label":"거의 사용 안 함"},{"value":"m1_3","label":"월 1~3회"},
        {"value":"w1_2","label":"주 1~2회"},{"value":"w3_4","label":"주 3~4회"},{"value":"daily","label":"거의 매일"}]}'::jsonb),
    (v_survey_id, 'S0. 응답자 배경', 4, 'single_choice', '현재 주로 쓰는 라이센스 형태는?', null, true,
      '{"ordinal":false,"segment":true,"analysis_metric":"s0q5_license","options":[
        {"value":"company_paid","label":"회사 제공 유료"},{"value":"company_self","label":"회사 제공+개인 유료 병행"},
        {"value":"self_paid","label":"개인 유료(자비)"},{"value":"free","label":"개인 무료 플랜"},
        {"value":"none_use","label":"사용하지 않음"}]}'::jsonb),
    (v_survey_id, 'S0. 응답자 배경', 5, 'single_choice', '조직 내 역할에 가장 가까운 것은?', null, true,
      '{"ordinal":false,"segment":true,"analysis_metric":"s0q6_position","options":[
        {"value":"ic","label":"개인 기여자(실무)"},{"value":"lead","label":"팀 리드·파트장"},
        {"value":"head","label":"부서장 이상"},{"value":"na","label":"해당 없음"}]}'::jsonb),
    (v_survey_id, 'S0. 응답자 배경', 6, 'multi_choice', '사용 전부터 써온 다른 AI 도구를 모두 선택해 주세요. (해당 없으면 ''없음'' 단독)', null, true,
      '{"segment":true,"analysis_metric":"s0q7_prior_ai","options":[
        {"value":"none","label":"없음(Claude Code가 처음)"},{"value":"copilot","label":"GitHub Copilot 등 코드 자동완성"},
        {"value":"chatbot","label":"ChatGPT·Gemini 등 챗봇"},{"value":"ai_ide","label":"Cursor·Windsurf 등 AI IDE"},
        {"value":"etc","label":"기타 AI 도구"}]}'::jsonb),
    -- S1 (5) pre_post_scale
    (v_survey_id, 'S1. 도입 전후 비교', 7, 'pre_post_scale', '전반적 업무 생산성(같은 시간 처리량) — 도입 전/현재',
      E'각 항목을 ''도입 전''과 ''현재'' 두 시점으로 평가해 주세요. ''도입 전''은 처음 사용하기 시작한 시점 직전의 약 한 달을 기준으로 떠올려 주세요. 변화가 없었다면 두 시점을 같게 두셔도 됩니다.', true,
      '{"min":1,"max":5,"min_label":"매우 낮음","mid_label":"보통","max_label":"매우 높음","before_label":"도입 전","after_label":"현재","ordinal":true,"analysis_metric":"pre_post_overall"}'::jsonb),
    (v_survey_id, 'S1. 도입 전후 비교', 8, 'pre_post_scale', '산출물 품질·완성도 — 도입 전/현재', null, true,
      '{"min":1,"max":5,"min_label":"매우 낮음","mid_label":"보통","max_label":"매우 높음","before_label":"도입 전","after_label":"현재","ordinal":true,"analysis_metric":"s1q2_quality"}'::jsonb),
    (v_survey_id, 'S1. 도입 전후 비교', 9, 'pre_post_scale', '신기술·도메인·코드베이스 적응(학습·온보딩) 속도 — 도입 전/현재', null, true,
      '{"min":1,"max":5,"min_label":"매우 낮음","mid_label":"보통","max_label":"매우 높음","before_label":"도입 전","after_label":"현재","ordinal":true,"analysis_metric":"s1q3_learning"}'::jsonb),
    (v_survey_id, 'S1. 도입 전후 비교', 10, 'pre_post_scale', '복잡한 문제를 (도구 도움 포함) 끝까지 해결할 자신감 — 도입 전/현재', null, true,
      '{"min":1,"max":5,"min_label":"매우 낮음","mid_label":"보통","max_label":"매우 높음","before_label":"도입 전","after_label":"현재","ordinal":true,"analysis_metric":"s1q4_confidence"}'::jsonb),
    (v_survey_id, 'S1. 도입 전후 비교', 11, 'pre_post_scale', '업무 중 정신적 여유(쫓기지 않고 차분히) — 도입 전/현재', null, true,
      '{"min":1,"max":5,"min_label":"매우 부족","mid_label":"보통","max_label":"매우 충분","before_label":"도입 전","after_label":"현재","ordinal":true,"analysis_metric":"s1q5_wellbeing"}'::jsonb),
    -- S2 (4)
    (v_survey_id, 'S2. 정량 효과', 12, 'number', '주당 평균 절감 업무 시간 추정(시간/주). 가늠 어렵거나 절감 없으면 0',
      '추정이 어려우면 대략 답하셔도 되며, 솔직한 ''효과 없음(0)''도 똑같이 중요합니다.', true,
      '{"min":0,"unit":"시간/주","analysis_metric":"weekly_hours_saved"}'::jsonb),
    (v_survey_id, 'S2. 정량 효과', 13, 'single_choice', '같은 시간 처리량은 도입 전 대비 얼마나 증가했나요?', null, true,
      '{"ordinal":true,"analysis_metric":"s2q2_throughput","option_midpoints":{"none":0,"p1_10":5.5,"p11_25":18,"p26_50":38,"p51_100":75,"p100":125},"options":[
        {"value":"none","label":"변화 없음 또는 감소"},{"value":"p1_10","label":"1~10%"},
        {"value":"p11_25","label":"11~25%"},{"value":"p26_50","label":"26~50%"},
        {"value":"p51_100","label":"51~100%"},{"value":"p100","label":"100%(2배) 이상"}]}'::jsonb),
    (v_survey_id, 'S2. 정량 효과', 14, 'single_choice', '인지하는 라이센스 비용 대비 체감 가치는? 모르면 마지막 보기', null, true,
      '{"ordinal":true,"analysis_metric":"value_ratio","top_box":["much_higher","higher"],"options":[
        {"value":"much_higher","label":"비용보다 훨씬 큼"},{"value":"higher","label":"큼"},
        {"value":"similar","label":"비슷"},{"value":"lower","label":"작음"},
        {"value":"much_lower","label":"훨씬 작음"},{"value":"unknown_cost","label":"라이센스 비용을 알지 못함"}]}'::jsonb),
    (v_survey_id, 'S2. 정량 효과', 15, 'multi_choice', '절감 시간을 주로 어디에 재투자하셨나요? (모두). ''특별히 달라진 것 없음'' 단독', null, true,
      '{"analysis_metric":"s2q4_reinvest","options":[
        {"value":"harder","label":"더 난이도 높은 업무"},{"value":"more","label":"더 많은 처리량"},
        {"value":"quality","label":"품질개선·리팩터링"},{"value":"learning","label":"학습·역량개발"},
        {"value":"newproj","label":"신규/사이드 프로젝트"},{"value":"rest","label":"휴식·워라밸"},
        {"value":"collab","label":"협업·소통"},{"value":"none","label":"특별히 달라진 것 없음"}]}'::jsonb),
    -- S3 (3)
    (v_survey_id, 'S3. 정성 효과', 16, 'multi_choice', '주로 어떤 업무에 활용하시나요? (모두)', null, true,
      '{"analysis_metric":"s3q1_use","options":[
        {"value":"impl","label":"기능구현·코드작성"},{"value":"debug","label":"디버깅"},
        {"value":"review","label":"코드리뷰"},{"value":"test","label":"테스트작성"},
        {"value":"refactor","label":"리팩터링"},{"value":"docs","label":"문서·리포트"},
        {"value":"data","label":"데이터분석·쿼리·스크립트"},{"value":"research","label":"리서치·기획·아이디어"},
        {"value":"learn","label":"학습·신기술"},{"value":"automation","label":"반복업무 자동화"},{"value":"etc","label":"기타"}]}'::jsonb),
    (v_survey_id, 'S3. 정성 효과', 17, 'textarea', '효과가 가장 컸던 사례, 또는 새롭게 가능해진 업무가 있다면 자유롭게 적어 주세요. (선택)', null, false,
      '{"max_length":2000,"analysis_metric":"s3q2_case","placeholder":"예: 신규 도메인 온보딩 기간이 절반으로 줄었다 등"}'::jsonb),
    (v_survey_id, 'S3. 정성 효과', 18, 'multi_choice', '느낀 한계나 활용을 망설이게 한 장애요인은? (모두). ''특별한 한계 없음'' 단독', null, true,
      '{"analysis_metric":"s3q3_barrier","options":[
        {"value":"trust","label":"결과 신뢰성·정확도(환각·검증필요)"},{"value":"security","label":"보안·정보유출 우려"},
        {"value":"context","label":"긴 컨텍스트·대규모 코드 이해 한계"},{"value":"learning","label":"학습곡선·사용법 어려움"},
        {"value":"verify","label":"결과 검증 추가시간"},{"value":"overreliance","label":"과의존 우려"},
        {"value":"noguide","label":"사내 가이드 부재"},{"value":"integration","label":"기존 워크플로·사내 시스템 연동 어려움"},
        {"value":"license","label":"라이센스·사용량 제한"},{"value":"none","label":"특별한 한계·장애물 없음"}]}'::jsonb),
    -- S4 (6)
    (v_survey_id, 'S4. 향후 기대 및 도구 활용 방향', 19, 'nps', '동료에게 Claude Code 도입을 추천할 의향은?', null, true,
      '{"min":0,"max":10,"analysis_metric":"nps"}'::jsonb),
    (v_survey_id, 'S4. 향후 기대 및 도구 활용 방향', 20, 'scale', '회사가 라이센스를 계속 제공(유지)하는 것에 동의하시나요?', null, true,
      '{"min":1,"max":5,"min_label":"전혀 동의 안 함","mid_label":"보통","max_label":"매우 동의","ordinal":true,"analysis_metric":"license_support","top_box":["4","5"],"target":4}'::jsonb),
    (v_survey_id, 'S4. 향후 기대 및 도구 활용 방향', 21, 'single_choice', '라이센스를 사용할 수 없게 되면 업무에 미칠 영향은? 판단 어려우면 마지막 보기', null, true,
      '{"ordinal":true,"analysis_metric":"s4q3_discontinue_impact","options":[
        {"value":"none","label":"거의 영향 없음"},{"value":"minor","label":"다소 불편하나 대체 가능"},
        {"value":"notable","label":"생산성 눈에 띄게 저하"},{"value":"severe","label":"핵심 업무에 상당한 지장"},
        {"value":"critical","label":"매우 어려움(대체 없음)"},{"value":"na","label":"해당 없음(미사용)"}]}'::jsonb),
    (v_survey_id, 'S4. 향후 기대 및 도구 활용 방향', 22, 'multi_choice', '가장 기여를 기대하는 효과는? (최대 3개 권고). ''없음''·''잘 모르겠음'' 각 단독', null, false,
      '{"analysis_metric":"s4q4_expect","options":[
        {"value":"speed","label":"속도 향상"},{"value":"quality","label":"품질 향상"},
        {"value":"capability","label":"새 역량 확보"},{"value":"onboarding","label":"온보딩 가속"},
        {"value":"workload","label":"업무부담·야근 감소"},{"value":"new_biz","label":"새 업무·사업 시도"},
        {"value":"automation","label":"반복업무 자동화 확대"},{"value":"culture","label":"전사 생산성·학습 문화 확산"},
        {"value":"none","label":"특별히 기대 없음"},{"value":"dont_know","label":"잘 모르겠음"}]}'::jsonb),
    (v_survey_id, 'S4. 향후 기대 및 도구 활용 방향', 23, 'multi_choice', '활용 확대를 위해 회사가 제공하면 좋을 지원은? (모두). ''특별히 필요 없음'' 단독', null, false,
      '{"analysis_metric":"s4q5_support","options":[
        {"value":"training","label":"교육·온보딩"},{"value":"guide","label":"사내 가이드·프롬프트·BP 공유"},
        {"value":"seats","label":"상위 플랜·시트 확대"},{"value":"security","label":"보안·정보보호 가이드"},
        {"value":"community","label":"우수사례 세션·커뮤니티·챔피언"},{"value":"mcp","label":"MCP·사내 시스템 연동"},
        {"value":"templates","label":"사례·템플릿 라이브러리"},{"value":"none","label":"특별히 필요 없음"}]}'::jsonb),
    (v_survey_id, 'S4. 향후 기대 및 도구 활용 방향', 24, 'textarea', '활용 확대·회사 지원과 관련해 자유 의견을 남겨 주세요(옹호·우려·개선 모두). (선택)', null, false,
      '{"max_length":2000,"analysis_metric":"s4q6_message","placeholder":""}'::jsonb);
  end $$;
  ```

- [ ] 삽입 검증
  ```
  mcp__supabase__execute_sql
    sql: select s.slug, s.status, count(q.id) as q_count
         from public.surveys s left join public.survey_questions q on q.survey_id = s.id
         where s.slug = 'claude-code-productivity' group by s.slug, s.status;
  ```
  기대: `claude-code-productivity | open | 25`.

- [ ] 시드는 DB 적용물이므로 코드 커밋 없음. 다음 Task로 진행.

---

## Task 10: Playwright E2E — 응답 제출 → 완료 → 재진입 중복 차단

독립 산출물: 로그인 사용자 응답 제출 후 완료 화면, 재제출 시 409 중복 화면이 E2E로 검증된다.

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/e2e/survey-respond.spec.ts`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/e2e/.auth/README.md` (인증 상태 주입 안내)

**Interfaces**
- Consumes: 실행 중 dev 서버(`webServer` 자동 기동), 시드된 설문 `claude-code-productivity`.
- Produces: 통과하는 E2E 스펙. 인증은 `SURVEY_E2E_STORAGE_STATE`(Playwright storageState JSON 경로) 환경변수로 주입.

**Steps**

- [ ] 인증 주입 안내 파일 작성 `e2e/.auth/README.md`
  ```markdown
  # Survey E2E 인증

  설문 응답 E2E는 로그인 user 세션이 필요하다.
  1. 로컬 dev 서버에서 user 계정으로 로그인 후, 브라우저 쿠키를 Playwright storageState JSON으로 저장한다.
  2. 저장 경로를 환경변수로 지정해 실행한다:

      SURVEY_E2E_STORAGE_STATE=/absolute/path/to/storage-state.json \
      SURVEY_E2E_SLUG=claude-code-productivity \
      npm run test:e2e -- survey-respond

  storageState 미지정 시 인증이 필요한 스펙은 test.skip 처리된다.
  ```

- [ ] E2E 스펙 작성 `e2e/survey-respond.spec.ts` (데드 코드 없음 — 검증 에러 기준 결정적 보정 단일 경로)
  ```typescript
  import { test, expect } from "@playwright/test";
  import fs from "node:fs";

  const STORAGE = process.env.SURVEY_E2E_STORAGE_STATE;
  const SLUG = process.env.SURVEY_E2E_SLUG ?? "claude-code-productivity";
  const hasAuth = !!STORAGE && fs.existsSync(STORAGE);

  test.describe("설문 응답 플로우", () => {
    test.skip(!hasAuth, "SURVEY_E2E_STORAGE_STATE(로그인 storageState)가 필요합니다.");
    test.use({ storageState: hasAuth ? STORAGE : undefined });

    test("응답 제출 → 완료 → 재진입 시 중복 차단", async ({ page }) => {
      await page.goto(`/survey/${SLUG}`);
      await expect(page.getByTestId("survey-submit")).toBeVisible({ timeout: 15_000 });

      // number 입력 문항을 먼저 채운다(선택형 버튼과 겹치지 않음).
      const numberInputs = page.locator('input[type="number"]');
      const numCount = await numberInputs.count();
      for (let i = 0; i < numCount; i++) {
        await numberInputs.nth(i).fill("3");
      }

      // 제출 시도 → 표시된 첫 검증 에러(p.text-xs.text-destructive) 문항의
      // 첫·마지막 선택 버튼을 클릭해 결정적으로 보정하는 단일 루프.
      // (pre_post는 first=before행 첫 버튼, last=after행 마지막 버튼으로 양쪽 충족)
      for (let attempt = 0; attempt < 40; attempt++) {
        const completed = await page.getByText("응답이 제출되었습니다.").isVisible().catch(() => false);
        const duplicated = await page.getByText("이미 제출한 설문입니다.").isVisible().catch(() => false);
        if (completed || duplicated) break;

        await page.getByTestId("survey-submit").click();
        await page.waitForTimeout(250);

        const completedNow = await page.getByText("응답이 제출되었습니다.").isVisible().catch(() => false);
        const duplicatedNow = await page.getByText("이미 제출한 설문입니다.").isVisible().catch(() => false);
        if (completedNow || duplicatedNow) break;

        const firstError = page.locator("p.text-xs.text-destructive").first();
        if (!(await firstError.isVisible().catch(() => false))) continue;

        const container = firstError.locator("xpath=..");
        const optButtons = container.locator("button");
        const count = await optButtons.count();
        if (count > 0) {
          await optButtons.first().click();
          if (count > 1) await optButtons.last().click();
        }
      }

      const completed = await page.getByText("응답이 제출되었습니다.").isVisible().catch(() => false);
      const duplicated = await page.getByText("이미 제출한 설문입니다.").isVisible().catch(() => false);
      expect(completed || duplicated).toBeTruthy();

      // 재진입 → 제출 → 중복 차단
      await page.goto(`/survey/${SLUG}`);
      const submitBtn = page.getByTestId("survey-submit");
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
      }
      await expect(page.getByText("이미 제출한 설문입니다.")).toBeVisible({ timeout: 10_000 });
    });
  });
  ```

- [ ] 인증 없는 환경에서 스펙 스킵 동작 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run test:e2e -- survey-respond
  ```
  기대: `1 skipped`(storageState 미설정 시) — 스펙이 안전하게 스킵되고 종료코드 0.

- [ ] 인증 주입 후 통과 확인 (storageState 준비된 경우)
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && SURVEY_E2E_STORAGE_STATE="$PWD/e2e/.auth/user.json" SURVEY_E2E_SLUG=claude-code-productivity npm run test:e2e -- survey-respond
  ```
  기대: `1 passed` (제출 완료 + 재진입 중복 차단 검증).

- [ ] `.gitignore`에 인증 상태 제외 추가 (민감정보 커밋 방지)
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && printf '\n# Playwright auth state\nfrontend/e2e/.auth/*.json\nfrontend/test-results/\nfrontend/playwright-report/\n' >> .gitignore
  ```

- [ ] 전체 단위테스트 + 타입 + 린트 최종 확인
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run test && npm run build && npm run lint
  ```
  기대: 단위테스트 전부 통과, 빌드 성공, 린트 에러 0.

- [ ] 커밋
  ```bash
  cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/e2e/survey-respond.spec.ts frontend/e2e/.auth/README.md .gitignore && git commit -m "test(survey): E2E 응답 제출·완료·중복차단 + auth 주입 가이드

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Phase 1 완료 기준 (Definition of Done)

- DB: `survey_system_init` + `claude_code_productivity_survey` 적용, security advisor ERROR 0, 25문항 `open`.
- 로직: `lib/survey.ts`(검증·매핑), `lib/survey-metrics.ts`(`isUserResponse` — value-key 기준 단일 정의) Vitest 전부 통과.
- API: `GET /api/surveys/[slug]`(200/401/404/410), `POST /api/surveys/[slug]/responses`(200/400/401/409/410) 동작.
- UI: `/survey` 목록, `/survey/[slug]` 폼(섹션 그룹핑·진행률·미사용자 S1~S3 스킵·완료/중복 분기) 동작.
- 진입점: 홈 카드·역할 접근·미들웨어 화이트리스트 반영. **어드민 네비('설문 관리') 등록은 Phase2 Task5 소유**(Phase1 미수정 — 데드 링크/Edit 앵커 충돌 방지).
- 검증: `npm run test` / `npm run build`(tsc) / `npm run lint` 모두 통과, E2E 스펙 존재(인증 주입 시 통과, 미주입 시 안전 스킵).
- 출하 가능: 로그인 user가 첫 설문에 응답 → DB 저장 → 재진입 중복 차단까지 end-to-end 동작.