# 범용 설문 시스템 설계 스펙 — Claude Code 생산성 설문 (v1)

> 본 문서는 범용 설문 시스템과 그 첫 설문(Claude Code 생산성/이점 파악)의 확정 설계 스펙이다. 데이터 모델·아키텍처·분석 출력·문항 전문을 단일 문서로 통합했으며, 기술 정합성 검증에서 지적된 불일치(config 키 케이싱, 집계 전략 이원화, 분석 메타 누락, 제출 원자성, 재오픈 차단, public dedup)를 모두 본문에 반영해 모순을 제거했다. 이 문서는 구현 계획(implementation plan)의 입력이 된다.
>
> 🕐 기준 시각: 2026-06-26 (KST)

---

## 1. 개요 & 목적

### 1.1 시스템 목적
관리자가 `/admin/surveys`에서 설문을 생성하고, 문항을 추가/순서변경/타입편집할 수 있는 **완전 범용 설문 빌더**를 구축한다. 응답 수집·익명 집계·CSV/엑셀 내보내기·경영 보고용 요약까지 하나의 파이프라인으로 제공한다. 기존 NHN 인재아이엔씨 워크샵 앱(Next.js 16 App Router + Supabase)의 컨벤션을 그대로 따른다.

### 1.2 첫 설문 목적
주제: **"Claude Code 활용을 통한 생산성 향상 및 기타 이점"** 파악.
- **내부 용도(메타에만 보존)**: 회사 차원에서 Claude(Claude Code) 라이센스를 추가 도입·유지하기 위한 의사결정 근거 자료.
- **응답자 화면 프레이밍(중립화)**: '라이센스 의사결정 근거'를 반복 고지하지 않고, "업무 도구(Claude Code) 활용 실태·개선점 파악"으로 제시한다. "도움이 안 되거나 불편했던 점도 똑같이 중요"를 명시해 부정 응답을 허용·장려한다. (요구특성 편향 통제)
- 5대 목표 전부 전용 섹션으로 측정: **(A)** 도입 전후 비교(회고형 단일 설문, pre_post_scale), **(B)** 정량 효과(절감시간·처리량·ROI), **(C)** 정성 효과(활용 사례·신규 가능성·한계), **(D)** 향후 기대 및 라이센스 지지도(NPS·추천의향), **(E)** 세그먼트 분석용 응답자 배경.
- 총 **25문항**(S0:7 · S1:5 · S2:4 · S3:3 · S4:6), 예상 응답 **7~10분**, 전 문항 한국어.
- 접근: `access_mode=authenticated`(로그인 user 이상 전용), `is_anonymous=true`.

### 1.3 익명성 신뢰 모델
로그인은 **중복 제출 방지**와 **도입 전후 매칭(1행 upsert)** 에만 사용한다. 분석·보고 단계에서는 응답이 개인정보와 분리되어 **관리자도 개별 응답자를 식별할 수 없는 익명 집계만** 출력한다(세그먼트 소표본 n<5 마스킹 포함). 이 원칙은 S0 섹션 설명에 응답자에게 구체적으로 고지한다.

---

## 2. 확정된 설계 결정 요약

| # | 영역 | 결정 |
|---|---|---|
| 1 | 데이터 모델 | 정규화 관계형 4테이블: `surveys` / `survey_questions` / `survey_responses` / `survey_answers` |
| 2 | 문항 타입(8종) | `single_choice` / `multi_choice` / `scale`(Likert) / `nps` / `number` / `text` / `textarea` / `pre_post_scale` |
| 3 | 응답자 식별 | 로그인 기반(1인 1응답·중복방지·전후매칭). 분석/보고는 익명 집계만 |
| 4 | 접근 모드 | 설문별 `access_mode`: `authenticated`(user+ 전용) / `public`(공개 익명). **첫 설문은 authenticated** |
| 5 | 분석 출력 | (a) Admin 집계 대시보드 (b) CSV/엑셀 내보내기 (c) 경영 요약 뷰 |
| 6 | 빌더 범위 | 관리자가 설문 생성·문항 추가/순서/타입 편집(완전 범용) |
| 7 | **집계 전략(확정)** | **Postgres RPC `get_survey_aggregate`(SECURITY DEFINER) 단일 경로**로 일원화. 클라 TS 집계(`aggregateResults`)는 폐기/후처리로 격하 |
| 8 | **제출 경로(확정)** | **`submit_survey_response(payload jsonb)` SECURITY DEFINER RPC를 유일 쓰기 경로로 채택**(원자성 + public 완료 가능 + anon 소유권 부재 동시 해결) |
| 9 | **config 키 케이싱(확정)** | **snake_case 통일**(`min_label`, `max_label`, `allow_other`, `analysis_metric`, `top_box`, `segment`, `target`, `ordinal`) |
| 10 | **재오픈 차단(확정)** | 제출 완료(`is_complete=true`) 응답은 불변. update 시 `is_complete`를 false로 낮추기 금지 |
| 11 | **public dedup(확정)** | `respondent_hash` partial unique(public 모드 도입 시) |
| 12 | anon 표면 | 첫 설문이 authenticated이므로 **anon 정책·grant 도입을 public 설문 실제 필요 시점까지 보류**(공격 표면 최소화). 본 SQL에는 포함하되 적용 시 `get_advisors(security)` 필수 |
| 13 | 차트/엑셀 의존성 | **신규 라이브러리 0개로 시작**(CSS/SVG 프리미티브 + UTF-8 BOM CSV). 고도화 시 shadcn chart(Recharts)/exceljs 선택 도입 |
| 14 | 헬퍼 재사용 | `private.is_admin()`, `public.update_updated_at()` 기존 함수 재사용(라이브 스키마에 존재 확인) |

---

## 3. 데이터 모델

### 3.1 저장 컨벤션 (value 컬럼 매핑 — 집계의 전제, 고정)

