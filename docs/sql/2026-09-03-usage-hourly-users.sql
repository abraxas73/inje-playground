-- 개인용 시간대 패턴 RPC에 사용자 수 추가 — 어드민 claude_code_hourly와 같은 컬럼 구성
-- 실행: Supabase SQL Editor(또는 Management API). 재실행 안전.
-- 반환 컬럼이 바뀌므로 create or replace로는 안 되고 drop 후 재생성한다.

drop function if exists public.claude_code_hourly_emails(date, date, text[]);

create function public.claude_code_hourly_emails(p_from date, p_to date, p_emails text[])
returns table (dow int, hour int, requests bigint, cost_usd numeric, users bigint)
language sql
security definer
set search_path = public
as $$
  select
    extract(isodow from (ts at time zone 'Asia/Seoul'))::int as dow,
    extract(hour   from (ts at time zone 'Asia/Seoul'))::int as hour,
    count(*)::bigint as requests,
    coalesce(sum(cost_usd), 0)::numeric as cost_usd,
    count(distinct lower(user_email))::bigint as users
  from claude_code_requests
  where ts >= (p_from::text || ' 00:00:00+09')::timestamptz
    and ts <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
    and lower(user_email) = any (p_emails)
  group by 1, 2
$$;
revoke execute on function public.claude_code_hourly_emails(date, date, text[]) from public, anon, authenticated;
grant execute on function public.claude_code_hourly_emails(date, date, text[]) to service_role;
