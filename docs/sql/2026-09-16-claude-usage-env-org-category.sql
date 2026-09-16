-- Claude 사용량: 조직 분류(category)와 실행 환경(os/arch/version/terminal) 수집 (2026-09-16). 재적용 안전.
-- 배경: OTel 수집기는 처음 보는 organization.id를 UUID 앞 8자 이름으로 자동 등록한다(개인 Claude 계정). 계정 속성이 없는
--       텔레메트리(user.id만)는 org 'unknown'·user 'id:…'로 들어온다(컨테이너·웹 세션 추정). 화면에서 구분하려면 조직 분류와
--       실행 환경(리소스 속성 os.type·host.arch·service.version, 포인트 속성 terminal.type)이 필요하다.
begin;

-- 1) 조직 분류: team(우리 Team 조직, CSV 업로드로 생성) | personal(OTel 자동 등록 = 기본) | system(unknown, test-org)
alter table public.claude_orgs add column if not exists category text not null default 'personal';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claude_orgs_category_check') then
    alter table public.claude_orgs add constraint claude_orgs_category_check check (category in ('team', 'personal', 'system'));
  end if;
end $$;
update public.claude_orgs set category = 'team' where name like 'Innogrid%' and category <> 'team';
update public.claude_orgs set category = 'system' where id in ('unknown', 'test-org') and category <> 'system';

-- 2) 실행 환경 일 집계: 같은 (일, 조직, 사용자, 환경 4속성)에 데이터 포인트 수를 더한다. 빈 속성은 ''.
create table if not exists public.claude_code_env_daily (
  day           date not null,
  org_id        text not null references public.claude_orgs(id),
  user_email    text not null,
  os_type       text not null default '',   -- darwin | linux | win32 …
  host_arch     text not null default '',   -- arm64 | x64 …
  app_version   text not null default '',   -- Claude Code 버전(service.version 또는 app.version)
  terminal_type text not null default '',   -- iTerm.app | vscode | tmux … (컨테이너·웹 세션은 보통 빈 값)
  points        numeric not null default 0,
  primary key (day, org_id, user_email, os_type, host_arch, app_version, terminal_type)
);
create index if not exists claude_code_env_daily_user_idx on public.claude_code_env_daily (user_email, day);
alter table public.claude_code_env_daily enable row level security;
revoke all on public.claude_code_env_daily from anon, authenticated;
grant all on public.claude_code_env_daily to service_role;

create or replace function public.claude_code_env_ingest(p_rows jsonb)
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

  insert into claude_code_env_daily (day, org_id, user_email, os_type, host_arch, app_version, terminal_type, points)
  select (x->>'day')::date, x->>'org_id', x->>'user_email',
         left(coalesce(x->>'os_type', ''), 40), left(coalesce(x->>'host_arch', ''), 40),
         left(coalesce(x->>'app_version', ''), 40), left(coalesce(x->>'terminal_type', ''), 60),
         coalesce((x->>'points')::numeric, 0)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
  where coalesce(x->>'day', '') <> '' and coalesce(x->>'org_id', '') <> '' and coalesce(x->>'user_email', '') <> ''
  on conflict (day, org_id, user_email, os_type, host_arch, app_version, terminal_type) do update set
    points = claude_code_env_daily.points + excluded.points;
end;
$$;
revoke execute on function public.claude_code_env_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.claude_code_env_ingest(jsonb) to service_role;

-- 3) 조회 RPC의 조직 필터: p_org = 'personal' 이면 개인 조직 전체
create or replace function public.claude_code_tool_summary(p_from date, p_to date, p_org text default null)
returns table (tool_name text, calls numeric, errors numeric, duration_ms_sum numeric, accepts numeric, rejects numeric, users bigint)
language sql
security definer
set search_path = public
as $$
  select t.tool_name, sum(t.calls), sum(t.errors), sum(t.duration_ms_sum), sum(t.accepts), sum(t.rejects), count(distinct t.user_email)
  from claude_code_tool_daily t
  where t.day between p_from and p_to
    and (p_org is null or t.org_id = p_org
         or (p_org = 'personal' and t.org_id in (select o.id from claude_orgs o where o.category = 'personal')))
  group by t.tool_name
  order by sum(t.calls) desc;
$$;

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
    and (p_org is null or r.org_id = p_org
         or (p_org = 'personal' and r.org_id in (select o.id from claude_orgs o where o.category = 'personal')))
  group by 1, 2;
$$;

commit;
