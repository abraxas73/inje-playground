-- 개인용 사용량/성과 스코프 v2 — 조직장 체크박스 + 이메일 범위 시간대 RPC
-- 실행: Supabase SQL Editor. 재실행 안전.

-- 조직장 여부(어드민 조직/팀 탭 체크박스로 관리)
-- null = 직책(duty)으로 자동 판정(팀장·센터장·실장·소장·본부장·부문장 등), true = 조직장(자기 말단 조직 전체 조회), false = 본인만
alter table public.company_directory add column if not exists is_leader boolean;

-- 개인 화면용 시간대 패턴(허용 이메일 범위) — 요일×시각(KST) 요청 수·비용
create or replace function public.claude_code_hourly_emails(p_from date, p_to date, p_emails text[])
returns table (dow int, hour int, requests bigint, cost_usd numeric)
language sql
security definer
set search_path = public
as $$
  select
    extract(isodow from (ts at time zone 'Asia/Seoul'))::int as dow,
    extract(hour   from (ts at time zone 'Asia/Seoul'))::int as hour,
    count(*)::bigint as requests,
    coalesce(sum(cost_usd), 0)::numeric as cost_usd
  from claude_code_requests
  where ts >= (p_from::text || ' 00:00:00+09')::timestamptz
    and ts <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
    and lower(user_email) = any (p_emails)
  group by 1, 2
$$;
revoke execute on function public.claude_code_hourly_emails(date, date, text[]) from public, anon, authenticated;