| type | 저장 컬럼 | 값 형태 | CSV 직렬화 |
|---|---|---|---|
| `single_choice` | `value_text` | 선택 옵션의 `value` 키 1개 | 옵션 **라벨** |
| `multi_choice` | `value_json` | `["a","c"]`(선택 value 배열) | 옵션별 0/1 더미 컬럼(exclusive 보기는 단독 검증), 표시용은 라벨 `;` 결합 |
| `scale`(Likert) | `value_number` | 정수(1~5) | 숫자 |
| `nps` | `value_number` | 0~10 | `value_number`(score) + 파생 group(promoter9~10/passive7~8/detractor0~6) |
| `number` | `value_number` | 실수(시간/건) | 숫자(트리밍 전후 병행) |
| `text` / `textarea` | `value_text` | 자유 문자열 | 원문 + 정성코딩 컬럼 |
| `pre_post_scale` | `value_json` | `{"before":n,"after":n}` | `_before` / `_after` / `_delta` 3컬럼 |

> delta(Δ)는 **before·after 동시 존재 시에만** 산출(pairwise). 분기 스킵 결측은 0·평균 대체 금지(MNAR 주의). straight-line(열 내 동일값) 응답은 플래그 후 민감도 분석.

### 3.2 마이그레이션 SQL — `survey_system_init`

> 라이브 스키마 대상 트랜잭션 내 실행→롤백 검증 통과(`validation_ok`, 영구 반영 0건). `private.is_admin()`·`public.update_updated_at()`는 기존 함수 재사용. **§3.3의 두 RPC(`submit_survey_response`, `get_survey_aggregate`)를 동일 마이그레이션에 합쳐 적용**한다.
>
> **사전 검증 완료(2026-06-26)**: 라이브 DB/코드 직접 확인 — ① `private.is_admin(uid uuid DEFAULT auth.uid())`는 **기본값을 보유**하여 인자 없는 `private.is_admin()` 호출이 유효하며, 기존 정책(`user_profiles`, `nlm_sources` 등)도 동일하게 인자 없이 호출함(일관). ② `public.update_updated_at()` 존재 확인. ③ 미들웨어(`supabase-middleware.ts`)의 `/login` 리다이렉트 예외 로직과 `PROTECTED_ROUTES`(`/admin`,`/guide`)는 §4.2 가정과 정확히 일치.

```sql
-- =====================================================================
-- Migration: survey_system_init
-- 범용 설문 시스템 — surveys / survey_questions / survey_responses / survey_answers
-- 컨벤션: id uuid(gen_random_uuid), timestamptz default now(),
--         RLS per-command TO authenticated, 관리자 게이트 private.is_admin(),
--         updated_at 자동 갱신 public.update_updated_at() BEFORE UPDATE.
-- =====================================================================

-- 1. surveys — 설문 정의
create table if not exists public.surveys (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title        text not null,
  description  text,
  status       text not null default 'draft'
                 check (status in ('draft', 'open', 'closed')),
  access_mode  text not null default 'authenticated'
                 check (access_mode in ('authenticated', 'public')),
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
comment on table  public.surveys is '설문 정의(메타). status=draft/open/closed, access_mode=authenticated/public.';
comment on column public.surveys.is_anonymous is '집계/내보내기에서 개인식별 제거 여부(보고는 항상 익명 집계).';

-- 2. survey_questions — 문항
create table if not exists public.survey_questions (
  id          uuid primary key default gen_random_uuid(),
  survey_id   uuid not null references public.surveys(id) on delete cascade,
  section     text,
  order_index integer not null default 0,
  type        text not null check (type in (
                'single_choice', 'multi_choice', 'scale', 'nps',
                'number', 'text', 'textarea', 'pre_post_scale')),
  title       text not null,
  description text,
  required    boolean not null default false,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists survey_questions_survey_id_idx    on public.survey_questions (survey_id);
create index if not exists survey_questions_survey_order_idx on public.survey_questions (survey_id, order_index);
comment on column public.survey_questions.config is
  'JSONB(snake_case 통일). 옵션: {"options":[{"value":"a","label":"..."}],"allow_other":bool}, '
  'scale/pre_post_scale: {"min":1,"max":5,"min_label":"...","max_label":"...","mid_label":"...","before_label":"도입 전","after_label":"현재"}, '
  'number: {"min":0,"unit":"시간/주"}. '
  '분석 메타: {"segment":bool,"ordinal":bool,"analysis_metric":"<키>","top_box":["a"],"target":<num>,'
  '"option_midpoints":{"a":0,"b":5.5}}.';

-- 3. survey_responses — 응답 세션(응답자 단위, 1행)
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
-- 1인 1응답(로그인): 익명/공개(user_id IS NULL)는 제외하는 partial unique
create unique index if not exists survey_responses_unique_user
  on public.survey_responses (survey_id, respondent_user_id)
  where respondent_user_id is not null;
-- public dedup: 공개 익명 응답 hash 기반 강제(결정 #11)
create unique index if not exists survey_responses_unique_hash
  on public.survey_responses (survey_id, respondent_hash)
  where respondent_user_id is null and respondent_hash is not null;
comment on column public.survey_responses.respondent_hash is
  '공개(anon) 설문 중복 응답 식별용(예: 클라이언트 토큰/IP+UA 해시). 비식별.';
comment on column public.survey_responses.meta is
  'JSONB. 응답 환경/소요시간 등(예: {"duration_sec":312,"ua":"..."}).';

-- 4. survey_answers — 문항별 답변(응답 1건 x 문항 1건 = 1행)
create table if not exists public.survey_answers (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null references public.survey_responses(id) on delete cascade,
  question_id  uuid not null references public.survey_questions(id) on delete cascade,
  value_text   text,
  value_number numeric,
  value_json   jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (response_id, question_id)   -- 문항당 1답변(upsert 대상)
);
create index if not exists survey_answers_response_id_idx on public.survey_answers (response_id);
create index if not exists survey_answers_question_id_idx on public.survey_answers (question_id);
comment on column public.survey_answers.value_json is
  '복합값 저장: single_choice→value_text | multi_choice→value_json["a","c"] | '
  'scale/nps/number→value_number | text/textarea→value_text | '
  'pre_post_scale→value_json{"before":<int>,"after":<int>}.';

-- 5. 보조 함수 — anon/공개 응답의 답변 쓰기 검증(SECURITY DEFINER로 RLS 우회 검증)
create or replace function private.survey_response_is_writable(p_response_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.survey_responses r
    join public.surveys s on s.id = r.survey_id
    where r.id = p_response_id
      and s.status = 'open'
      and r.is_complete = false                       -- 제출 완료 응답 불변
      and (r.respondent_user_id = auth.uid()
        or (r.respondent_user_id is null and s.access_mode = 'public'))
  );
$$;

-- 6. updated_at 자동 갱신 트리거
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

-- 7. RLS 활성화 + grant(실 통제는 RLS, grant는 additive)
alter table public.surveys          enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_answers   enable row level security;
-- anon grant/정책은 결정 #12에 따라 public 설문 도입 시점까지 보류 가능(아래 anon 블록 주석 토글)
grant select on public.surveys, public.survey_questions to anon, authenticated;
grant insert on public.survey_responses, public.survey_answers to anon;
grant select, insert, update, delete
  on public.surveys, public.survey_questions, public.survey_responses, public.survey_answers
  to authenticated;

-- 8. RLS 정책
-- 8-1. surveys
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

-- 8-2. survey_questions
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

-- 8-3. survey_responses
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
-- 재오픈 차단(결정 #10): 완료 응답 불변 + is_complete를 false로 낮추기 금지
drop policy if exists survey_responses_update on public.survey_responses;
create policy survey_responses_update on public.survey_responses for update to authenticated
  using ((respondent_user_id = auth.uid() and is_complete = false) or private.is_admin())
  with check ((respondent_user_id = auth.uid() and is_complete in (true, false)) or private.is_admin());
drop policy if exists survey_responses_delete on public.survey_responses;
create policy survey_responses_delete on public.survey_responses for delete to authenticated
  using (private.is_admin());

-- 8-4. survey_answers
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
```

