-- 계정 미식별(SDK) 세션 처리 (2026-09-16). 재적용 안전.
-- 정의: OTel 텔레메트리에 user.email·user.account_uuid·organization.id가 없고 user.id만 있는 실행.
--   저장 키는 org 'unknown' + user 'id:<user.id 해시>'. 2026-09-16 조사 결과 이 트래픽은 query_source가 100% 'sdk'
--   (Claude Agent SDK·headless `claude -p`·CI)이고, 같은 sdk라도 계정 인증으로 실행하면 속성이 붙는다(Team 조직 sdk 191k건).
--   환경은 대부분 linux/amd64 + non-interactive(컨테이너), 일부 macOS. active_user_seconds는 0이지만 사람이 친 프롬프트가 남는다.
-- 처리: (1) user.id → 이메일 매핑으로 사람에게 귀속, (2) 조직 필터 'team'으로 개인·미식별을 뺀 합계 제공.
begin;

create table if not exists public.claude_code_identity_map (
  user_id    text primary key,                       -- OTel user.id 원본 해시('id:' 접두어 없이)
  email      text not null,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.claude_code_identity_map enable row level security;
revoke all on public.claude_code_identity_map from anon, authenticated;
grant all on public.claude_code_identity_map to service_role;

-- 조직 필터 'team' — 개인 계정·시스템(unknown·test-org)을 뺀 우리 Team 조직 전체
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
         or (p_org in ('personal', 'team') and t.org_id in (select o.id from claude_orgs o where o.category = p_org)))
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
         or (p_org in ('personal', 'team') and r.org_id in (select o.id from claude_orgs o where o.category = p_org)))
  group by 1, 2;
$$;

-- 계정 미식별 식별자 후보: 기간 내 사용량 + 마지막 실행 환경. 매핑 화면이 쓴다.
create or replace function public.claude_code_accountless_candidates(p_from date, p_to date)
returns table (user_id text, days bigint, prompts numeric, sessions numeric, cost_usd numeric,
               first_day date, last_day date, os_type text, host_arch text, app_version text, terminal_type text)
language sql
security definer
set search_path = public
as $$
  with usage as (
    select substring(d.user_email from 4) as user_id, count(distinct d.day)::bigint as days,
           sum(d.prompts) as prompts, sum(d.sessions) as sessions, sum(d.cost_usd) as cost_usd,
           min(d.day) as first_day, max(d.day) as last_day
    from claude_code_daily d
    where d.day between p_from and p_to and d.user_email like 'id:%'
    group by 1
  ), env as (
    select distinct on (substring(e.user_email from 4))
           substring(e.user_email from 4) as user_id, e.os_type, e.host_arch, e.app_version, e.terminal_type
    from claude_code_env_daily e
    where e.day between p_from and p_to and e.user_email like 'id:%'
    order by substring(e.user_email from 4), e.points desc, e.day desc
  )
  select u.user_id, u.days, u.prompts, u.sessions, u.cost_usd, u.first_day, u.last_day,
         coalesce(env.os_type, ''), coalesce(env.host_arch, ''), coalesce(env.app_version, ''), coalesce(env.terminal_type, '')
  from usage u left join env on env.user_id = u.user_id
  order by u.cost_usd desc, u.days desc;
$$;
revoke execute on function public.claude_code_accountless_candidates(date, date) from public, anon, authenticated;
grant execute on function public.claude_code_accountless_candidates(date, date) to service_role;

commit;
