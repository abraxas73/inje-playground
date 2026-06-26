I have everything I need. Two findings materially affect the medium fixes: login is **Google OAuth only** (no email/password form — the E2E UI-login is infeasible, must use Phase2's programmatic-session helper), and the browser client is `createClient()` from `@/lib/supabase` (usable for the app_settings ROI fetch). Here is the finalized plan.

---

# Phase 3 — 분석 출력(대시보드·요약·내보내기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Execute each Task as an isolated unit, in order. Track progress with the checkboxes (`- [ ]`) in each Task — check a box only after its command/step succeeds with the stated expected output. Each Task ends in an independently testable artifact. Do not batch commits across Tasks; commit exactly where a step says "커밋".

**Goal**: 관리자가 응답을 익명 집계로 보고, 경영 요약 KPI 5종(+ROI·신호등)을 확인하고, CSV로 내보낼 수 있다. 집계는 단일 RPC `get_survey_aggregate`로 서버측 계산되고, 클라이언트는 표시·CSV 후처리만 한다.

**Architecture**: Next.js 16 App Router(React 19, 전 페이지 `"use client"`) + Supabase(Postgres RPC, RLS). 집계 단일 경로 = `get_survey_aggregate`(SECURITY DEFINER, n<5 마스킹, 관리자 익명성). 차트/엑셀/DnD 라이브러리 0개 — CSS/SVG 프리미티브 + UTF-8 BOM CSV(zip 미사용). admin 게이트는 `app/api/admin/chat-history/route.ts` 패턴(401/403).

**Tech Stack**: TypeScript strict, Tailwind 4, shadcn/ui(Card·Tabs·Popover·Checkbox·Select·Button·Badge), lucide-react, Vitest(순수 로직 TDD), Playwright(E2E), `@supabase/supabase-js`(E2E 서비스롤 시드) / `@/lib/supabase` `createClient()`(브라우저 클라이언트).

## Global Constraints

- config 키는 snake_case만 — `min_label`/`allow_other`/`analysis_metric`/`top_box`/`segment`/`target`/`option_midpoints`/`ordinal`/`unit`.
- 쓰기는 `submit_survey_response` RPC 단일 경로, 집계는 `get_survey_aggregate` RPC 단일 경로. 클라 TS 집계 금지(CSV 후처리만 허용).
- row 타입은 전부 `updated_at` 포함, timestamptz는 ISO `string`, nullable은 `| null`.
- 분석 출력에 `respondent_user_id`/`respondent_hash` 절대 미포함(관리자 익명성). CSV는 `includeIdentity=true`만 예외.
- n<5 세그먼트 셀 마스킹(`masked:true`). pre_post Δ는 pairwise만, 결측 0/평균대체 금지.
- admin 게이트는 `chat-history/route.ts` 패턴 그대로(401/403). 동적 라우트 `{ params }: { params: Promise<{ id: string }> }` + `await params` 필수.
- 신규 차트/dnd/엑셀/zip 라이브러리 0개. xlsx 단일 멀티시트 요구 시에만 `exceljs`(v1 미도입 → `format=xlsx`는 명시적 400). **`scope=all`은 zip이 아니라 단일 BOM·다중 섹션 CSV로 직렬화**(BOM 1회, 섹션 구분 행).
- **`is_user` 단일 정의 = Phase1 Task6의 `isUserResponse()`(옵션 value-key 기준: `s0q3_value === "never"` OR `s0q4_value === "rarely"` → 비사용자). Phase3에서 재정의/재구현 금지 — 중복 정의 금지 불변식.** 시드(Phase1 Task9)·SurveyForm(Phase1 Task7)은 single_choice의 `value`(=key, value_text 저장)를 넘기므로 한글 라벨 비교는 절대 매칭되지 않는다.
- **세그먼트 매칭은 문항 타입별 분기**: single_choice → `value_text` 일치, multi_choice → `value_json` 배열 교집합. (RPC 본문이 문항 type을 조회해 분기.)
- **모수 라벨 강제**: v1 서버 집계 모수 = `is_complete=true` 완료응답 전수. 단, 스킵 로직으로 S1~S4 사용자 문항은 비사용자가 응답행을 남기지 않으므로 해당 문항의 per-question `n`은 사실상 **사용자 모수**다. `populationLabel`은 섹션 기반으로 표기(S0 → "전체", 그 외 → "사용자"). KPI 카드의 `population_label`(레지스트리 정의)과 실제 집계 모수가 이 규칙으로 일치한다.
- DB: `mcp__supabase__apply_migration`(create or replace) 적용 후 `mcp__supabase__get_advisors(security)` 확인. 적용 전 트랜잭션 내 실행→롤백 사전검증.
- 모든 npm 명령은 `frontend/` 기준. 타입: `cd frontend && npm run build` / 품질: `cd frontend && npm run lint` / 단위: `cd frontend && npm test`.

**v1 범위 외 (의도적 YAGNI — 스펙 §8 이관 대상)**: 헤비유저(주3회+) 별도 모수 분리, 상단 "비교 모드(개발 vs 비개발)" side-by-side, NPS 파생 group 컬럼(promoter/passive/detractor)의 raw CSV 분해, S3Q3↔S4Q5 처방 매핑, S1 구성개념 레이더. 세그먼트 필터로 부분 대체 가능하며 v1에서는 구현하지 않는다.

**Phase 1 Consumes (동결)**: `@/types/survey`(QuestionAggregate·SurveyResultSummary·SegmentFilter·NpsStats·ScaleStats·NumberStats·PrePostStats·OptionCount·SurveyWithQuestions·QuestionConfig), `@/lib/survey-metrics`(시그니처 §계약3, **`isUserResponse`는 Phase1 구현 완료 — 본 Phase에서 손대지 않음**), `get_survey_aggregate` RPC 스켈레톤(스펙 §3.3.2), admin 게이트 패턴, Vitest/Playwright 설치(Phase1 T1), `claude-code-productivity` 시드 설문.
**Phase 2 Consumes**: `GET /api/admin/surveys/[id]`(SurveyWithQuestions, config 포함), 빌더가 저장한 `config.analysis_metric`/`segment`/`top_box`/`target`/`option_midpoints` 태그, `e2e/helpers/auth.ts`의 `loginAsAdmin`(Phase2 Task10 — 프로그램적 세션 주입; 앱은 Google OAuth 전용으로 자격증명 폼이 없음).

---

### Task 1: `get_survey_aggregate` RPC 본문 구현 (집계 단일 경로)

**Files**
- Modify(create or replace, apply_migration `survey_aggregate_impl`): `public.get_survey_aggregate(uuid, jsonb)` — 스펙 §3.3.2 스켈레톤을 실제 집계 본문으로 교체.

**Interfaces**
- Consumes: `public.survey_questions`/`survey_responses`/`survey_answers`(스펙 §3.2), `private.is_admin()`.
- Produces: `jsonb` = `SurveyResultSummary` 형태(`@/types/survey`). 각 question 카드에 **추가 런타임 메타** `analysis_metric`/`target`/`top_box`/`option_midpoints`를 부가(동결 `QuestionAggregate`의 알려진 필드는 불변, 추가 메타는 `survey-metrics`의 KPI 결선 전용 — 컴포넌트는 미참조).
- 세그먼트 매칭은 문항 type별 분기(single → `value_text`, multi → `value_json` 교집합).

- [ ] **1.1 게이트·GUC 사전 확인**: `mcp__supabase__execute_sql`로 (a) 현재 함수가 게이트를 던지는지, (b) `private.is_admin()`/`auth.uid()`가 참조하는 GUC가 무엇인지 확인.
```sql
-- (a) 게이트 동작
select public.get_survey_aggregate('00000000-0000-0000-0000-000000000000'::uuid);
-- 기대: ERROR: forbidden

-- (b) auth.uid()가 읽는 GUC 확인(둘 다 주입할 것이므로 정의만 확인)
select pg_get_functiondef('auth.uid()'::regprocedure);
```
기대: (a) `ERROR: forbidden`(관리자 컨텍스트 아님 → 게이트 정상). (b) 정의에 `request.jwt.claim.sub` 및/또는 `request.jwt.claims`가 등장 — 1.3에서 두 GUC를 모두 주입한다.

- [ ] **1.2 RPC 본문 구현(apply_migration)**: `mcp__supabase__apply_migration`(name: `survey_aggregate_impl`)로 아래 전문 적용. (세그먼트 필터는 `seg_typed` CTE로 문항 type별 분기.)
```sql
create or replace function public.get_survey_aggregate(
  p_survey_id uuid,
  p_segments jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resp_ids      uuid[];
  v_total         integer;
  v_all_total     integer;
  v_complete_rate numeric;
  v_avg_dur       numeric;
  v_questions     jsonb := '[]'::jsonb;
  v_q             record;
  v_card          jsonb;
  v_qn            integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden';
  end if;

  -- 세그먼트 AND(across) + OR(within), 문항 타입별 매칭(single→value_text, multi→value_json overlap)
  with seg as (
    select (e->>'question_id')::uuid as qid,
           array(select jsonb_array_elements_text(e->'values')) as vals
    from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) e
  ),
  seg_typed as (
    select s.qid, s.vals, q.type
    from seg s
    join public.survey_questions q on q.id = s.qid
  ),
  filtered as (
    select r.id, r.meta
    from public.survey_responses r
    where r.survey_id = p_survey_id
      and r.is_complete = true
      and not exists (
        select 1 from seg_typed s
        where not exists (
          select 1 from public.survey_answers a
          where a.response_id = r.id
            and a.question_id = s.qid
            and (
              (s.type = 'multi_choice'
                and a.value_json is not null
                and exists (
                  select 1 from jsonb_array_elements_text(a.value_json) ev
                  where ev = any(s.vals)
                ))
              or (s.type <> 'multi_choice' and a.value_text = any(s.vals))
            )
        )
      )
  )
  select coalesce(array_agg(id), '{}'::uuid[]), count(*),
         avg(nullif(meta->>'duration_sec','')::numeric)
  into v_resp_ids, v_total, v_avg_dur
  from filtered;

  select count(*) into v_all_total
  from public.survey_responses where survey_id = p_survey_id;

  v_complete_rate := case when v_all_total > 0
    then round(v_total * 100.0 / v_all_total, 1) else 0 end;

  for v_q in
    select * from public.survey_questions
    where survey_id = p_survey_id order by order_index
  loop
    select count(*) into v_qn
    from public.survey_answers a
    where a.question_id = v_q.id and a.response_id = any(v_resp_ids)
      and (a.value_text is not null or a.value_number is not null or a.value_json is not null);

    if v_qn < 5 then
      v_card := jsonb_build_object(
        'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
        'type', v_q.type, 'title', v_q.title, 'n', v_qn, 'masked', true);

    elsif v_q.type = 'single_choice' then
      v_card := jsonb_build_object(
        'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
        'type', 'single_choice', 'title', v_q.title, 'n', v_qn, 'masked', false,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'value', opt->>'value', 'label', opt->>'label', 'n', coalesce(c.n,0),
            'pct', case when v_qn>0 then round(coalesce(c.n,0)*100.0/v_qn,1) else 0 end))
          from jsonb_array_elements(coalesce(v_q.config->'options','[]'::jsonb)) opt
          left join (
            select value_text v, count(*) n from public.survey_answers
            where question_id = v_q.id and response_id = any(v_resp_ids) and value_text is not null
            group by value_text) c on c.v = opt->>'value'), '[]'::jsonb));

    elsif v_q.type = 'multi_choice' then
      v_card := jsonb_build_object(
        'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
        'type', 'multi_choice', 'title', v_q.title, 'n', v_qn, 'masked', false, 'respondent_n', v_qn,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'value', opt->>'value', 'label', opt->>'label', 'n', coalesce(c.n,0),
            'pct', case when v_qn>0 then round(coalesce(c.n,0)*100.0/v_qn,1) else 0 end))
          from jsonb_array_elements(coalesce(v_q.config->'options','[]'::jsonb)) opt
          left join (
            select elem v, count(*) n
            from public.survey_answers a, lateral jsonb_array_elements_text(a.value_json) elem
            where a.question_id = v_q.id and a.response_id = any(v_resp_ids) and a.value_json is not null
            group by elem) c on c.v = opt->>'value'), '[]'::jsonb));

    elsif v_q.type = 'nps' then
      declare v_prom numeric; v_pass numeric; v_detr numeric;
      begin
        select round(count(*) filter (where value_number>=9)*100.0/nullif(v_qn,0),1),
               round(count(*) filter (where value_number between 7 and 8)*100.0/nullif(v_qn,0),1),
               round(count(*) filter (where value_number<=6)*100.0/nullif(v_qn,0),1)
        into v_prom, v_pass, v_detr
        from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null;
        v_card := jsonb_build_object(
          'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
          'type', 'nps', 'title', v_q.title, 'n', v_qn, 'masked', false,
          'stats', jsonb_build_object('n', v_qn,
            'score', round(coalesce(v_prom,0)-coalesce(v_detr,0),1),
            'promoters_pct', coalesce(v_prom,0), 'passives_pct', coalesce(v_pass,0),
            'detractors_pct', coalesce(v_detr,0)));
      end;

    elsif v_q.type = 'scale' then
      declare v_mean numeric; v_med numeric; v_sd numeric; v_min numeric; v_max numeric;
              v_dist jsonb; v_topbox numeric;
      begin
        select avg(value_number), percentile_cont(0.5) within group (order by value_number),
               stddev_samp(value_number), min(value_number), max(value_number)
        into v_mean, v_med, v_sd, v_min, v_max
        from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null;
        select jsonb_agg(jsonb_build_object('value', val, 'n', cnt) order by val) into v_dist
        from (select value_number::int val, count(*) cnt from public.survey_answers
              where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null
              group by value_number::int) d;
        if v_q.config ? 'top_box' then
          select round(count(*) filter (where value_number::int::text = any(
                   array(select jsonb_array_elements_text(v_q.config->'top_box'))))*100.0/nullif(v_qn,0),1)
          into v_topbox from public.survey_answers
          where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null;
        else v_topbox := null; end if;
        v_card := jsonb_build_object(
          'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
          'type', 'scale', 'title', v_q.title, 'n', v_qn, 'masked', false,
          'stats', jsonb_build_object('n', v_qn, 'mean', round(v_mean,2), 'median', v_med,
            'sd', round(v_sd,2), 'min', v_min, 'max', v_max,
            'distribution', coalesce(v_dist,'[]'::jsonb), 'top_box_pct', v_topbox));
      end;

    elsif v_q.type = 'number' then
      declare v_mean numeric; v_med numeric; v_sum numeric; v_min numeric; v_max numeric;
              v_trim numeric; v_zero numeric;
      begin
        select avg(value_number), percentile_cont(0.5) within group (order by value_number),
               sum(value_number), min(value_number), max(value_number),
               round(count(*) filter (where value_number=0)*100.0/nullif(v_qn,0),1)
        into v_mean, v_med, v_sum, v_min, v_max, v_zero
        from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null;
        select avg(value_number) into v_trim from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null
          and value_number <= (select percentile_cont(0.95) within group (order by value_number)
            from public.survey_answers
            where question_id = v_q.id and response_id = any(v_resp_ids) and value_number is not null);
        v_card := jsonb_build_object(
          'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
          'type', 'number', 'title', v_q.title, 'n', v_qn, 'masked', false,
          'stats', jsonb_build_object('n', v_qn, 'mean', round(v_mean,2), 'median', v_med,
            'sum', v_sum, 'min', v_min, 'max', v_max, 'mean_trimmed', round(v_trim,2),
            'zero_pct', coalesce(v_zero,0), 'unit', v_q.config->>'unit'));
      end;

    elsif v_q.type = 'pre_post_scale' then
      declare v_npair int; v_bmean numeric; v_amean numeric; v_bdist jsonb; v_adist jsonb;
      begin
        select count(*), avg((value_json->>'before')::numeric), avg((value_json->>'after')::numeric)
        into v_npair, v_bmean, v_amean
        from public.survey_answers
        where question_id = v_q.id and response_id = any(v_resp_ids)
          and value_json ? 'before' and value_json ? 'after'
          and value_json->>'before' is not null and value_json->>'after' is not null;
        select jsonb_agg(jsonb_build_object('value', val, 'n', cnt) order by val) into v_bdist
        from (select (value_json->>'before')::int val, count(*) cnt from public.survey_answers
              where question_id = v_q.id and response_id = any(v_resp_ids)
                and value_json ? 'before' and value_json ? 'after'
              group by (value_json->>'before')::int) d;
        select jsonb_agg(jsonb_build_object('value', val, 'n', cnt) order by val) into v_adist
        from (select (value_json->>'after')::int val, count(*) cnt from public.survey_answers
              where question_id = v_q.id and response_id = any(v_resp_ids)
                and value_json ? 'before' and value_json ? 'after'
              group by (value_json->>'after')::int) d;
        v_card := jsonb_build_object(
          'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
          'type', 'pre_post_scale', 'title', v_q.title, 'n', v_qn, 'masked', false,
          'stats', jsonb_build_object('n_pairwise', coalesce(v_npair,0),
            'before_mean', round(v_bmean,2), 'after_mean', round(v_amean,2),
            'delta_mean', round(v_amean - v_bmean, 2),
            'improvement_pct', case when v_bmean > 0 then round((v_amean - v_bmean)*100.0/v_bmean,1) else null end,
            'before_distribution', coalesce(v_bdist,'[]'::jsonb),
            'after_distribution', coalesce(v_adist,'[]'::jsonb)));
      end;

    else -- text / textarea
      v_card := jsonb_build_object(
        'question_id', v_q.id, 'section', v_q.section, 'order_index', v_q.order_index,
        'type', v_q.type, 'title', v_q.title, 'n', v_qn, 'masked', false, 'text_n', v_qn);
    end if;

    -- KPI 결선용 추가 런타임 메타(컴포넌트 미참조, survey-metrics 전용)
    v_card := v_card || jsonb_build_object(
      'analysis_metric', v_q.config->>'analysis_metric',
      'target', case when v_q.config ? 'target' then (v_q.config->>'target')::numeric else null end,
      'top_box', coalesce(v_q.config->'top_box', '[]'::jsonb),
      'option_midpoints', coalesce(v_q.config->'option_midpoints', '{}'::jsonb));

    v_questions := v_questions || jsonb_build_array(v_card);
  end loop;

  return jsonb_build_object(
    'survey_id', p_survey_id, 'total_responses', v_total,
    'complete_rate', v_complete_rate, 'avg_duration_sec', round(coalesce(v_avg_dur,0)),
    'segments_applied', coalesce(p_segments, '[]'::jsonb), 'questions', v_questions);
end;
$$;
grant execute on function public.get_survey_aggregate(uuid, jsonb) to authenticated;
```

- [ ] **1.3 집계 정확성 검증(롤백 트랜잭션)**: `mcp__supabase__execute_sql`로 admin 컨텍스트를 주입(두 GUC 모두)한 트랜잭션에서 시드→호출→검증→롤백. 단일선택 세그먼트 + pre_post.
```sql
begin;
do $$
declare v_admin uuid; v_sid uuid; v_q1 uuid; v_q2 uuid; v_r uuid; i int; v_out jsonb;
begin
  select user_id into v_admin from public.user_profiles where role='admin' limit 1;
  -- auth.uid()가 두 GUC 중 무엇을 읽든 인가되도록 둘 다 주입
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  insert into public.surveys(slug,title,status) values ('agg-test-xyz','agg test','open') returning id into v_sid;
  insert into public.survey_questions(survey_id,order_index,type,title,config)
    values (v_sid,0,'single_choice','q1',
      '{"options":[{"value":"a","label":"A"},{"value":"b","label":"B"}],"segment":true}'::jsonb) returning id into v_q1;
  insert into public.survey_questions(survey_id,order_index,type,title,config)
    values (v_sid,1,'pre_post_scale','q2','{"min":1,"max":5,"analysis_metric":"pre_post_overall","target":1}'::jsonb) returning id into v_q2;
  for i in 1..6 loop
    insert into public.survey_responses(survey_id,is_complete,meta) values (v_sid,true,'{"duration_sec":300}') returning id into v_r;
    insert into public.survey_answers(response_id,question_id,value_text) values (v_r,v_q1, case when i<=4 then 'a' else 'b' end);
    insert into public.survey_answers(response_id,question_id,value_json) values (v_r,v_q2, json_build_object('before',2,'after',4)::jsonb);
  end loop;
  v_out := public.get_survey_aggregate(v_sid);
  raise notice 'TOTAL=% Q1=% Q2=%',
    v_out->>'total_responses',
    (v_out->'questions'->0->'options'),
    (v_out->'questions'->1->'stats');
end $$;
rollback;
```
기대 NOTICE: `TOTAL=6`, Q1 옵션 `a` n=4 pct=66.7 / `b` n=2 pct=33.3, Q2 stats `before_mean=2.00 after_mean=4.00 delta_mean=2.00 improvement_pct=100.0 n_pairwise=6`. 영구반영 0건(rollback). NOTICE가 `forbidden`으로 막히면 1.1(b)에서 확인한 정확한 GUC만 단독 주입해 재시도.

- [ ] **1.4 멀티 세그먼트 매칭 검증(롤백)**: 위 스크립트의 q1을 `multi_choice`(`value_json` 저장)로 바꾼 변형을 실행해, `p_segments=[{question_id:q1, values:["a"]}]` 호출 시 `value_json` 교집합 매칭으로 4건이 필터되는지 확인(빈 집계 버그 부재). 동시에 `for i in 1..4`로 줄여 Q1 카드가 `masked=true`·`options` 키 없음도 확인.

- [ ] **1.5 보안 어드바이저**: `mcp__supabase__get_advisors`(type: `security`) 실행. `get_survey_aggregate` 관련 신규 ERROR/WARN 0건 확인(SECURITY DEFINER + `set search_path` 적용됨).

- [ ] **1.6 커밋**: `git add -A && git commit -m "feat(survey): implement get_survey_aggregate RPC body (typed group-by + type-aware segments + n<5 masking + KPI meta)"` (마이그레이션은 원격 적용, 커밋엔 본 계획/추적 변경만 — 변경 없으면 빈 커밋 생략).

---

### Task 2: `survey-metrics.ts` 순수 산식 (Vitest TDD) — `isUserResponse` 제외

**Files**
- Modify: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/survey-metrics.ts` (Phase1 생성 파일에 산식 본문 추가)
- Modify: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/__tests__/survey-metrics.test.ts`

**Interfaces**
- Produces(동결 §계약3): `npsFromScores`, `prePostDelta`, `topBoxRatio`, `weightedMean`, `computeRoi`, `trafficLight`(+`TrafficLight`).
- **Not touched**: `isUserResponse` — Phase1 Task6에서 value-key(`"never"`/`"rarely"`) 기준으로 이미 구현·테스트됨. 본 태스크에서 **재정의·수정·재테스트 금지**(중복 정의 시 TS `Duplicate function implementation` + 의미 충돌). 아래 함수만 **append**한다(Phase1이 동일 함수의 throw 스텁을 남겼다면 해당 함수 본문만 교체).
- Consumes: `NpsStats`(`@/types/survey`).

- [ ] **2.1 실패 테스트 작성**: `survey-metrics.test.ts`에 아래 추가(Phase1의 기존 `isUserResponse` 테스트는 그대로 두고 건드리지 않는다).
```typescript
import { describe, it, expect } from "vitest";
import {
  npsFromScores, prePostDelta, topBoxRatio, weightedMean, computeRoi, trafficLight,
} from "@/lib/survey-metrics";

describe("npsFromScores", () => {
  it("추천(≥9)%−비추천(≤6)% with 1-decimal rounding", () => {
    const r = npsFromScores([10, 10, 9, 8, 7, 6, 0]);
    expect(r.n).toBe(7);
    expect(r.promoters_pct).toBe(42.9);
    expect(r.passives_pct).toBe(28.6);
    expect(r.detractors_pct).toBe(28.6);
    expect(r.score).toBe(14.3);
  });
  it("빈 배열은 null score", () => {
    const r = npsFromScores([]);
    expect(r.n).toBe(0);
    expect(r.score).toBeNull();
  });
});

describe("prePostDelta", () => {
  it("pairwise 평균·Δ·개선율", () => {
    const r = prePostDelta([{ before: 3, after: 5 }, { before: 2, after: 4 }]);
    expect(r.n_pairwise).toBe(2);
    expect(r.before_mean).toBe(2.5);
    expect(r.after_mean).toBe(4.5);
    expect(r.delta_mean).toBe(2);
    expect(r.improvement_pct).toBe(80);
  });
  it("빈 입력은 null", () => {
    const r = prePostDelta([]);
    expect(r.n_pairwise).toBe(0);
    expect(r.delta_mean).toBeNull();
    expect(r.improvement_pct).toBeNull();
  });
});

describe("topBoxRatio", () => {
  const counts = [{ value: "5", n: 3 }, { value: "4", n: 2 }, { value: "1", n: 5 }];
  it("top-box 비율(전체 분모)", () => {
    const r = topBoxRatio(counts, ["4", "5"]);
    expect(r.n_valid).toBe(10);
    expect(r.pct).toBe(50);
  });
  it("excludeValues 분모 제외", () => {
    const r = topBoxRatio(counts, ["4", "5"], ["1"]);
    expect(r.n_valid).toBe(5);
    expect(r.pct).toBe(100);
  });
  it("유효 0이면 null", () => {
    expect(topBoxRatio([], ["a"]).pct).toBeNull();
  });
});

describe("weightedMean", () => {
  it("option_midpoints 가중 평균", () => {
    const r = weightedMean([{ value: "a", n: 2 }, { value: "b", n: 2 }], { a: 0, b: 10 });
    expect(r.n).toBe(4);
    expect(r.mean).toBe(5);
  });
});

describe("computeRoi", () => {
  it("절감시간 ROI·회수기간", () => {
    const r = computeRoi({
      avg_weekly_hours_saved: 5, user_count: 10, hourly_cost: 30000,
      annual_license_cost: 6_000_000, weeks_per_year: 48,
    });
    expect(r.annual_hours_saved).toBe(2400);
    expect(r.annual_value).toBe(72_000_000);
    expect(r.net_annual).toBe(66_000_000);
    expect(r.payback_months).toBe(1);
  });
  it("연간 가치 0이면 payback null", () => {
    const r = computeRoi({ avg_weekly_hours_saved: 0, user_count: 0, hourly_cost: 30000, annual_license_cost: 1000 });
    expect(r.payback_months).toBeNull();
  });
});

describe("trafficLight", () => {
  it("target 대비 신호등", () => {
    expect(trafficLight(5, 5)).toBe("green");
    expect(trafficLight(4, 5)).toBe("amber");
    expect(trafficLight(2, 5)).toBe("red");
    expect(trafficLight(3, undefined)).toBe("unset");
    expect(trafficLight(null, 5)).toBe("unset");
  });
});
```

- [ ] **2.2 실행해 실패 확인**: `cd frontend && npm test -- survey-metrics` → 함수 미구현/미export로 실패(`is not a function` 또는 import 에러). (Phase1의 `isUserResponse` 테스트는 계속 green이어야 함.)

- [ ] **2.3 최소 구현(append)**: `survey-metrics.ts`에 아래 산식 함수만 추가한다. **`isUserResponse`는 절대 포함하지 않는다.**
```typescript
import type { NpsStats } from "@/types/survey";

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function npsFromScores(scores: number[]): NpsStats {
  const n = scores.length;
  if (n === 0) {
    return { n: 0, score: null, promoters_pct: 0, passives_pct: 0, detractors_pct: 0 };
  }
  const prom = scores.filter((s) => s >= 9).length;
  const pass = scores.filter((s) => s >= 7 && s <= 8).length;
  const detr = scores.filter((s) => s <= 6).length;
  const promoters_pct = round1((prom * 100) / n);
  const passives_pct = round1((pass * 100) / n);
  const detractors_pct = round1((detr * 100) / n);
  return { n, score: round1(promoters_pct - detractors_pct), promoters_pct, passives_pct, detractors_pct };
}

export interface PrePostDelta {
  n_pairwise: number;
  before_mean: number | null;
  after_mean: number | null;
  delta_mean: number | null;
  improvement_pct: number | null;
}
export function prePostDelta(pairs: { before: number; after: number }[]): PrePostDelta {
  const n = pairs.length;
  if (n === 0) {
    return { n_pairwise: 0, before_mean: null, after_mean: null, delta_mean: null, improvement_pct: null };
  }
  const before_mean = pairs.reduce((s, p) => s + p.before, 0) / n;
  const after_mean = pairs.reduce((s, p) => s + p.after, 0) / n;
  const delta_mean = after_mean - before_mean;
  const improvement_pct = before_mean > 0 ? round1((delta_mean / before_mean) * 100) : null;
  return {
    n_pairwise: n,
    before_mean: round1(before_mean),
    after_mean: round1(after_mean),
    delta_mean: round1(delta_mean),
    improvement_pct,
  };
}

export function topBoxRatio(
  counts: { value: string; n: number }[],
  topBox: string[],
  excludeValues: string[] = [],
): { pct: number | null; n_valid: number } {
  const valid = counts.filter((c) => !excludeValues.includes(c.value));
  const n_valid = valid.reduce((s, c) => s + c.n, 0);
  if (n_valid === 0) return { pct: null, n_valid: 0 };
  const top = valid.filter((c) => topBox.includes(c.value)).reduce((s, c) => s + c.n, 0);
  return { pct: round1((top * 100) / n_valid), n_valid };
}

export function weightedMean(
  counts: { value: string; n: number }[],
  midpoints: Record<string, number>,
): { mean: number | null; n: number } {
  let num = 0;
  let n = 0;
  for (const c of counts) {
    const mid = midpoints[c.value];
    if (typeof mid === "number") {
      num += mid * c.n;
      n += c.n;
    }
  }
  if (n === 0) return { mean: null, n: 0 };
  return { mean: round1(num / n), n };
}

export interface RoiInput {
  avg_weekly_hours_saved: number;
  user_count: number;
  hourly_cost: number;
  annual_license_cost: number;
  weeks_per_year?: number;
}
export interface RoiResult {
  annual_hours_saved: number;
  annual_value: number;
  net_annual: number;
  payback_months: number | null;
}
export function computeRoi(input: RoiInput): RoiResult {
  const weeks = input.weeks_per_year ?? 48;
  const annual_hours_saved = input.avg_weekly_hours_saved * input.user_count * weeks;
  const annual_value = annual_hours_saved * input.hourly_cost;
  const net_annual = annual_value - input.annual_license_cost;
  const monthly_value = annual_value / 12;
  const payback_months = monthly_value > 0 ? round1(input.annual_license_cost / monthly_value) : null;
  return { annual_hours_saved, annual_value, net_annual, payback_months };
}

export type TrafficLight = "green" | "amber" | "red" | "unset";
export function trafficLight(value: number | null, target?: number): TrafficLight {
  if (value === null || target === undefined || target === null || target <= 0) return "unset";
  const ratio = value / target;
  if (ratio >= 1) return "green";
  if (ratio >= 0.8) return "amber";
  return "red";
}
```
> 주의: Phase1이 `round1`/`TrafficLight`를 이미 정의했다면 중복 선언이 되지 않도록 기존 선언을 재사용(중복 시 본 블록의 해당 선언만 제거). `isUserResponse`는 손대지 않는다.

- [ ] **2.4 통과 확인**: `cd frontend && npm test -- survey-metrics` → 신규 산식 + 기존 `isUserResponse` 테스트 전부 green.

- [ ] **2.5 커밋**: `git add -A && git commit -m "feat(survey): pure metrics formulas (NPS, prePostDelta, topBox, weightedMean, ROI, trafficLight) + tests (isUserResponse untouched)"`.

---

### Task 3: KPI 레지스트리 5종 + `buildKpiCards` (Vitest TDD)

**Files**
- Modify: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/survey-metrics.ts`
- Modify: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/__tests__/survey-metrics.test.ts`

**Interfaces**
- Produces(동결 §계약3): `KpiId`, `KpiDefinition`, `KpiContext`, `KpiCardData`, `KPI_REGISTRY`, `buildKpiCards`.
- Consumes: `SurveyResultSummary`, `QuestionAggregate`(+RPC 부가 메타 `analysis_metric`/`target`/`top_box`/`option_midpoints`). KPI⑤는 `license_support`(S4Q2) + 보조로 `s4q3_discontinue_impact`(S4Q3) 결선.

- [ ] **3.1 실패 테스트 작성**: `survey-metrics.test.ts`에 추가.
```typescript
import type { SurveyResultSummary } from "@/types/survey";
import { KPI_REGISTRY, buildKpiCards } from "@/lib/survey-metrics";

function summaryFixture(): SurveyResultSummary {
  return {
    survey_id: "s1",
    total_responses: 30,
    complete_rate: 100,
    avg_duration_sec: 400,
    segments_applied: [],
    questions: [
      // pre_post_overall (S1Q1)
      {
        question_id: "q1", section: "S1", order_index: 0, type: "pre_post_scale",
        title: "생산성", n: 30, masked: false,
        stats: {
          n_pairwise: 30, before_mean: 2.5, after_mean: 4.3, delta_mean: 1.8,
          improvement_pct: 72, before_distribution: [], after_distribution: [],
        },
        // @ts-expect-error runtime KPI meta from RPC
        analysis_metric: "pre_post_overall", target: 1,
      },
      // weekly_hours_saved (S2Q1)
      {
        question_id: "q2", section: "S2", order_index: 1, type: "number",
        title: "절감시간", n: 30, masked: false,
        stats: {
          n: 30, mean: 5, median: 4, sum: 150, min: 0, max: 40,
          mean_trimmed: 4.5, zero_pct: 10, unit: "시간/주",
        },
        // @ts-expect-error runtime KPI meta
        analysis_metric: "weekly_hours_saved", target: null,
      },
      // nps (S4Q1)
      {
        question_id: "q3", section: "S4", order_index: 2, type: "nps",
        title: "추천의향", n: 30, masked: false,
        stats: { n: 30, score: 40, promoters_pct: 60, passives_pct: 20, detractors_pct: 20 },
        // @ts-expect-error runtime KPI meta
        analysis_metric: "nps", target: 30,
      },
    ] as unknown as SurveyResultSummary["questions"],
  };
}

describe("KPI_REGISTRY", () => {
  it("5종 등록", () => {
    expect(Object.keys(KPI_REGISTRY).sort()).toEqual(
      ["license_support", "nps", "pre_post_overall", "value_ratio", "weekly_hours_saved"].sort(),
    );
  });
});

describe("buildKpiCards", () => {
  it("태깅된 KPI는 값 산출, 미태깅은 unset, ROI는 ctx.user_count 미지정 시 문항 n 사용", () => {
    const cards = buildKpiCards(summaryFixture(), {
      hourly_cost: 30000, annual_license_cost: 6_000_000,
    });
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(cards).toHaveLength(5);
    expect(byId.pre_post_overall.value).toBe(1.8);
    expect(byId.pre_post_overall.display).toContain("+1.8");
    expect(byId.pre_post_overall.traffic).toBe("green");
    // user_count 미지정 → S2Q1 n=30 사용: 4.5(trimmed)*30*48 = 6480
    expect(byId.weekly_hours_saved.value).toBe(6480);
    expect(byId.nps.value).toBe(40);
    expect(byId.value_ratio.unset).toBe(true);     // 미태깅
    expect(byId.license_support.unset).toBe(true); // 미태깅
  });
});
```

- [ ] **3.2 실행해 실패 확인**: `cd frontend && npm test -- survey-metrics` → `KPI_REGISTRY`/`buildKpiCards` 미구현 실패.

- [ ] **3.3 최소 구현**: `survey-metrics.ts`에 추가.
```typescript
import type { QuestionAggregate, SurveyResultSummary } from "@/types/survey";

export type KpiId =
  | "pre_post_overall"
  | "weekly_hours_saved"
  | "value_ratio"
  | "nps"
  | "license_support";

export interface KpiContext {
  hourly_cost?: number;
  user_count?: number;
  annual_license_cost?: number;
}
const KPI_DEFAULTS = { hourly_cost: 30000, annual_license_cost: 0, weeks_per_year: 48 };

export interface KpiCardData {
  id: KpiId;
  label: string;
  value: number | null;
  display: string;
  secondary?: string;
  population_label: string;
  traffic: TrafficLight;
  note?: string;
  unset: boolean;
}
export interface KpiDefinition {
  id: KpiId;
  label: string;
  unit: "delta" | "hours" | "percent" | "score" | "ratio";
  population: "all" | "users" | "heavy_users";
  compute: (summary: SurveyResultSummary, ctx: KpiContext) => KpiCardData;
}

// RPC 부가 메타를 읽기 위한 내부 보강 타입(동결 컴포넌트 타입 불변)
type KpiSourceAggregate = QuestionAggregate & {
  analysis_metric?: string | null;
  target?: number | null;
  top_box?: string[];
  option_midpoints?: Record<string, number>;
};

const POP_LABEL: Record<KpiDefinition["population"], string> = {
  all: "전체", users: "사용자", heavy_users: "헤비유저",
};

// analysis_metric 문자열로 문항 찾기(KpiId 외 보조 메트릭 포함)
function findByMetricKey(summary: SurveyResultSummary, key: string): KpiSourceAggregate | undefined {
  return (summary.questions as KpiSourceAggregate[]).find((q) => q.analysis_metric === key);
}
function findByMetric(summary: SurveyResultSummary, id: KpiId): KpiSourceAggregate | undefined {
  return findByMetricKey(summary, id);
}
function unsetCard(def: KpiDefinition): KpiCardData {
  return {
    id: def.id, label: def.label, value: null, display: "미설정",
    population_label: POP_LABEL[def.population], traffic: "unset", unset: true,
  };
}

export const KPI_REGISTRY: Record<KpiId, KpiDefinition> = {
  pre_post_overall: {
    id: "pre_post_overall", label: "도입 전후 개선 Δ", unit: "delta", population: "users",
    compute: (summary, _ctx) => {
      const a = findByMetric(summary, "pre_post_overall");
      if (!a || a.masked || a.type !== "pre_post_scale") return unsetCard(KPI_REGISTRY.pre_post_overall);
      const d = a.stats.delta_mean;
      const imp = a.stats.improvement_pct;
      return {
        id: "pre_post_overall", label: "도입 전후 개선 Δ", value: d,
        display: d === null ? "—" : `${d >= 0 ? "+" : ""}${d}${imp !== null ? ` (${imp}%↑)` : ""}`,
        secondary: `pairwise n=${a.stats.n_pairwise}`,
        population_label: POP_LABEL.users, traffic: trafficLight(d, a.target ?? undefined),
        note: "자기보고 회고형 — 상향편향 가능", unset: false,
      };
    },
  },
  weekly_hours_saved: {
    id: "weekly_hours_saved", label: "가중 연간 절감시간 / ROI", unit: "hours", population: "users",
    compute: (summary, ctx) => {
      const a = findByMetric(summary, "weekly_hours_saved");
      if (!a || a.masked || a.type !== "number") return unsetCard(KPI_REGISTRY.weekly_hours_saved);
      const weekly = a.stats.mean_trimmed ?? a.stats.mean ?? 0;
      // user_count 미지정 시 절감시간 문항 응답 n(=스킵로직상 사용자)을 모수로
      const users = ctx.user_count ?? a.stats.n;
      const roi = computeRoi({
        avg_weekly_hours_saved: weekly, user_count: users,
        hourly_cost: ctx.hourly_cost ?? KPI_DEFAULTS.hourly_cost,
        annual_license_cost: ctx.annual_license_cost ?? KPI_DEFAULTS.annual_license_cost,
        weeks_per_year: KPI_DEFAULTS.weeks_per_year,
      });
      return {
        id: "weekly_hours_saved", label: "가중 연간 절감시간 / ROI", value: roi.annual_hours_saved,
        display: `${roi.annual_hours_saved.toLocaleString("ko-KR")}h/년`,
        secondary: `순효익 ₩${roi.net_annual.toLocaleString("ko-KR")}${roi.payback_months !== null ? ` · 회수 ${roi.payback_months}개월` : ""} · 모수 n=${users}`,
        population_label: POP_LABEL.users, traffic: "unset",
        note: "S2Q2·S1Q1과 합산 금지(교차검증 전용)", unset: false,
      };
    },
  },
  value_ratio: {
    id: "value_ratio", label: "비용 이상 가치 비율", unit: "percent", population: "users",
    compute: (summary, _ctx) => {
      const a = findByMetric(summary, "value_ratio");
      if (!a || a.masked || a.type !== "single_choice") return unsetCard(KPI_REGISTRY.value_ratio);
      const tb = topBoxRatio(a.options.map((o) => ({ value: o.value, n: o.n })), a.top_box ?? []);
      return {
        id: "value_ratio", label: "비용 이상 가치 비율", value: tb.pct,
        display: tb.pct === null ? "—" : `${tb.pct}%`,
        secondary: `유효 n=${tb.n_valid}`,
        population_label: POP_LABEL.users, traffic: trafficLight(tb.pct, a.target ?? undefined),
        note: "'비용 모름' 응답은 별도 검토 필요", unset: false,
      };
    },
  },
  nps: {
    id: "nps", label: "사용자 NPS", unit: "score", population: "users",
    compute: (summary, _ctx) => {
      const a = findByMetric(summary, "nps");
      if (!a || a.masked || a.type !== "nps") return unsetCard(KPI_REGISTRY.nps);
      return {
        id: "nps", label: "사용자 NPS", value: a.stats.score,
        display: a.stats.score === null ? "—" : `${a.stats.score}`,
        secondary: `추천 ${a.stats.promoters_pct}% / 비추천 ${a.stats.detractors_pct}%`,
        population_label: POP_LABEL.users, traffic: trafficLight(a.stats.score, a.target ?? undefined),
        unset: false,
      };
    },
  },
  license_support: {
    id: "license_support", label: "유지 지지도", unit: "percent", population: "users",
    compute: (summary, _ctx) => {
      const a = findByMetric(summary, "license_support");
      if (!a || a.masked || a.type !== "scale") return unsetCard(KPI_REGISTRY.license_support);
      const pct = a.stats.top_box_pct ?? null;
      // KPI⑤ 보조: S4Q3 중단영향('상당+매우'%) 결선
      const impact = findByMetricKey(summary, "s4q3_discontinue_impact");
      let impactStr = "";
      if (impact && !impact.masked && impact.type === "single_choice") {
        const tb = topBoxRatio(impact.options.map((o) => ({ value: o.value, n: o.n })), impact.top_box ?? []);
        if (tb.pct !== null) impactStr = ` · 중단영향(상당+매우) ${tb.pct}%`;
      }
      return {
        id: "license_support", label: "유지 지지도", value: pct,
        display: pct === null ? `평균 ${a.stats.mean}` : `${pct}%`,
        secondary: `top-2-box · 평균 ${a.stats.mean}${impactStr}`,
        population_label: POP_LABEL.users, traffic: trafficLight(pct, a.target ?? undefined),
        note: "관리자·예산권자 별도 표기로 호의편향 점검", unset: false,
      };
    },
  },
};

export function buildKpiCards(summary: SurveyResultSummary, ctx: KpiContext = {}): KpiCardData[] {
  return (Object.keys(KPI_REGISTRY) as KpiId[]).map((id) => KPI_REGISTRY[id].compute(summary, ctx));
}
```

- [ ] **3.4 통과 확인**: `cd frontend && npm test -- survey-metrics` → 전체 통과.

- [ ] **3.5 타입·lint 확인**: `cd frontend && npm run build && npm run lint` → 에러 0.

- [ ] **3.6 커밋**: `git add -A && git commit -m "feat(survey): KPI registry (5종) + buildKpiCards (analysis_metric wiring, S4Q3 secondary, user-n ROI) + tests"`.

---

### Task 4: `survey-csv.ts` 직렬화 (Vitest TDD)

**Files**
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/survey-csv.ts`
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/__tests__/survey-csv.test.ts`

> 두 파일은 Phase3에서 처음 생성한다(Phase1 `vitest.config.ts` coverage.include의 `survey-csv.ts` 참조는 파일 부재 시에도 무해).

**Interfaces**
- Produces: `CSV_BOM`, `escapeCsvField`, `RawExportResponse`, `RawExportInput`, `buildRawCsv`, `buildAggregateCsv`, **`combineCsvSections`**(단일 BOM·다중 섹션 병합 — `scope=all`용).
- Consumes: `SurveyQuestion`, `SurveyResultSummary`, `QuestionAggregate`, `QuestionOption`(`@/types/survey`).

- [ ] **4.1 실패 테스트 작성**: `survey-csv.test.ts`에 작성.
```typescript
import { describe, it, expect } from "vitest";
import {
  CSV_BOM, escapeCsvField, buildRawCsv, buildAggregateCsv, combineCsvSections,
} from "@/lib/survey-csv";
import type { SurveyQuestion, SurveyResultSummary } from "@/types/survey";

const baseQ = (over: Partial<SurveyQuestion>): SurveyQuestion => ({
  id: over.id ?? "q", survey_id: "s", section: over.section ?? "S1", order_index: over.order_index ?? 0,
  type: over.type ?? "single_choice", title: over.title ?? "Q", description: null, required: true,
  config: over.config ?? {}, created_at: "", updated_at: "", ...over,
});

const questions: SurveyQuestion[] = [
  baseQ({ id: "q1", order_index: 0, type: "single_choice", title: "직무",
    config: { options: [{ value: "dev", label: "개발" }, { value: "pm", label: "기획" }] } }),
  baseQ({ id: "q2", order_index: 1, type: "multi_choice", title: "도구",
    config: { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } }),
  baseQ({ id: "q3", order_index: 2, type: "pre_post_scale", title: "생산성", config: { min: 1, max: 5 } }),
];
const rawInput = {
  questions,
  responses: [{
    id: "r1", submitted_at: "2026-06-26T00:00:00Z", is_complete: true,
    respondent_user_id: "u1", respondent_hash: null,
    answers: {
      q1: { value_text: "dev", value_number: null, value_json: null },
      q2: { value_text: null, value_number: null, value_json: ["a"] },
      q3: { value_text: null, value_number: null, value_json: { before: 2, after: 4 } },
    },
  }],
  includeIdentity: false,
};
const aggSummary: SurveyResultSummary = {
  survey_id: "s", total_responses: 10, complete_rate: 100, avg_duration_sec: 300,
  segments_applied: [],
  questions: [{
    question_id: "q3", section: "S1", order_index: 0, type: "scale", title: "지지도", n: 10, masked: false,
    stats: { n: 10, mean: 4.2, median: 4, sd: 0.6, min: 3, max: 5, distribution: [], top_box_pct: 70 },
  }] as unknown as SurveyResultSummary["questions"],
};

describe("escapeCsvField", () => {
  it("쉼표·따옴표·개행 이스케이프", () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"');
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(5)).toBe("5");
  });
});

describe("buildRawCsv", () => {
  it("BOM + CRLF + 식별정보 제외 + 타입별 직렬화", () => {
    const csv = buildRawCsv(rawInput);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).not.toContain("respondent_user_id");
    const header = csv.replace(CSV_BOM, "").split("\r\n")[0];
    expect(header).toContain("직무");
    expect(header).toContain("도구::A");
    expect(header).toContain("도구::B");
    expect(header).toContain("생산성_before");
    expect(header).toContain("생산성_after");
    expect(header).toContain("생산성_delta");
    const row = csv.replace(CSV_BOM, "").split("\r\n")[1];
    expect(row).toContain("개발");   // single → label
    expect(row).toContain("1");      // multi A=1
    expect(row).toContain("0");      // multi B=0
    expect(row).toContain("2");      // before
    expect(row).toContain("4");      // after
  });
  it("includeIdentity=true면 식별 컬럼 포함", () => {
    const csv = buildRawCsv({ ...rawInput, includeIdentity: true });
    expect(csv).toContain("respondent_user_id");
  });
});

describe("buildAggregateCsv", () => {
  it("문항별 요약 1행 + 헤더", () => {
    const csv = buildAggregateCsv(aggSummary);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("지지도");
    expect(csv).toContain("4.2");
    expect(csv).toContain("70");
  });
});

describe("combineCsvSections", () => {
  it("BOM 1회 + 섹션 제목 + 두 블록 포함", () => {
    const raw = buildRawCsv(rawInput);
    const agg = buildAggregateCsv(aggSummary);
    const combined = combineCsvSections([
      { title: "원본 응답", csv: raw },
      { title: "집계 요약", csv: agg },
    ]);
    expect(combined.startsWith(CSV_BOM)).toBe(true);
    expect(combined.split(CSV_BOM).length - 1).toBe(1); // BOM 정확히 1회
    expect(combined).toContain("원본 응답");
    expect(combined).toContain("집계 요약");
    expect(combined).toContain("직무");
    expect(combined).toContain("지지도");
  });
});
```

- [ ] **4.2 실행해 실패 확인**: `cd frontend && npm test -- survey-csv` → 미구현 실패.

- [ ] **4.3 최소 구현**: `survey-csv.ts` 작성.
```typescript
import type { SurveyQuestion, SurveyResultSummary, QuestionAggregate, QuestionOption } from "@/types/survey";

export const CSV_BOM = "\uFEFF";

export function escapeCsvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: (string | number | null)[][]): string {
  return CSV_BOM + rows.map((r) => r.map(escapeCsvField).join(",")).join("\r\n") + "\r\n";
}

export interface RawAnswerCell {
  value_text: string | null;
  value_number: number | null;
  value_json: unknown;
}
export interface RawExportResponse {
  id: string;
  submitted_at: string | null;
  is_complete: boolean;
  respondent_user_id?: string | null;
  respondent_hash?: string | null;
  answers: Record<string, RawAnswerCell>;
}
export interface RawExportInput {
  questions: SurveyQuestion[];
  responses: RawExportResponse[];
  includeIdentity: boolean;
}

interface ColumnSpec {
  header: string;
  get: (cell: RawAnswerCell | undefined) => string | number | null;
}

function readPrePost(c: RawAnswerCell | undefined, key: "before" | "after"): number | null {
  if (!c || c.value_json == null || typeof c.value_json !== "object") return null;
  const v = (c.value_json as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

function columnsForQuestion(q: SurveyQuestion): ColumnSpec[] {
  const opts: QuestionOption[] = q.config.options ?? [];
  switch (q.type) {
    case "single_choice":
      return [{
        header: q.title,
        get: (c) => {
          if (!c || c.value_text === null) return "";
          return opts.find((o) => o.value === c.value_text)?.label ?? c.value_text;
        },
      }];
    case "multi_choice":
      return opts.map((o) => ({
        header: `${q.title}::${o.label}`,
        get: (c) => {
          if (!c || c.value_json == null) return "";
          const arr = Array.isArray(c.value_json) ? (c.value_json as string[]) : [];
          return arr.includes(o.value) ? 1 : 0;
        },
      }));
    case "pre_post_scale":
      return [
        { header: `${q.title}_before`, get: (c) => readPrePost(c, "before") },
        { header: `${q.title}_after`, get: (c) => readPrePost(c, "after") },
        { header: `${q.title}_delta`, get: (c) => {
          const b = readPrePost(c, "before");
          const a = readPrePost(c, "after");
          return b === null || a === null ? "" : a - b;
        } },
      ];
    case "scale":
    case "nps":
    case "number":
      return [{ header: q.title, get: (c) => (c && c.value_number !== null ? c.value_number : "") }];
    default: // text / textarea
      return [{ header: q.title, get: (c) => (c && c.value_text !== null ? c.value_text : "") }];
  }
}

export function buildRawCsv(input: RawExportInput): string {
  const ordered = [...input.questions].sort(
    (a, b) => (a.section ?? "").localeCompare(b.section ?? "") || a.order_index - b.order_index,
  );
  const cols = ordered.flatMap(columnsForQuestion);
  const idCols = input.includeIdentity ? ["respondent_user_id", "respondent_hash"] : [];
  const header = ["response_id", "submitted_at", "is_complete", ...idCols, ...cols.map((c) => c.header)];
  const rows: (string | number | null)[][] = [header];
  for (const r of input.responses) {
    const row: (string | number | null)[] = [
      r.id,
      r.submitted_at ?? "",
      r.is_complete ? "TRUE" : "FALSE",
    ];
    if (input.includeIdentity) {
      row.push(r.respondent_user_id ?? "", r.respondent_hash ?? "");
    }
    for (const oq of ordered) {
      for (const col of columnsForQuestion(oq)) {
        row.push(col.get(r.answers[oq.id]));
      }
    }
    rows.push(row);
  }
  return toCsv(rows);
}

export function buildAggregateCsv(summary: SurveyResultSummary): string {
  const header = ["section", "order", "title", "type", "n", "mean", "median", "sd", "extra"];
  const rows: (string | number | null)[][] = [header];
  for (const q of summary.questions as QuestionAggregate[]) {
    rows.push(aggregateRow(q));
  }
  return toCsv(rows);
}

function aggregateRow(q: QuestionAggregate): (string | number | null)[] {
  const base = [q.section ?? "", q.order_index, q.title, q.type, q.n];
  if (q.masked) return [...base, "", "", "", "표본 부족(n<5)"];
  switch (q.type) {
    case "scale":
      return [...base, q.stats.mean, q.stats.median, q.stats.sd,
        `top-box ${q.stats.top_box_pct ?? "-"}%`];
    case "number":
      return [...base, q.stats.mean, q.stats.median, "",
        `sum ${q.stats.sum} ${q.stats.unit ?? ""} / trimmed ${q.stats.mean_trimmed}`];
    case "nps":
      return [...base, "", "", "",
        `NPS ${q.stats.score} (P${q.stats.promoters_pct}/D${q.stats.detractors_pct})`];
    case "pre_post_scale":
      return [...base, q.stats.after_mean, "", "",
        `Δ ${q.stats.delta_mean} (${q.stats.improvement_pct ?? "-"}%) pairwise ${q.stats.n_pairwise}`];
    case "single_choice":
    case "multi_choice":
      return [...base, "", "", "",
        q.options.map((o) => `${o.label}:${o.n}(${o.pct}%)`).join(" / ")];
    default: // text / textarea
      return [...base, "", "", "", `${q.text_n}건`];
  }
}

// scope=all 등 다중 섹션을 단일 BOM CSV로 병합(BOM 1회, 섹션 제목 행 + 빈 줄 구분)
export function combineCsvSections(sections: { title?: string; csv: string }[]): string {
  const stripBom = (s: string) => (s.startsWith(CSV_BOM) ? s.slice(CSV_BOM.length) : s);
  const blocks = sections
    .map((s) => ({ title: s.title, body: stripBom(s.csv).replace(/[\r\n]+$/, "") }))
    .filter((s) => s.body.trim().length > 0)
    .map((s) => (s.title ? `${escapeCsvField(`# ${s.title}`)}\r\n` : "") + s.body);
  return CSV_BOM + blocks.join("\r\n\r\n") + "\r\n";
}
```

- [ ] **4.4 통과 확인**: `cd frontend && npm test -- survey-csv` → 전체 통과.

- [ ] **4.5 커밋**: `git add -A && git commit -m "feat(survey): CSV serialization (BOM+CRLF, dummy multi, pre_post 3-col, single-BOM section combine) + tests"`.

---

### Task 5: `GET /api/admin/surveys/[id]/analytics`

**Files**
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/[id]/analytics/route.ts:1`

**Interfaces**
- Consumes: `createServerSupabase()`, `get_survey_aggregate` RPC, query `?segments=<URL인코딩 JSON>`(SegmentFilter[]).
- Produces: 200 `SurveyResultSummary`(jsonb passthrough) / 401·403 `{error}` / 400 `{error}`(잘못된 segments JSON).

- [ ] **5.1 라우트 구현**: 파일 작성.
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { SegmentFilter } from "@/types/survey";

/** GET /api/admin/surveys/[id]/analytics — 익명 집계(admin only) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const { data: caller } = await supabase
      .from("user_profiles").select("role").eq("user_id", user.id).single();
    if (caller?.role !== "admin") {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    let segments: SegmentFilter[] = [];
    const raw = request.nextUrl.searchParams.get("segments");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) segments = parsed as SegmentFilter[];
      } catch {
        return NextResponse.json({ error: "segments 파라미터 형식이 올바르지 않습니다." }, { status: 400 });
      }
    }

    const { data, error } = await supabase.rpc("get_survey_aggregate", {
      p_survey_id: id,
      p_segments: segments,
    });
    if (error) {
      const status = error.message === "forbidden" ? 403 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "집계 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **5.2 타입·lint 확인**: `cd frontend && npm run build && npm run lint` → 신규 파일 경고 0.

- [ ] **5.3 커밋**: `git add -A && git commit -m "feat(survey): GET analytics route (get_survey_aggregate, segments param)"`.

---

### Task 6: `GET /api/admin/surveys/[id]/export` (Node 런타임, CSV)

**Files**
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/[id]/export/route.ts:1`

**Interfaces**
- Consumes: `createServerSupabase()`, `buildRawCsv`/`buildAggregateCsv`/`combineCsvSections`(`@/lib/survey-csv`), `get_survey_aggregate` RPC, query `?format=csv|xlsx&scope=raw|aggregate|all&includeIdentity=true`(동결 §5.9).
- Produces: 200 CSV 스트림(`Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename*=UTF-8''<enc>.csv`) / 400(format=xlsx v1 미지원) / 401·403 / 404. **`scope=all`은 `combineCsvSections`로 단일 BOM·2섹션 CSV**(double-BOM/이중헤더 병합 금지).

- [ ] **6.1 라우트 구현**: 파일 작성.
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  buildRawCsv, buildAggregateCsv, combineCsvSections, type RawExportResponse,
} from "@/lib/survey-csv";
import type { SurveyQuestion, SurveyResultSummary } from "@/types/survey";