### 3.3 RPC (동일 마이그레이션에 포함)

#### 3.3.1 `submit_survey_response` — 원자적 제출 (유일 쓰기 경로)
응답행 upsert + 답변 일괄 upsert + 완료 처리를 한 트랜잭션으로 수행. authenticated/public 공통. 전후매칭은 같은 1행 upsert로 처리.

```sql
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
    raise exception 'survey_not_open';      -- 마감/없음 → 차단
  end if;
  if v_survey.access_mode = 'authenticated' and v_uid is null then
    raise exception 'auth_required';
  end if;

  -- 응답행 upsert (1인 1응답 / 전후매칭은 동일 1행)
  if v_uid is not null then
    insert into public.survey_responses(survey_id, respondent_user_id, is_complete, meta)
      values (p_survey_id, v_uid, false, coalesce(p_meta,'{}'::jsonb))
    on conflict (survey_id, respondent_user_id) where respondent_user_id is not null
      do update set meta = excluded.meta, updated_at = now()
    returning id into v_resp_id;
    -- 이미 제출 완료된 응답이면 차단(불변)
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

  -- 답변 upsert: [{question_id, value_text, value_number, value_json}, ...]
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
```

#### 3.3.2 `get_survey_aggregate` — 익명 집계 (단일 호출, n<5 마스킹)
admin 게이트 통과 후 호출. 세그먼트 교집합(AND) + 옵션 합집합(OR), 소표본 셀 마스킹. 전 문항 집계를 JSON 배열로 1회 반환. `respondent_user_id`를 결과에 절대 포함하지 않아 관리자에 대해서도 익명성 유지.

```sql
create or replace function public.get_survey_aggregate(
  p_survey_id uuid, p_segments jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  -- 세그먼트 조건을 만족하는 응답집합(완료응답만) → 타입별 집계 → jsonb 배열
  -- (구현: seg_responses CTE + 문항 타입 분기 집계. n<5 셀은 분포 숨김 '표본 부족' 처리)
  -- single/multi: 옵션별 도수·% | scale/number: n·mean·median·sd·min·max·분포
  -- nps: nps=추천(9~10)%−비추천(0~6)%, promoters/passives/detractors
  -- pre_post: before_mean·after_mean·delta_mean(pairwise)·improvement_pct·before/after 분포
  -- text/textarea: n만(본문은 별도 페이지 fetch)
  select jsonb_build_object('survey_id', p_survey_id, 'questions', '[]'::jsonb)
    into v_out;  -- 실제 집계 본문은 구현 단계에서 채움(쿼리 패턴은 §5.1)
  return v_out;
end;
$$;
grant execute on function public.get_survey_aggregate(uuid, jsonb) to authenticated;
```

> 적용: `mcp__supabase__apply_migration`(name: `survey_system_init`)로 §3.2 + §3.3 합본 실행. anon grant/정책은 결정 #12에 따라 보류 가능하며, 적용 시 `mcp__supabase__get_advisors(security)` 검토 필수.

---

## 4. 시스템 아키텍처

### 4.1 핵심 재사용 규칙
- 서버 인증: `createServerSupabase()`(`frontend/src/lib/supabase-server.ts`) → `auth.getUser()` → `user_profiles.role` 조회. admin 게이트는 `app/api/admin/chat-history/route.ts`와 동일 패턴(401/403).
- Next 16 동적 라우트: `{ params }: { params: Promise<{ id: string }> }` → `await params` 필수.
- admin 페이지는 `app/admin/layout.tsx`가 `useUserRole()`로 게이트 + 서브탭 자동 적용 → `/admin/surveys/*`는 어드민 크롬/게이트 자동 상속.
- 전 페이지 `"use client"`.

### 4.2 진입점 변경 (entry-point)
1. **`frontend/src/lib/roles.ts`** — `ROLE_ACCESS`에 `/survey` 등록(guest·user·admin 전 역할). `/admin/surveys`는 기존 `/admin` prefix로 커버됨.
2. **`frontend/src/app/page.tsx`** — `FEATURES`에 설문 카드 추가(`href:"/survey"`, `ClipboardList` 아이콘). `canAccess` 필터로 자동 노출.
3. **`frontend/src/app/admin/layout.tsx`** — `ADMIN_NAV`에 `{ href:"/admin/surveys", label:"설문 관리", icon: ClipboardList }` 추가.
4. **`frontend/src/lib/supabase-middleware.ts`** — ⚠️ 비로그인 사용자를 `/login`으로 리다이렉트(예외: `/login`,`/auth`,`/api`,`/privacy`). public 익명 링크를 위해 예외 목록에 `/survey` 추가(`!pathname.startsWith("/survey")`). access_mode는 경로가 아닌 **데이터**라 미들웨어가 구분 불가 → 미들웨어는 `/survey` 통과시키고 **실제 접근 제어는 페이지+API가 access_mode 기준으로 수행**. `PROTECTED_ROUTES`에는 `/survey`를 넣지 않는다.

