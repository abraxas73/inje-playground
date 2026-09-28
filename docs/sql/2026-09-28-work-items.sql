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

-- 시간대 k-익명성: 기간·종류·대상 안에서 실제 활동한 사람 수(구성원 수가 아니라 기여자 수). 3명 미만이면 라우트가 숨긴다
drop function if exists public.work_items_contributors(date, date, text[], text[]);
create function public.work_items_contributors(p_from date, p_to date, p_emails text[], p_kinds text[])
returns bigint
language sql security definer set search_path = public as $$
  select count(distinct lower(user_email))::bigint
  from (
    select kind, user_email, case when kind = 'commit' then created_at else done_at end as ts
    from work_items
  ) x
  where ts is not null
    and ts >= (p_from::text || ' 00:00:00+09')::timestamptz
    and ts <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
    and kind = any (p_kinds)
    and (p_emails is null or lower(user_email) = any (p_emails))
$$;
revoke execute on function public.work_items_contributors(date, date, text[], text[]) from public, anon, authenticated;
grant  execute on function public.work_items_contributors(date, date, text[], text[]) to service_role;