export const runtime = "nodejs";

/** GET /api/admin/surveys/[id]/export — CSV 내보내기(admin only) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    const { data: caller } = await supabase
      .from("user_profiles").select("role").eq("user_id", user.id).single();
    if (caller?.role !== "admin") {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const format = sp.get("format") ?? "csv";
    const scope = sp.get("scope") ?? "all";
    const includeIdentity = sp.get("includeIdentity") === "true";

    if (format === "xlsx") {
      return NextResponse.json(
        { error: "xlsx는 v1에서 지원하지 않습니다. format=csv를 사용하세요." },
        { status: 400 }
      );
    }

    const { data: survey, error: sErr } = await supabase
      .from("surveys").select("slug, title").eq("id", id).single();
    if (sErr || !survey) {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: questions } = await supabase
      .from("survey_questions").select("*").eq("survey_id", id).order("order_index");
    const qs = (questions ?? []) as SurveyQuestion[];

    let rawCsv: string | null = null;
    let aggCsv: string | null = null;

    if (scope === "raw" || scope === "all") {
      const { data: responses } = await supabase
        .from("survey_responses")
        .select("id, submitted_at, is_complete, respondent_user_id, respondent_hash")
        .eq("survey_id", id).eq("is_complete", true)
        .order("submitted_at", { ascending: true });
      const respRows = responses ?? [];
      const respIds = respRows.map((r) => r.id);
      const answersByResp: Record<string, RawExportResponse["answers"]> = {};
      if (respIds.length > 0) {
        const { data: answers } = await supabase
          .from("survey_answers")
          .select("response_id, question_id, value_text, value_number, value_json")
          .in("response_id", respIds);
        for (const a of answers ?? []) {
          (answersByResp[a.response_id] ??= {})[a.question_id] = {
            value_text: a.value_text, value_number: a.value_number, value_json: a.value_json,
          };
        }
      }
      const exportResponses: RawExportResponse[] = respRows.map((r) => ({
        id: r.id, submitted_at: r.submitted_at, is_complete: r.is_complete,
        respondent_user_id: r.respondent_user_id, respondent_hash: r.respondent_hash,
        answers: answersByResp[r.id] ?? {},
      }));
      rawCsv = buildRawCsv({ questions: qs, responses: exportResponses, includeIdentity });
    }

    if (scope === "aggregate" || scope === "all") {
      const { data: summary, error: aggErr } = await supabase.rpc("get_survey_aggregate", {
        p_survey_id: id, p_segments: [],
      });
      if (aggErr) return NextResponse.json({ error: aggErr.message }, { status: 500 });
      aggCsv = buildAggregateCsv(summary as SurveyResultSummary);
    }

    let body: string;
    if (scope === "all") {
      body = combineCsvSections([
        { title: "원본 응답", csv: rawCsv ?? "" },
        { title: "집계 요약", csv: aggCsv ?? "" },
      ]);
    } else if (scope === "aggregate") {
      body = aggCsv ?? "";
    } else {
      body = rawCsv ?? "";
    }

    const filename = `${survey.slug || "survey"}-${scope}.csv`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "내보내기에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **6.2 타입·lint 확인**: `cd frontend && npm run build && npm run lint` → 통과.

- [ ] **6.3 커밋**: `git add -A && git commit -m "feat(survey): GET export route (CSV raw/aggregate/all single-BOM, Node runtime, xlsx 400)"`.

---

### Task 7: 차트 프리미티브 4종 (0-dependency CSS/SVG)

**Files**
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/charts/HBar.tsx:1`
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/charts/Gauge.tsx:1`
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/charts/Histogram.tsx:1`
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/charts/PrePostBars.tsx:1`

**Interfaces**
- Produces(동결 §계약6): `HBar`(HBarProps), `Gauge`(GaugeProps), `Histogram`(HistogramProps), `PrePostBars`(PrePostBarsProps).

- [ ] **7.1 HBar 구현**: `HBar.tsx` 작성.
```tsx
"use client";

export interface HBarItem {
  label: string;
  value: number;
  pct: number;
}
export interface HBarProps {
  items: HBarItem[];
  showPct?: boolean;
  note?: string;
}

export default function HBar({ items, showPct = true, note }: HBarProps) {
  const max = Math.max(1, ...items.map((i) => i.pct));
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-xs">
          <span className="w-32 shrink-0 truncate text-muted-foreground" title={it.label}>
            {it.label}
          </span>
          <div className="relative h-5 flex-1 rounded bg-muted/50">
            <div
              className="absolute inset-y-0 left-0 rounded bg-primary/80"
              style={{ width: `${(it.pct / max) * 100}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right tabular-nums">
            {it.value}
            {showPct ? ` (${it.pct}%)` : ""}
          </span>
        </div>
      ))}
      {note && <p className="text-[10px] text-muted-foreground/70">{note}</p>}
    </div>
  );
}
```

- [ ] **7.2 Gauge 구현**: `Gauge.tsx` 작성.
```tsx
"use client";

export interface GaugeProps {
  value: number;
  min: number;
  max: number;
  label?: string;
  target?: number;
  variant?: "scale" | "nps";
}

export default function Gauge({ value, min, max, label, target, variant = "scale" }: GaugeProps) {
  const span = max - min || 1;
  const pos = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  const targetPos =
    target !== undefined ? Math.min(100, Math.max(0, ((target - min) / span) * 100)) : null;
  const color = variant === "nps" ? "bg-violet-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
      </div>
      <div className="relative h-2.5 rounded-full bg-muted">
        <div className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${pos}%` }} />
        {targetPos !== null && (
          <div
            className="absolute -top-1 h-4.5 w-0.5 bg-amber-500"
            style={{ left: `${targetPos}%` }}
            title={`목표 ${target}`}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/70">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
```

- [ ] **7.3 Histogram 구현**: `Histogram.tsx` 작성.
```tsx
"use client";

export interface HistogramProps {
  bins: { label: string; n: number }[];
  meanLine?: number;
  unit?: string;
}

export default function Histogram({ bins, meanLine, unit }: HistogramProps) {
  const max = Math.max(1, ...bins.map((b) => b.n));
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-1 h-28">
        {bins.map((b) => (
          <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-muted-foreground">{b.n}</span>
            <div
              className="w-full rounded-t bg-sky-500/70"
              style={{ height: `${(b.n / max) * 100}%`, minHeight: b.n > 0 ? 2 : 0 }}
            />
            <span className="text-[10px] text-muted-foreground/70 text-center">{b.label}</span>
          </div>
        ))}
      </div>
      {meanLine !== undefined && (
        <p className="text-[10px] text-muted-foreground">
          평균 {meanLine}
          {unit ? ` ${unit}` : ""}
        </p>
      )}
    </div>
  );
}
```

- [ ] **7.4 PrePostBars 구현**: `PrePostBars.tsx` 작성.
```tsx
"use client";

export interface PrePostBarsProps {
  beforeMean: number;
  afterMean: number;
  delta: number;
  improvementPct: number | null;
  nPairwise: number;
  scaleMax: number;
}

export default function PrePostBars({
  beforeMean, afterMean, delta, improvementPct, nPairwise, scaleMax,
}: PrePostBarsProps) {
  const bar = (label: string, v: number, color: string) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <div className="relative h-6 flex-1 rounded bg-muted/50">
        <div className={`absolute inset-y-0 left-0 rounded ${color}`} style={{ width: `${(v / scaleMax) * 100}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums font-medium">{v}</span>
    </div>
  );
  return (
    <div className="space-y-2">
      {bar("도입 전", beforeMean, "bg-slate-400")}
      {bar("현재", afterMean, "bg-emerald-500")}
      <div className="flex items-center gap-2 pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            delta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          Δ {delta >= 0 ? "+" : ""}{delta}
          {improvementPct !== null ? ` (${improvementPct}%)` : ""}
        </span>
        <span className="text-[10px] text-muted-foreground/70">pairwise n={nPairwise}</span>
      </div>
    </div>
  );
}
```

- [ ] **7.5 타입·lint 확인**: `cd frontend && npm run build && npm run lint` → 통과.

- [ ] **7.6 커밋**: `git add -A && git commit -m "feat(survey): 0-dependency chart primitives (HBar, Gauge, Histogram, PrePostBars)"`.

---

### Task 8: `QuestionAggregateCard` (타입→시각화 디스패치)

**Files**
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/QuestionAggregateCard.tsx:1`

**Interfaces**
- Consumes: `QuestionAggregate`(`@/types/survey`), charts(Task7).
- Produces(동결 §계약6): `QuestionAggregateCard`(QuestionAggregateCardProps). `populationLabel`은 호출부(Task11)가 섹션 기반으로 주입.

- [ ] **8.1 구현**: 파일 작성.
```tsx
"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import HBar from "./charts/HBar";
import Gauge from "./charts/Gauge";
import Histogram from "./charts/Histogram";
import PrePostBars from "./charts/PrePostBars";
import type { QuestionAggregate } from "@/types/survey";

export interface QuestionAggregateCardProps {
  aggregate: QuestionAggregate;
  populationLabel: string;
}

export default function QuestionAggregateCard({ aggregate, populationLabel }: QuestionAggregateCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-snug">{aggregate.title}</CardTitle>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {populationLabel} · n={aggregate.n}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {aggregate.masked ? (
          <p className="text-xs text-muted-foreground">표본 부족(n<5) — 재식별 방지를 위해 마스킹됨</p>
        ) : (
          <Body aggregate={aggregate} />
        )}
      </CardContent>
    </Card>
  );
}

function Body({ aggregate }: { aggregate: QuestionAggregate }) {
  switch (aggregate.type) {
    case "single_choice":
      return <HBar items={aggregate.options.map((o) => ({ label: o.label, value: o.n, pct: o.pct }))} />;
    case "multi_choice":
      return (
        <HBar
          items={aggregate.options.map((o) => ({ label: o.label, value: o.n, pct: o.pct }))}
          note="복수응답 — 합계 100% 초과 가능"
        />
      );
    case "scale":
      return (
        <div className="space-y-3">
          <Gauge value={aggregate.stats.mean ?? 0} min={aggregate.stats.min ?? 1} max={aggregate.stats.max ?? 5} label="평균" />
          <Histogram bins={aggregate.stats.distribution.map((d) => ({ label: String(d.value), n: d.n }))} />
          <p className="text-[10px] text-muted-foreground">
            중앙값 {aggregate.stats.median ?? "-"} · SD {aggregate.stats.sd ?? "-"}
            {aggregate.stats.top_box_pct != null ? ` · top-box ${aggregate.stats.top_box_pct}%` : ""}
          </p>
        </div>
      );
    case "nps":
      return (
        <div className="space-y-2">
          <Gauge value={aggregate.stats.score ?? 0} min={-100} max={100} label="NPS" variant="nps" />
          <HBar
            showPct={false}
            items={[
              { label: "추천(9-10)", value: aggregate.stats.promoters_pct, pct: aggregate.stats.promoters_pct },
              { label: "중립(7-8)", value: aggregate.stats.passives_pct, pct: aggregate.stats.passives_pct },
              { label: "비추천(0-6)", value: aggregate.stats.detractors_pct, pct: aggregate.stats.detractors_pct },
            ]}
          />
        </div>
      );
    case "number":
      return (
        <Histogram
          bins={[
            { label: "min", n: aggregate.stats.min ?? 0 },
            { label: "mean", n: Math.round(aggregate.stats.mean ?? 0) },
            { label: "max", n: aggregate.stats.max ?? 0 },
          ]}
          meanLine={aggregate.stats.mean ?? undefined}
          unit={aggregate.stats.unit ?? undefined}
        />
      );
    case "pre_post_scale":
      return (
        <PrePostBars
          beforeMean={aggregate.stats.before_mean ?? 0}
          afterMean={aggregate.stats.after_mean ?? 0}
          delta={aggregate.stats.delta_mean ?? 0}
          improvementPct={aggregate.stats.improvement_pct}
          nPairwise={aggregate.stats.n_pairwise}
          scaleMax={5}
        />
      );
    default: // text / textarea
      return <p className="text-xs text-muted-foreground">자유서술 {aggregate.text_n}건 — CSV로 전체 확인</p>;
  }
}
```

- [ ] **8.2 타입·lint 확인**: `cd frontend && npm run build && npm run lint` → 통과(판별 유니온 분기 완전성).

- [ ] **8.3 커밋**: `git add -A && git commit -m "feat(survey): QuestionAggregateCard type→viz dispatcher with masking"`.

---

### Task 9: `KpiCard` + `SummaryView` (경영 요약 + ROI 박스 + 신호등)

**Files**
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/KpiCard.tsx:1`
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/SummaryView.tsx:1`

**Interfaces**
- Consumes: `KpiCardData`, `buildKpiCards`, `KpiContext`(`@/lib/survey-metrics`), `SurveyResultSummary`.
- Produces(동결 §계약6): `KpiCard`(KpiCardProps) + `SummaryView`(SummaryViewProps).

- [ ] **9.1 KpiCard 구현**: 파일 작성.
```tsx
"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { KpiCardData } from "@/lib/survey-metrics";

export interface KpiCardProps {
  card: KpiCardData;
}

const TRAFFIC: Record<KpiCardData["traffic"], string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  unset: "bg-slate-300",
};

export default function KpiCard({ card }: KpiCardProps) {
  return (
    <Card className={card.unset ? "opacity-60" : ""}>
      <CardContent className="py-4 space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
          <span className={`h-2.5 w-2.5 rounded-full ${TRAFFIC[card.traffic]}`} title={card.traffic} />
        </div>
        <p className="text-2xl font-bold tabular-nums">{card.display}</p>
        {card.secondary && <p className="text-[11px] text-muted-foreground">{card.secondary}</p>}
        <div className="flex items-center justify-between pt-1">
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
            모수: {card.population_label}
          </span>
        </div>
        {card.note && <p className="text-[10px] text-muted-foreground/70">⚠ {card.note}</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **9.2 SummaryView 구현**: 파일 작성.
```tsx
"use client";

import KpiCard from "./KpiCard";
import { buildKpiCards, type KpiContext } from "@/lib/survey-metrics";
import type { SurveyResultSummary } from "@/types/survey";

export interface SummaryViewProps {
  summary: SurveyResultSummary;
  context?: KpiContext;
}

export default function SummaryView({ summary, context }: SummaryViewProps) {
  const cards = buildKpiCards(summary, context ?? {});
  const roiCard = cards.find((c) => c.id === "weekly_hours_saved");
  return (
    <div className="space-y-6 print:space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <KpiCard key={c.id} card={c} />
        ))}
      </div>

      {roiCard && !roiCard.unset && (
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="text-sm font-semibold mb-1">ROI 요약</p>
          <p className="text-lg font-bold">{roiCard.display}</p>
          {roiCard.secondary && <p className="text-xs text-muted-foreground">{roiCard.secondary}</p>}
          <p className="mt-2 text-[10px] text-muted-foreground/70">
            절감시간 × 사용인원(절감시간 응답 n) × 인건비(app_settings) − 라이센스 비용(app_settings).
            자기보고 기반 추정치이며 S1Q1·S2Q2와 합산 금지.
          </p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/70">
        총 응답 {summary.total_responses}건 · 완료율 {summary.complete_rate}% · 모든 지표는 익명 집계(n<5 마스킹).
        사용자 모수 카드의 n은 스킵 로직상 사용자 응답자 수.
      </p>
    </div>
  );
}
```

- [ ] **9.3 타입·lint 확인**: `cd frontend && npm run build && npm run lint` → 통과.

- [ ] **9.4 커밋**: `git add -A && git commit -m "feat(survey): KpiCard + SummaryView (KPI grid, ROI box, traffic lights, print-friendly)"`.

---

### Task 10: `SegmentFilterBar` (세그먼트 멀티셀렉트)

**Files**
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/SegmentFilterBar.tsx:1`

**Interfaces**
- Consumes: `SurveyQuestion`(config.segment=true), `SegmentFilter`(`@/types/survey`), shadcn Popover·Checkbox·Button·Badge.
- Produces(동결 §계약6): `SegmentFilterBar`(SegmentFilterBarProps). single·multi 세그먼트 모두 노출(RPC가 타입별 매칭 — Task1).

- [ ] **10.1 구현**: 파일 작성.
```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter, X } from "lucide-react";
import type { SurveyQuestion, SegmentFilter } from "@/types/survey";

export interface SegmentFilterBarProps {
  segmentQuestions: SurveyQuestion[];
  value: SegmentFilter[];
  onChange: (filters: SegmentFilter[]) => void;
}

export default function SegmentFilterBar({ segmentQuestions, value, onChange }: SegmentFilterBarProps) {
  if (segmentQuestions.length === 0) return null;

  const valuesFor = (qid: string) => value.find((f) => f.question_id === qid)?.values ?? [];

  const toggle = (qid: string, optValue: string) => {
    const current = valuesFor(qid);
    const next = current.includes(optValue)
      ? current.filter((v) => v !== optValue)
      : [...current, optValue];
    const others = value.filter((f) => f.question_id !== qid);
    onChange(next.length > 0 ? [...others, { question_id: qid, values: next }] : others);
  };

  const activeCount = value.reduce((s, f) => s + f.values.length, 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Filter className="h-3.5 w-3.5" /> 세그먼트
      </span>
      {segmentQuestions.map((q) => {
        const selected = valuesFor(q.id);
        return (
          <Popover key={q.id}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                {q.title}
                {selected.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {selected.length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              <div className="space-y-1.5">
                {(q.config.options ?? []).map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted cursor-pointer">
                    <Checkbox
                      checked={selected.includes(opt.value)}
                      onCheckedChange={() => toggle(q.id, opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => onChange([])}>
          <X className="h-3 w-3 mr-1" /> 초기화
        </Button>
      )}
    </div>
  );
}
```

- [ ] **10.2 타입·lint 확인**: `cd frontend && npm run build && npm run lint` → 통과.

- [ ] **10.3 커밋**: `git add -A && git commit -m "feat(survey): SegmentFilterBar (per-question multiselect, AND/OR semantics)"`.

---

### Task 11: 대시보드 페이지 (집계 + 경영요약 탭 + ROI 컨텍스트)

**Files**
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/admin/surveys/[id]/analytics/page.tsx:1`

**Interfaces**
- Consumes: `GET /api/admin/surveys/[id]`(Phase2, SurveyWithQuestions), `GET /api/admin/surveys/[id]/analytics`, `GET /api/admin/surveys/[id]/export`, components(Task8·9·10), `@/lib/supabase` `createClient()`(app_settings 비용 조회), shadcn Tabs·Button·Card.
- Produces: admin 분석 페이지(어드민 크롬/게이트는 `admin/layout.tsx` 상속). populationLabel은 섹션 기반(S0→전체, 그 외→사용자). ROI 컨텍스트는 app_settings(`survey_hourly_cost`·`survey_annual_license_cost`)에서 조회(실패 시 기본값 폴백), `user_count`는 미주입(절감시간 문항 n 사용).

- [ ] **11.1 구현**: 파일 작성.
```tsx
"use client";

import { useState, useEffect, useCallback, use, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, Download, BarChart3, Briefcase } from "lucide-react";
import SegmentFilterBar from "@/components/admin/surveys/SegmentFilterBar";
import QuestionAggregateCard from "@/components/admin/surveys/QuestionAggregateCard";
import SummaryView from "@/components/admin/surveys/SummaryView";
import { createClient } from "@/lib/supabase";
import type { KpiContext } from "@/lib/survey-metrics";
import type { SurveyWithQuestions, SurveyResultSummary, SegmentFilter, QuestionAggregate } from "@/types/survey";

// 섹션 기반 모수 라벨: S0(공통/전수) → 전체, 그 외(S1~S4 사용자 문항) → 사용자
function populationLabelFor(section: string | null): string {
  return section && section.toUpperCase().startsWith("S0") ? "전체" : "사용자";
}

export default function SurveyAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [survey, setSurvey] = useState<SurveyWithQuestions | null>(null);
  const [summary, setSummary] = useState<SurveyResultSummary | null>(null);
  const [segments, setSegments] = useState<SegmentFilter[]>([]);
  const [costCtx, setCostCtx] = useState<KpiContext>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/surveys/${id}`)
      .then((r) => r.json())
      .then((d) => setSurvey(d))
      .catch(() => {});
  }, [id]);

  // ROI 비용 컨텍스트(app_settings) — 실패 시 기본값 폴백(graceful)
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["survey_hourly_cost", "survey_annual_license_cost"])
      .then(({ data }) => {
        const map = Object.fromEntries(
          (data ?? []).map((r: { key: string; value: unknown }) => [r.key, Number(r.value)])
        );
        setCostCtx({
          hourly_cost: Number.isFinite(map.survey_hourly_cost) ? map.survey_hourly_cost : undefined,
          annual_license_cost: Number.isFinite(map.survey_annual_license_cost)
            ? map.survey_annual_license_cost
            : undefined,
        });
      });
  }, []);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = segments.length > 0 ? `?segments=${encodeURIComponent(JSON.stringify(segments))}` : "";
      const res = await fetch(`/api/admin/surveys/${id}/analytics${qs}`);
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "집계 조회 실패");
      }
      setSummary(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, [id, segments]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const segmentQuestions = useMemo(
    () => (survey?.questions ?? []).filter((q) => q.config.segment === true),
    [survey]
  );

  const sections = useMemo(() => {
    const map = new Map<string, QuestionAggregate[]>();
    for (const q of summary?.questions ?? []) {
      const key = q.section ?? "기타";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(q);
    }
    return [...map.entries()];
  }, [summary]);

  const exportHref = (scope: string) => `/api/admin/surveys/${id}/export?format=csv&scope=${scope}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{survey?.title ?? "설문 분석"}</h2>
          {summary && (
            <p className="text-xs text-muted-foreground">
              응답 {summary.total_responses}건 · 완료율 {summary.complete_rate}% ·
              평균 {summary.avg_duration_sec ? Math.round(summary.avg_duration_sec / 60) : "-"}분
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={exportHref("raw")} download>
              <Download className="h-3.5 w-3.5 mr-1" /> 원본 CSV
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={exportHref("all")} download>
              <Download className="h-3.5 w-3.5 mr-1" /> 전체 CSV
            </a>
          </Button>
        </div>
      </div>

      <SegmentFilterBar segmentQuestions={segmentQuestions} value={segments} onChange={setSegments} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2 text-sm">집계 중...</span>
        </div>
      ) : summary ? (
        <Tabs defaultValue="dashboard">
          <TabsList>
            <TabsTrigger value="dashboard">
              <BarChart3 className="h-3.5 w-3.5 mr-1" /> 집계 대시보드
            </TabsTrigger>
            <TabsTrigger value="summary">
              <Briefcase className="h-3.5 w-3.5 mr-1" /> 경영 요약
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6 pt-4">
            {sections.map(([section, items]) => (
              <div key={section} className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">{section}</h3>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {items.map((agg) => (
                    <QuestionAggregateCard
                      key={agg.question_id}
                      aggregate={agg}
                      populationLabel={populationLabelFor(agg.section)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="summary" className="pt-4">
            <SummaryView summary={summary} context={costCtx} />
          </TabsContent>
        </Tabs>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">집계 데이터가 없습니다.</CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **11.2 타입·lint 확인**: `cd frontend && npm run build && npm run lint` → 통과.

- [ ] **11.3 수동 스모크(선택, 개발 서버)**: `./frontend/scripts/restart-frontend.sh 3003` 후 admin 로그인 → `/admin/surveys/<seed-id>/analytics` 접속 → 섹션별 카드(S0=전체/그 외=사용자 라벨)/탭/세그먼트/CSV 버튼 렌더 확인. 확인 후 변경 없음.

- [ ] **11.4 커밋**: `git add -A && git commit -m "feat(survey): analytics dashboard (sections, tabs, segment filter, section-based population label, app_settings ROI ctx, CSV export)"`.

---

### Task 12: Playwright E2E — 대시보드·세그먼트·CSV 다운로드

**Files**
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/e2e/helpers/seed.ts:1`
- Create: `/Users/seunguk.kang/Repos/inje-playground/frontend/e2e/survey-analytics.spec.ts:1`

**Interfaces**
- Consumes: `@supabase/supabase-js`(service role, `SUPABASE_SERVICE_ROLE_KEY` env), `e2e/helpers/auth.ts`의 `loginAsAdmin`(Phase2 Task10 — 앱은 Google OAuth 전용이라 자격증명 폼이 없음 → 헬퍼가 프로그램적 Supabase 세션 주입/`storageState` 처리), Playwright `test`/`expect`(Phase1 설정).
- Produces: 분석 플로우 E2E(시드 ≥5응답 → 대시보드 렌더 → 세그먼트 필터 → CSV 다운로드).

- [ ] **12.1 시드 헬퍼 작성**: `e2e/helpers/seed.ts` 작성.
```typescript
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface SeededSurvey {
  surveyId: string;
  slug: string;
  roleQuestionId: string;
}

/** 서비스 롤로 직접 시드: 설문 1 + 문항 2(단일선택 segment, pre_post) + 완료응답 6건 */
export async function seedAnalyticsSurvey(): Promise<SeededSurvey> {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const slug = `e2e-analytics-${Date.now()}`;

  const { data: survey, error: sErr } = await admin
    .from("surveys")
    .insert({ slug, title: "E2E 분석 설문", status: "open", access_mode: "authenticated", is_anonymous: true })
    .select("id").single();
  if (sErr) throw sErr;

  const { data: q1 } = await admin
    .from("survey_questions")
    .insert({
      survey_id: survey.id, section: "S0", order_index: 0, type: "single_choice", title: "직무",
      required: true,
      config: { segment: true, ordinal: false, options: [{ value: "dev", label: "개발" }, { value: "pm", label: "기획" }] },
    })
    .select("id").single();

  const { data: q2 } = await admin
    .from("survey_questions")
    .insert({
      survey_id: survey.id, section: "S1", order_index: 1, type: "pre_post_scale", title: "생산성",
      required: true, config: { min: 1, max: 5, analysis_metric: "pre_post_overall", target: 1 },
    })
    .select("id").single();

  for (let i = 0; i < 6; i++) {
    const { data: resp } = await admin
      .from("survey_responses")
      .insert({ survey_id: survey.id, is_complete: true, submitted_at: new Date().toISOString(), meta: { duration_sec: 300 } })
      .select("id").single();
    await admin.from("survey_answers").insert([
      { response_id: resp.id, question_id: q1!.id, value_text: i < 4 ? "dev" : "pm" },
      { response_id: resp.id, question_id: q2!.id, value_json: { before: 2, after: 4 } },
    ]);
  }

  return { surveyId: survey.id, slug, roleQuestionId: q1!.id };
}