### 4.3 API 라우트

| 메서드 | 경로 | 권한 | 비고 |
|---|---|---|---|
| GET | `/api/surveys/[slug]` | 공개* | `SurveyWithQuestions`; status≠open→404/410; access_mode=authenticated & 비로그인→401 |
| POST | `/api/surveys/[slug]/responses` | access_mode 의존 | `submit_survey_response` RPC 호출. 중복→409 |
| GET | `/api/admin/surveys` | admin | `?status=`, 설문별 response_count |
| POST | `/api/admin/surveys` | admin | slug 중복 검사(409), `created_by=user.id`, status 기본 draft |
| GET·PATCH·DELETE | `/api/admin/surveys/[id]` | admin | survey+questions / 부분필드(status 전이·기간·slug) / cascade 삭제 |
| GET·POST·PUT | `/api/admin/surveys/[id]/questions` | admin | 목록 / 신규 / 일괄 reorder·section 재배치 |
| PATCH·DELETE | `/api/admin/surveys/[id]/questions/[questionId]` | admin | 개별 편집(title·type·config·required) / 삭제 |
| GET | `/api/admin/surveys/[id]/analytics` | admin | `get_survey_aggregate` RPC → `SurveyResultSummary`. `?segments=` |
| GET | `/api/admin/surveys/[id]/export` | admin | `?format=csv\|xlsx&scope=raw\|aggregate\|all`. Node 런타임 |

\* 공개 라우트도 내부에서 access_mode 재확인. `authenticated`면 `auth.getUser()` 없을 시 401.

### 4.4 페이지 (App Router)
- **응답(사용자)**: `app/survey/page.tsx`(공개+진행중 설문 목록) / `app/survey/[slug]/page.tsx`(응답 폼 — 섹션 그룹핑·진행률·서버검증·완료/중복/마감 분기). 문항 렌더러는 `components/survey/`(`SurveyForm`, `QuestionRenderer`, `renderers/*` 8종 + `PrePostScaleField` 2열).
- **관리(admin)**: `app/admin/surveys/page.tsx`(목록·상태배지·응답수) / `new/page.tsx`(메타 생성) / `[id]/edit/page.tsx`(범용 빌더: 타입선택기·드래그순서·인라인편집·섹션) / `[id]/analytics/page.tsx`(+`/summary` 경영 요약 탭). 빌더/결과 컴포넌트는 `components/admin/surveys/`(차트 프리미티브 `charts/HBar·Gauge·Histogram·PrePostBars`).

### 4.5 `frontend/src/types/survey.ts` 핵심 인터페이스
- 열거형: `SurveyStatus`, `SurveyAccessMode`, `QuestionType`(8종).
- 행 인터페이스: `Survey`, `SurveyQuestion`, `SurveyResponse`, `SurveyAnswer`(모두 `updated_at` 포함하여 모델 드리프트 제거).
- `QuestionConfig`(**snake_case 통일 + 분석 메타 포함**):
  ```typescript
  export interface QuestionConfig {
    options?: { value: string; label: string }[];
    allow_other?: boolean;
    min?: number; max?: number; step?: number;
    min_label?: string; mid_label?: string; max_label?: string;
    before_label?: string; after_label?: string;   // 기본 "도입 전"/"현재"
    unit?: string; placeholder?: string; max_length?: number;
    // ── 분석 메타(결정 #9) ──
    segment?: boolean;          // 세그먼트 필터 후보
    ordinal?: boolean;          // 순서형 여부(명목형 false → 평균·상관 제외)
    analysis_metric?: string;   // KPI 레지스트리 키
    top_box?: string[];         // top-box 비율 계산 옵션 집합
    target?: number;            // 신호등 벤치마크
    option_midpoints?: Record<string, number>; // 구간 중앙값(S2Q2 throughput)
  }
  ```
- `AnswerValue` 판별 유니온 + `SubmitResponsePayload` + `QuestionAggregate`/`SurveyResultSummary` DTO.
- lib: `survey.ts`(`QUESTION_TYPE_META`, `default_config_for`, `validateAnswer`, `answerToColumns`) / `survey-metrics.ts`(KPI 레지스트리, §5.3).

---

## 5. 분석 출력

### 5.1 집계 데이터 레이어 (단일 경로 = RPC)
모든 대시보드/요약은 **`get_survey_aggregate` RPC(SECURITY DEFINER)** 1콜로 서버측 집계. raw 개별 응답을 클라이언트로 보내지 않으며 결과에 `respondent_user_id` 미포함(관리자 익명성). 표본 모집단 = `is_complete = true`(부분응답 토글로 포함 가능). 타입별 GROUP BY 전략(요약):
- single → `value_text` 도수분포 / multi → `jsonb_array_elements_text` unnest 도수(분모=응답자 수) / scale·number·nps → `avg·median·sd·min·max` + 분포 / **nps** → 추천(≥9)%−비추천(≤6)% / **pre_post** → before·after 평균 + Δ(pairwise) + 개선폭% / text → 본문 별도 페이지.
- **세그먼트**: 배경 문항(`config.segment=true`)의 답 부분집합으로 한정. 다중 세그먼트 AND, 같은 세그먼트 내 다중 옵션 OR. **n<5 셀 마스킹**("표본 부족")으로 직무×경력 교차 재식별 방지.
- **분모 라벨 강제**: 모든 차트·KPI 카드에 모수 라벨(전체 / 사용자 `is_user=true` / 헤비유저 주3회+) 표기. `is_user` 단일 정의 = S0Q3='사용한 적 없음' OR S0Q4='거의 사용 안 함' → 비사용자.

### 5.2 (a) Admin 집계 대시보드 — 타입→시각화

