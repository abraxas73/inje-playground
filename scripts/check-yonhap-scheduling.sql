-- Transaction-only scheduler verification. No mail is queued or sent; all changes roll back.
-- 2026-09-16: Microsoft 메일 연결 조건이 없어져 이메일 인증된 user/admin 한 명만 있으면 된다.
begin;
do $$
declare caller uuid; result public.yonhap_notice_subscriptions; before_due timestamptz; claimed integer;
begin
  select u.id into caller from auth.users u join public.user_profiles p on p.user_id=u.id and p.role in ('user','admin')
    where u.email is not null and u.email_confirmed_at is not null limit 1;
  if caller is null then raise exception 'A verified user is needed'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', caller, 'role', 'authenticated')::text, true);
  if exists (select 1 from pg_proc where proname = 'yonhap_notice_mail_connection') then raise exception 'Microsoft mail connection RPC still present'; end if;
  result := public.set_yonhap_notice_subscription(true, '07:10');
  if result.next_send_at <= now() then raise exception 'Must schedule next occurrence'; end if;
  if (result.next_send_at at time zone 'Asia/Seoul')::time <> '07:10'::time then raise exception 'Incorrect timezone'; end if;
  before_due := result.next_send_at;
  result := public.set_yonhap_notice_subscription(true, '07:10');
  if result.next_send_at <> before_due then raise exception 'Unchanged settings moved the schedule'; end if;
  update public.yonhap_notice_subscriptions set next_send_at=now()-interval '1 minute' where user_id=caller;
  delete from public.yonhap_notice_email_deliveries where user_id=caller and send_date=(now() at time zone 'Asia/Seoul')::date;
  select count(*) into claimed from public.claim_yonhap_notice_emails(50) where recipient_id=caller;
  if claimed <> 1 then raise exception 'Expected one claimed delivery, got %',claimed; end if;
  update public.yonhap_notice_subscriptions set next_send_at=now()-interval '1 minute' where user_id=caller;
  select count(*) into claimed from public.claim_yonhap_notice_emails(50) where recipient_id=caller;
  if claimed <> 0 then raise exception 'Duplicate daily delivery'; end if;
  result := public.set_yonhap_notice_subscription(false, '07:10');
  if result.enabled or result.next_send_at is not null then raise exception 'Opt out failed'; end if;
  delete from public.yonhap_notice_manual_deliveries where user_id=caller;
  select count(*) into claimed from public.claim_yonhap_notice_send_now()
    where period_to-period_from=interval '24 hours';
  if claimed <> 1 then raise exception 'Manual send must claim 24 hours even when unsubscribed'; end if;
  select count(*) into claimed from public.claim_yonhap_notice_send_now();
  if claimed <> 0 then raise exception 'Manual cooldown failed'; end if;
  select * into result from public.yonhap_notice_subscriptions where user_id=caller;
  if result.enabled or result.next_send_at is not null then raise exception 'Manual send changed subscription'; end if;
  -- The email cron must target the Edge Function with the sync secret, not the retired Vercel route.
  if (select prosrc from pg_proc where proname = 'invoke_yonhap_notice_email') !~ '/functions/v1/yonhap-notices' then raise exception 'Email cron still targets Vercel'; end if;
  if not exists (select 1 from cron.job where jobname = 'yonhap-notice-email-every-minute' and active) then raise exception 'Email cron missing'; end if;
  raise notice 'yonhap scheduling checks passed';
end;
$$;
rollback;
