-- 감사 로그 100일 보존 — 보존 예외에 Linux 앱 로그인 추가 (2026-10-30)
--
-- 2026-10-20 파일의 함수를 대체한다. 적용은 Supabase SQL 편집기에서 실행.
-- 사람별·플랫폼별 마지막 앱 로그인 한 건을 남기는 대상에 linux를 더했다. 그 밖의 동작은 이전과 같다.

create or replace function public.purge_audit_logs(p_days int default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - make_interval(days => greatest(p_days, 1));
  a_deleted bigint := 0;
  l_deleted bigint := 0;
  n bigint;
begin
  loop
    delete from public.action_history
     where id in (select id from public.action_history where created_at < cutoff limit 5000);
    get diagnostics n = row_count;
    a_deleted := a_deleted + n;
    exit when n = 0;
  end loop;

  delete from public.login_history l
   where l.logged_in_at < cutoff
     and l.id not in (
       select distinct on (x.user_id, x.platform) x.id
         from (
           select id, user_id, logged_in_at,
                  substring(lower(coalesce(user_agent, '')) from '^innogridapp/\S+ \((ios|android|macos|windows|linux)\)') as platform
             from public.login_history
         ) x
        where x.platform is not null
        order by x.user_id, x.platform, x.logged_in_at desc
     );
  get diagnostics l_deleted = row_count;

  return jsonb_build_object('cutoff', cutoff, 'action_history', a_deleted, 'login_history', l_deleted);
end;
$$;

revoke all on function public.purge_audit_logs(int) from public, anon, authenticated;
grant execute on function public.purge_audit_logs(int) to service_role;
-- 크론 'audit-log-retention-100d'는 같은 함수를 부르므로 재등록하지 않는다.