| type | 시각화 | 표기 |
|---|---|---|
| single_choice | 수평 막대 | 라벨 + n + %(명목형은 평균 미산출) |
| multi_choice | 수평 막대 + "복수응답 합계 100%↑" 주석 | 응답자 대비 %(분모=n명) |
| scale | 평균 게이지 + 분포 막대 | 평균·중앙값·SD·top-2-box% |
| nps | NPS 게이지(−100~100) + 3분할 스택 | 점수·추천/중립/비추천% |
| pre_post_scale | 도입전 vs 현재 그룹막대 + Δ 배지 | before→after, Δ+%, n(pairwise) |
| number | 히스토그램 + 평균선 | 평균·중앙값·합계·단위(트리밍 전후) |
| text/textarea | 응답 목록(검색·페이지네이션) | n건, CSV 전체 |

레이아웃: `section`별 그룹 → `order_index` 정렬, 문항=카드. 상단 고정바: 응답수/완료율/평균 소요시간 + 세그먼트 멀티셀렉트(직무/경력/사용기간) + 비교 모드(개발 vs 비개발). **차트는 0-dependency CSS/SVG 프리미티브**로 시작.

### 5.3 (c) 경영 요약 뷰 — 핵심 KPI 5종 ↔ 문항 매핑
KPI는 문항 하드코딩이 아니라 `config.analysis_metric` 태그로 결선(범용성 유지). 미태깅 문항은 카드 "미설정".

| KPI | 의미 | 소스 문항 / metric | 계산·게이트 |
|---|---|---|---|
| ① 도입 전후 개선 Δ | 핵심 지표 전→현재 향상 | **S1Q1** `pre_post_overall` | `(after−before)/before×100`, 직무·역할·기존AI 세그먼트. 자기보고 회고형 상향편향 한계 명시 |
| ② 가중 연간 절감시간/ROI | 1차 ROI | **S2Q1** `weekly_hours_saved` | `avg×사용인원×시간당 인건비`, 이상치>40h/주 트리밍·신뢰구간. **S2Q2·S1Q1과 합산 금지**(수렴타당도 교차검증 전용) |
| ③ 비용 대비 가치 '비용 이상' 비율 | ROI 정당성 | **S2Q3** `value_ratio` | (훨씬 큼+큼)% — '비용 모름' 분모 제외 + '비용 모름 비율' 별도 노출, 과반 시 보조지표 강등 |
| ④ 사용자 NPS | 추천의향 | **S4Q1** `nps` | 사용자 모수 기본 + 전사/사용자 이중 분모. 세그먼트 최소 n=20~30 게이트, 미달 시 개발 vs 비개발 collapse |
| ⑤ 유지 지지도 + 중단영향 | 유지 의사 | **S4Q2** `license_support`(top-2-box) + **S4Q3** 중단영향('상당+매우'%) | S4Q2 관리자·예산권자(S0Q6) 별도 표기로 호의편향 보정. S4Q3 사용자 모수 |

보조: 역할별·기존AI별 Δ, S1 구성개념 레이더, **S3Q3 장애요인 ↔ S4Q5 지원니즈 처방 매핑**. ROI 박스(절감시간 KPI × `app_settings` 인건비 − 라이센스 비용 → 회수기간). KPI 신호등은 `config.target`로 설정. 인쇄/PDF 친화(A4 1~2장).

### 5.4 (b) CSV/엑셀 내보내기
- **시트1 원본**(행=응답): `response_id`·`submitted_at`(KST)·`is_complete` + 세그먼트 문항 펼침 열. `respondent_user_id`/`respondent_hash` **기본 제외**(감사 목적 `includeIdentity=true`만 포함). 문항 열은 `section, order_index` 순. single→라벨, multi→옵션별 0/1 더미(+라벨 `;` 결합 표시), pre_post→`_before`/`_after`/`_delta`, 미응답=빈 셀.
- **시트2 집계**: 문항별 요약 1행(섹션·문항·타입·n·평균·중앙값·SD·옵션별 n%·NPS·전후 개선폭). 경영 KPI 블록 상단 포함.
- **인코딩**: UTF-8 with BOM(`\uFEFF`) + CRLF, 필드 이스케이프(`"`,`,`,개행). `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename*=UTF-8''<URL인코딩>.csv`. MVP=CSV 2종(scope=all이면 zip), 단일 멀티시트 xlsx 요구 시에만 `exceljs` 도입(SheetJS 비권장).

---

## 6. 첫 설문 문항 전문

> 메타: `slug` 예 `claude-code-productivity`, `access_mode=authenticated`, `is_anonymous=true`, `status` 운영 시 `open`. 비평 3건 반영 최종본 25문항. S0Q3='사용한 적 없음' 또는 S0Q4='거의 사용 안 함' 선택 시 S1~S3 스킵 → S4로 이동. before/after 제시 순서는 응답자 간 무작위화(시스템 처리).

### S0. 응답자 배경 (7문항)
**섹션 설명**: 교차분석용 익명 배경 문항. 본 조사는 업무 도구(Claude Code) 활용 실태·개선점 파악이 목적이며, 도구가 도움이 안 되었거나 불편했던 점도 똑같이 중요합니다. 응답은 개인 식별 없이 직무·경력 등 그룹 단위로만 집계됩니다. 로그인 정보는 중복 제출 방지·도입 전후 매칭에만 쓰이며 분석·보고 단계에서는 응답이 개인정보와 분리되어 누가 무엇을 답했는지 관리자도 확인할 수 없습니다.

