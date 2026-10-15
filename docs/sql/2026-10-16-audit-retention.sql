-- 감사 로그 100일 보존 (2026-10-16 사용자 결정)
--
-- action_history·login_history(뷰 audit_log의 원본)에서 100일 지난 행을 매일 지운다.
-- 예외: 사람별·플랫폼(macOS/Windows)별 마지막 데스크톱 앱 로그인 한 건은 남긴다.
--   웹 홈의 데스크톱 앱 설치 안내 카드(lib/desktop/presence.ts)가 이 기록으로 설치 여부를 판단하는데,
--   앱은 로그인할 때만 기록을 남기므로 다 지우면 오래 쓰던 사람에게 설치 안내가 다시 뜬다.
-- 큰 삭제가 잠금을 오래 잡지 않게 action_history는 5000행씩 나눠 지운다.

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
                  substring(lower(coalesce(user_agent, '')) from '^innogridapp/\S+ \((macos|windows)\)') as platform
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

-- 매일 04:10 KST(19:10 UTC). 같은 이름이 있으면 지우고 다시 등록한다.
select cron.unschedule(jobid) from cron.job where jobname = 'audit-log-retention-100d';
select cron.schedule('audit-log-retention-100d', '10 19 * * *', $job$select public.purge_audit_logs(100)$job$);
