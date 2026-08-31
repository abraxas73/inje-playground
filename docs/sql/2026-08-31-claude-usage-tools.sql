-- Claude Code 도구 사용 일별 집계 + 도구/시간대 조회 RPC
-- 실행: Supabase SQL Editor. 재실행 안전.
-- tool_result(호출·실패·소요)와 tool_decision(승인/거절)을 (일, 조직, 사용자, 도구) 단위로 가산 저장한다.

create table if not exists public.claude_code_tool_daily (
  day             date not null,
  org_id          text not null references public.claude_orgs(id),
  user_email      text not null,
  tool_name       text not null,
  calls           numeric not null default 0,   -- tool_result 수
  errors          numeric not null default 0,   -- tool_result success=false
  duration_ms_sum numeric not null default 0,
  accepts         numeric not null default 0,   -- tool_decision accept
  rejects         numeric not null default 0,   -- tool_decision reject
  primary key (day, org_id, user_email, tool_name)
);
create index if not exists claude_code_tool_daily_tool_idx on public.claude_code_tool_daily (tool_name, day);

do $$
begin
  execute 'alter table public.claude_code_tool_daily enable row level security';
  execute 'drop policy if exists claude_code_tool_daily_admin_read on public.claude_code_tool_daily';
  execute 'create policy claude_code_tool_daily_admin_read on public.claude_code_tool_daily for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))';
end $$;

-- 수집: 델타 가산 upsert (OTLP 로그 수신 시 storeLogs가 호출)
create or replace function public.claude_code_tool_ingest(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into claude_orgs (id, name)
  select distinct x->>'org_id', left(x->>'org_id', 8)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  where coalesce(x->>'org_id', '') <> ''
  on conflict (id) do nothing;

  insert into claude_code_tool_daily (day, org_id, user_email, tool_name, calls, errors, duration_ms_sum, accepts, rejects)
  select (x->>'day')::date, x->>'org_id', x->>'user_email', coalesce(nullif(x->>'tool_name', ''), 'unknown'),
         coalesce((x->>'calls')::numeric, 0), coalesce((x->>'errors')::numeric, 0), coalesce((x->>'duration_ms_sum')::numeric, 0),
         coalesce((x->>'accepts')::numeric, 0), coalesce((x->>'rejects')::numeric, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  on conflict (day, org_id, user_email, tool_name) do update set
    calls = claude_code_tool_daily.calls + excluded.calls,
    errors = claude_code_tool_daily.errors + excluded.errors,
    duration_ms_sum = claude_code_tool_daily.duration_ms_sum + excluded.duration_ms_sum,
    accepts = claude_code_tool_daily.accepts + excluded.accepts,
    rejects = claude_code_tool_daily.rejects + excluded.rejects;
end;
$$;
revoke execute on function public.claude_code_tool_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.claude_code_tool_ingest(jsonb) to service_role;

-- 조회: 기간·조직별 도구 합계
create or replace function public.claude_code_tool_summary(p_from date, p_to date, p_org text default null)
returns table (tool_name text, calls numeric, errors numeric, duration_ms_sum numeric, accepts numeric, rejects numeric, users bigint)
language sql
security definer
set search_path = public
as $$
  select t.tool_name, sum(t.calls), sum(t.errors), sum(t.duration_ms_sum), sum(t.accepts), sum(t.rejects), count(distinct t.user_email)
  from claude_code_tool_daily t
  where t.day between p_from and p_to
    and (p_org is null or t.org_id = p_org)
  group by t.tool_name
  order by sum(t.calls) desc;
$$;
revoke execute on function public.claude_code_tool_summary(date, date, text) from public, anon, authenticated;
grant execute on function public.claude_code_tool_summary(date, date, text) to service_role;

-- 조회: 기간·조직별 요일×시각(KST) 요청 히트맵 (claude_code_requests 기준)
create or replace function public.claude_code_hourly(p_from date, p_to date, p_org text default null)
returns table (dow int, hour int, requests bigint, cost_usd numeric, users bigint)
language sql
security definer
set search_path = public
as $$
  select extract(dow  from r.ts at time zone 'Asia/Seoul')::int,
         extract(hour from r.ts at time zone 'Asia/Seoul')::int,
         count(*), coalesce(sum(r.cost_usd), 0), count(distinct r.user_email)
  from claude_code_requests r
  where r.ts >= (p_from::timestamp at time zone 'Asia/Seoul')
    and r.ts <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    and (p_org is null or r.org_id = p_org)
  group by 1, 2;
$$;
revoke execute on function public.claude_code_hourly(date, date, text) from public, anon, authenticated;
grant execute on function public.claude_code_hourly(date, date, text) to service_role;