| ref | 문항 | 타입 | 옵션/척도 | 집계지표 |
|---|---|---|---|---|
| S0Q1 | 현재 담당하시는 주 직무 분야는? (req) | single_choice (명목 `ordinal=false`) | 개발/엔지니어링 · 데이터/AI/ML · 인프라/DevOps/SRE · QA/품질 · 기획/PM · 디자인/UX · 경영지원(HR·총무·재무 등) · 기타 | 직무군 분포(`s0q1_role`). 모든 효과지표 1차 교차축(개발 vs 비개발). 평균·상관 제외 |
| S0Q2 | 전체 직장 경력은? (req) | single_choice (순서형) | 1년 미만 · 1~3년 · 4~7년 · 8~12년 · 13년 이상 | 경력 분포(`s0q2_tenure`). 주니어 vs 시니어 효과·ROI 교차(역량보완 가설) |
| S0Q3 | Claude Code 사용 기간은? (req) | single_choice (순서형) | 사용한 적 없음 · 1개월 미만 · 1~3개월 · 4~6개월 · 7~12개월 · 1년 이상 | 사용기간 분포(`s0q3_duration`). `is_user` 1차 기준('사용한 적 없음'→비사용자). 학습곡선 추세, S1 Δ 회상거리 층화. S0Q5 정합성 체크 |
| S0Q4 | 최근 1개월 사용 빈도는? (req) | single_choice (순서형) | 거의 사용 안 함 · 월 1~3회 · 주 1~2회 · 주 3~4회 · 거의 매일 | 사용빈도 분포(`s0q4_frequency`). `is_user` 2차 기준('거의 사용 안 함'→비사용자). dose-response, 헤비유저(주3회+) 모수 정의 |
| S0Q5 | 현재 주로 쓰는 라이센스 형태는? (req) | single_choice (명목) | 회사 제공 유료 · 회사 제공+개인 유료 병행 · 개인 유료(자비) · 개인 무료 플랜 · 사용하지 않음 | 라이센스 분포(`s0q5_license`). 자비/병행 비율=잠재(미충족) 수요. S0Q3 미사용 정합성 체크 |
| S0Q6 | 조직 내 역할에 가장 가까운 것은? (req) | single_choice (명목) | 개인 기여자(실무) · 팀 리드·파트장 · 부서장 이상 · 해당 없음 | 역할 분포(`s0q6_position`). 모든 효과·지지도 2차 교차축. 관리자·예산권자(팀리드+)의 S4Q2 별도 표기로 호의편향 분리 |
| S0Q7 | 사용 전부터 써온 다른 AI 도구(모두 선택). '없음' 단독 (req) | multi_choice | 없음(Claude Code가 처음) · GitHub Copilot 등 코드 자동완성 · ChatGPT·Gemini 등 챗봇 · Cursor·Windsurf 등 AI IDE · 기타 AI 도구 | 이전 AI 사용률(`s0q7_prior_ai_*` 0/1, '없음' 단독 검증). 공변량으로 순증분 분리, '없음'군 Δ 별도 보고(인과 귀속 방어) |

### S1. 도입 전후 비교 (5문항)
**섹션 설명**: 각 항목을 'Claude Code 도입 전'과 '현재' 두 시점으로 동일 5점 척도 평가(`value_json={before,after}`, Δ=현재−도입 전). **'도입 전'은 처음 사용하기 시작한 시점 직전의 약 한 달을 기준**으로 떠올려 주세요(공통 앵커). 모든 항목 '높을수록 긍정', 생산성 외 학습·자기효능감·정신적 여유도 함께 살핍니다. 변화가 없었다면 두 시점을 같게 두셔도 됩니다. (미사용자는 본 섹션 스킵)

| ref | 문항 | 타입 | 척도 | 집계지표 |
|---|---|---|---|---|
| S1Q1 | 전반적 업무 생산성(같은 시간 처리량) — 도입 전/현재 (req) | pre_post_scale | 1 매우 낮음 ~ 3 보통 ~ 5 매우 높음 | 전·현재 평균·Δ·개선율%, 대응표본 t·Cohen's d. 도입효과 대표 KPI(대시보드 메인). pairwise·straight-line 플래그. `s1q1_before/after/delta`. S0 전 세그먼트 교차. **S2Q1·S2Q2와 ROI 합산 금지** |
| S1Q2 | 산출물 품질·완성도 — 도입 전/현재 (req) | pre_post_scale | 1 매우 낮음 ~ 5 매우 높음 | 전·현재 평균·Δ·개선율; 품질Δ↔속도Δ(S1Q1) 상관(속도-품질 트레이드오프). `s1q2_before/after/delta` |
| S1Q3 | 신기술·도메인·코드베이스 적응(학습·온보딩) 속도 — 도입 전/현재 (req) | pre_post_scale | 1 매우 낮음 ~ 5 매우 높음 | 전·현재 평균·Δ·개선율; 경력(S0Q2)·직무(S0Q1) 교차로 주니어·신규입사 역량보완 검증. `s1q3_before/after/delta` |
| S1Q4 | 복잡한 문제를 (도구 도움 포함) 끝까지 해결할 자신감 — 도입 전/현재 (req) | pre_post_scale | 1 매우 낮음 ~ 5 매우 높음 | 전·현재 평균·Δ·개선율(문제해결 자기효능감). `s1q4_before/after/delta`. 과의존/탈숙련은 단정 않고 S3Q3 '과의존 우려'와 삼각검증 |
| S1Q5 | 업무 중 정신적 여유(쫓기지 않고 차분히) — 도입 전/현재 (req) | pre_post_scale | 1 매우 부족 ~ 3 보통 ~ 5 매우 충분 | 전·현재 평균·Δ·개선율(여유↑=인지부하·번아웃↓). 웰빙 헤드라인, 리텐션 시그널. `s1q5_before/after/delta` |

### S2. 정량 효과 (4문항)
**섹션 설명**: 시간 절감·처리량·비용 대비 가치를 수치로 파악. 추정 어려우면 대략 답하셔도 되며 솔직한 '효과 없음'도 똑같이 중요합니다. (미사용자 스킵)