export async function cleanupSurvey(surveyId: string): Promise<void> {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  await admin.from("surveys").delete().eq("id", surveyId);
}
```

- [ ] **12.2 E2E 스펙 작성**: `e2e/survey-analytics.spec.ts` 작성. `loginAsAdmin`은 Phase2 `e2e/helpers/auth.ts`에서 **import해 재사용**(로컬 재정의 금지 — 앱은 OAuth 전용이라 UI 자격증명 입력 불가, 헬퍼가 세션을 직접 주입).
```typescript
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import { seedAnalyticsSurvey, cleanupSurvey, type SeededSurvey } from "./helpers/seed";

let seeded: SeededSurvey;

test.beforeAll(async () => {
  seeded = await seedAnalyticsSurvey();
});
test.afterAll(async () => {
  if (seeded) await cleanupSurvey(seeded.surveyId);
});

test("대시보드: 집계 카드·세그먼트·CSV 다운로드", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`/admin/surveys/${seeded.surveyId}/analytics`);

  // 집계 카드 렌더 (직무 단일선택 + 생산성 pre_post)
  await expect(page.getByText("직무")).toBeVisible();
  await expect(page.getByText("생산성")).toBeVisible();
  await expect(page.getByText(/도입 전/)).toBeVisible();
  await expect(page.getByText(/Δ \+2/)).toBeVisible(); // delta_mean=2

  // 경영 요약 탭 — pre_post_overall KPI green
  await page.getByRole("tab", { name: /경영 요약/ }).click();
  await expect(page.getByText("도입 전후 개선 Δ")).toBeVisible();
  await expect(page.getByText(/\+2/)).toBeVisible();

  // 세그먼트 필터: 직무=개발 (dev 4건)
  await page.getByRole("tab", { name: /집계 대시보드/ }).click();
  await page.getByRole("button", { name: /직무/ }).click();
  await page.getByText("개발", { exact: true }).click();
  await page.keyboard.press("Escape");
  // dev 세그먼트 적용 시 직무 카드 n=4
  await expect(page.getByText(/n=4/).first()).toBeVisible();

  // CSV 다운로드
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /전체 CSV/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});
```

- [ ] **12.3 실행해 통과 확인**: 개발 서버 가동 후 `cd frontend && npm run test:e2e -- survey-analytics`. (env: `SUPABASE_SERVICE_ROLE_KEY`, 그리고 Phase2 `loginAsAdmin`이 요구하는 admin 세션 env — `playwright.config.ts` `webServer`가 dev 서버 기동.) 기대: 1 spec passed. 로그인은 Phase2 헬퍼에 위임하므로 본 스펙은 셀렉터 불확실성을 갖지 않는다(헬퍼가 OAuth-전용 앱의 세션 주입을 담당).

- [ ] **12.4 커밋**: `git add -A && git commit -m "test(survey): E2E analytics (seed, shared loginAsAdmin, dashboard render, segment filter, CSV download)"`.

---

### Phase 3 완료 게이트

- [ ] **G.1 전체 단위테스트**: `cd frontend && npm test` → survey-metrics·survey-csv 전부 green(`isUserResponse`는 Phase1 value-key 테스트만 존재, Phase3 중복 없음).
- [ ] **G.2 타입·품질**: `cd frontend && npm run build && npm run lint` → 에러 0.
- [ ] **G.3 보안 어드바이저 재확인**: `mcp__supabase__get_advisors`(type: `security`) → `get_survey_aggregate` 관련 신규 경고 0.
- [ ] **G.4 E2E**: `cd frontend && npm run test:e2e` → analytics spec green.
- [ ] **G.5 불변식 점검(수동 grep)**:
  - `cd frontend && grep -rn "respondent_user_id\|respondent_hash" src/components/admin/surveys src/lib/survey-metrics.ts src/lib/survey-csv.ts` → `survey-csv.ts`의 `includeIdentity` 분기 외 0 매치(분석 출력 익명성). `includeIdentity`는 `survey-csv.ts`/`export/route.ts`에만 존재.
  - `cd frontend && grep -rn "function isUserResponse\|isUserResponse =" src/lib/survey-metrics.ts` → 정의 **정확히 1개**(Phase1, value-key 기준) 확인.
  - `cd frontend && grep -rn "사용한 적 없음\|거의 사용 안 함" src/lib/survey-metrics.ts` → 0 매치(라벨 기반 재정의 부재).