| ref | 문항 | 타입 | 옵션/척도 | 집계지표 |
|---|---|---|---|---|
| S2Q1 | 주당 평균 절감 업무 시간 추정(시간/주). 가늠 어렵거나 절감 없으면 0 (req) | number | 단위 시간/주, min 0 | 평균·중앙값·분포(>40h/주 트리밍 전후), 무응답·0 비율 병기, 신뢰구간·민감도. **최핵심 ROI KPI**(×사용인원×인건비). `s2q1_hours`. 자기보고 반사실 상향편향 명시, **S2Q2·S1Q1과 합산 금지** |
| S2Q2 | 같은 시간 처리량은 도입 전 대비 얼마나 증가? (req) | single_choice (순서형 `ordinal=true`) | 변화 없음 또는 감소 · 1~10% · 11~25% · 26~50% · 51~100% · 100%(2배) 이상 | 구간 분포(`s2q2_throughput`). `option_midpoints` 고정(0/5.5/18/38/75/125%)으로 가중 throughput multiplier. '변화없음/감소'=0% 상향편향은 보수(−10%) 병기. **합산 금지(수렴타당도)** |
| S2Q3 | 인지하는 라이센스 비용 대비 체감 가치? 모르면 마지막 보기 (req) | single_choice (순서형, '비용 모름' 제외) | 비용보다 훨씬 큼 · 큼 · 비슷 · 작음 · 훨씬 작음 · 라이센스 비용을 알지 못함 | 분포(`s2q3_value`). '비용 이상(훨씬 큼+큼)'% = ROI 정당성 핵심 KPI. '비용 모름' 분모 제외 + 비율 별도 노출(과반 시 보조 강등). 유효 n 병기 |
| S2Q4 | 절감 시간을 주로 어디에 재투자? (모두). '특별히 달라진 것 없음' 단독 (req, 사용자) | multi_choice | 더 난이도 높은 업무 · 더 많은 처리량 · 품질개선·리팩터링 · 학습·역량개발 · 신규/사이드 프로젝트 · 휴식·워라밸 · 협업·소통 · 특별히 달라진 것 없음 | 재투자 영역 선택률(`s2q4_reinvest_*` 0/1, 단독 검증). 생산성형 vs 웰빙형 비중으로 ROI 질적 해석. 사용자 모수 응답률 병기(무응답≠'없음') |

### S3. 정성 효과 (3문항)
**섹션 설명**: 정량 보완 정성 데이터. 긍정 편향 상쇄 위해 한계·장애요인도 동등 수집. 자유서술은 익명 처리. (미사용자 스킵)

| ref | 문항 | 타입 | 옵션 | 집계지표 |
|---|---|---|---|---|
| S3Q1 | 주로 어떤 업무에 활용? (모두) (req) | multi_choice | 기능구현·코드작성 · 디버깅 · 코드리뷰 · 테스트작성 · 리팩터링 · 문서·리포트 · 데이터분석·쿼리·스크립트 · 리서치·기획·아이디어 · 학습·신기술 · 반복업무 자동화 · 기타 | 활용 영역 선택률(`s3q1_use_*` 0/1). S1Q1~Q5 Δ와 교차로 '많이 쓰고 효과 큰' 고효과 영역 우선순위화 |
| S3Q2 | 효과가 가장 컸던 사례, 또는 새롭게 가능해진 업무 자유서술 (**선택**) | textarea | — | 정성 코딩 후 빈도·대표 인용. 경영 보고 성공사례·capability expansion 풀(`s3q2_case`). 응답률 병기 |
| S3Q3 | 느낀 한계·활용 망설이게 한 장애요인? (모두). '특별한 한계 없음' 단독 (**req**) | multi_choice | 결과 신뢰성·정확도(환각·검증필요) · 보안·정보유출 우려 · 긴 컨텍스트·대규모 코드 이해 한계 · 학습곡선·사용법 어려움 · 결과 검증 추가시간 · 과의존 우려 · 사내 가이드 부재 · 기존 워크플로·사내 시스템 연동 어려움 · 라이센스·사용량 제한 · 특별한 한계·장애물 없음 | 장애요인 선택률(`s3q3_barrier_*` 0/1, 단독 검증). 부정 결과(환각·검증시간·보안) 구조적 수집 채널. → S4Q5 처방 매핑. 비사용·라이트유저(S0Q4) 교차로 미활용 원인 진단 |

### S4. 향후 기대 및 도구 활용 방향 (6문항)
**섹션 설명**: 앞으로의 활용 방향 파악. 추천 의향·지지도·중단 영향·기대효과. 도움 안 되거나 불편했던 점 포함 솔직한 의견 모두 중요. 사용 경험 없는 분은 일부 문항을 '해당 없음'으로 답하거나 건너뛸 수 있습니다.

| ref | 문항 | 타입 | 옵션/척도 | 집계지표 |
|---|---|---|---|---|
| S4Q1 | 동료에게 Claude Code 도입 추천 의향? (req) | nps | 0 전혀 추천 안 함 ~ 10 적극 추천 | NPS=추천(9~10)%−비추천(0~6)%. 헤드라인 '사용자 모수' 기본 + 전사/사용자 이중 분모(n). 비사용자='기대기반' 분리. 세그먼트 최소 n=20~30 게이트, 미달 시 개발 vs 비개발 collapse + 분포 표기. `s4q1_nps_score`, `s4q1_nps_group`, `is_user` |
| S4Q2 | 회사가 라이센스를 계속 제공(유지)하는 것에 동의? (req) | scale | 1 전혀 동의 안 함 ~ 3 보통 ~ 5 매우 동의 | 유지 지지도 평균·top-2-box%(`s4q2_support`). 경영 요약 핵심 KPI. 확대 수요는 S4Q5·S0Q5로 간접 추정. 관리자·예산권자(S0Q6) 별도 표기로 호의편향 점검, NPS·중단영향과 삼각검증. 사용자/전원 분모 병기 |
| S4Q3 | 라이센스 사용 불가 시 업무 영향? 판단 어려우면 마지막 보기 (req) | single_choice (순서형, '해당 없음' 제외) | 거의 영향 없음 · 다소 불편하나 대체 가능 · 생산성 눈에 띄게 저하 · 핵심 업무에 상당한 지장 · 매우 어려움(대체 없음) · 해당 없음(미사용) | 분포(`s4q3_discontinue_impact`). '상당+매우'%=인지가치·의존도·기회비용(사용자 모수). '해당 없음'·비사용자 분모 제외. S2Q1과 상관으로 ROI 보강 |
| S4Q4 | 가장 기여 기대하는 효과? (최대 3개). '없음'·'잘 모르겠음' 각 단독 (선택) | multi_choice | 속도 향상 · 품질 향상 · 새 역량 확보 · 온보딩 가속 · 업무부담·야근 감소 · 새 업무·사업 시도 · 반복업무 자동화 확대 · 전사 생산성·학습 문화 확산 · 특별히 기대 없음 · 잘 모르겠음 | 기대효과 선택률(`s4q4_expect_*` 0/1, 최대 3, 단독 검증). 향후 기대가치 우선순위. 우려는 S3Q3·S4Q6 보완 |
| S4Q5 | 활용 확대 위해 회사가 필요한 지원? (모두). '특별히 필요 없음' 단독 (선택) | multi_choice | 교육·온보딩 · 사내 가이드·프롬프트·BP 공유 · 상위 플랜·시트 확대 · 보안·정보보호 가이드 · 우수사례 세션·커뮤니티·챔피언 · MCP·사내 시스템 연동 · 사례·템플릿 라이브러리 · 특별히 필요 없음 | 지원니즈 선택률(`s4q5_support_*` 0/1, 단독 검증). S3Q3 장애요인 대비 처방 매핑(인에이블먼트·변화관리 우선순위). '시트 확대'%=확대 수요 간접 지표 |
| S4Q6 | 활용 확대·회사 지원 관련 자유 의견(옹호·우려·개선 모두) (선택) | textarea | — | 정성 코딩 — 옹호/우려 분류 및 경영 보고 인용(`s4q6_message`) |

---

## 7. 비기능 요건 / 엣지케이스

- **중복 응답(authenticated)**: `survey_responses_unique_user` partial unique로 DB 강제. `submit_survey_response`가 동일 1행 upsert → 전후매칭·재제출 모두 같은 행. 이미 `is_complete=true`면 `already_submitted` 예외 → API 409.
- **중복 응답(public)**: `respondent_hash` partial unique로 DB 강제(결정 #11). RPC가 hash 충돌 시 `already_submitted`. hash는 클라이언트 토큰/IP+UA 해시(비식별, best-effort).
- **마감 후 응답**: RPC가 `status='open'`이 아니면 `survey_not_open` 예외(409/410). 시간창(`opens_at`/`closes_at`)은 RLS상 장식적이므로 운영은 status를 `closed`로 토글해 실효화(방어심도: 페이지+API도 차단).
- **익명/공개 모드**: anon은 `submit_survey_response` RPC가 유일 쓰기 경로(직접 INSERT/UPDATE 플로우의 '완료 불가' 데드락 해소). 미들웨어 `/survey` 화이트리스트 + 페이지/API가 access_mode로 실접근 제어. anon 정책·grant는 public 설문 실제 필요 시점까지 보류 가능, 적용 시 `get_advisors(security)` 필수.
- **제출 후 불변(재오픈 차단)**: `survey_responses_update` USING에 `is_complete=false` 조건 → 사용자가 완료 응답을 되돌릴 수 없음. 답변(`survey_answers`)도 `survey_response_is_writable`(is_complete=false 요구)로 보호.
- **미완료(부분) 응답**: `is_complete=false`로 잔존. 집계는 기본 제외(대시보드 토글로 포함 가능). 분기 스킵 결측은 0·평균 대체 금지, pairwise 제외(MNAR).
- **관리자 익명성**: 모든 분석은 `get_survey_aggregate` RPC만 사용(결과에 user_id 미포함) + n<5 세그먼트 마스킹. CSV raw도 식별정보 기본 제외(`includeIdentity=true` 감사 예외).
- **분기 처리**: S0Q3='사용한 적 없음' OR S0Q4='거의 사용 안 함' → 비사용자(S1~S3 스킵). 헤드라인 KPI(S4Q1·S4Q3)는 사용자 모수 기본 + 이중 분모 병기, 비사용자는 '기대기반' 라벨 분리.
- **분모/모수 라벨**: 전 차트·KPI 카드에 모수(전체/사용자/헤비유저) 강제 표기.
- **응답 시간**: 25문항 7~10분(기존 5~7분 추정은 낙관적 → 상향 고지).
- **한글 인코딩**: CSV UTF-8 BOM + CRLF + 필드 이스케이프.
- **성능**: 집계 1콜 RPC(서버측), 인덱스(survey_id·order_index·response_id·question_id) 보장.

---

## 8. 범위 밖 (YAGNI)

- 설문 분기 로직(skip-logic)의 빌더 GUI 편집 — 첫 설문은 코드 레벨 분기(is_user) 고정. 범용 조건 분기 빌더는 미구현.
- 실시간 응답 스트리밍/대시보드 라이브 갱신(WebSocket) — 폴링/새로고침으로 충분.
- 다국어 설문(i18n) — 한국어 단일.
- 응답 초안 서버 자동저장(부분응답 재개) — 제출 단일 RPC, 클라 상태로만 진행률 유지.
- 통계 추론 자동화(자동 t검정·p값 리포트 UI) — 분석은 기술통계 + Δ/NPS/top-box. 추론검정은 CSV 내보내 외부 도구.
- 차트 라이브러리/엑셀 라이브러리 선도입 — 0-dependency로 시작, 고도화 시 shadcn chart(Recharts)/exceljs 선택.
- anon 비인증 표면 전면 활성화 — 첫 설문 authenticated이므로 public 정책·grant는 실제 공개 설문 필요 시점까지 보류.
- 이메일/푸시 설문 발송·리마인더, 응답 인센티브 관리 — 범위 외.
- 문항 버전 관리/응답 후 문항 변경 마이그레이션 — 운영 중 문항 변경은 지양(open 전 확정).

---

### 부록 — 핵심 파일 경로 (절대경로)
- 마이그레이션: 본 문서 §3.2 + §3.3에 전문 인라인. 구현 시 `mcp__supabase__apply_migration`(name: `survey_system_init`)으로 합본 적용 후 `get_advisors(security)` 검토.
- 타입: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/types/survey.ts`
- lib: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/survey.ts`, `.../lib/survey-metrics.ts`
- 진입점: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/roles.ts`, `.../lib/supabase-middleware.ts`, `.../app/page.tsx`, `.../app/admin/layout.tsx`
- admin 게이트 레퍼런스: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/chat-history/route.ts`

🕐 현재 시각: 2026-06-26 (KST)