-- 인사·부고 소식 메일(예약·지금 수신·미리보기)을 Microsoft Graph 발송에서 Edge Function `yonhap-notices`의 SMTP 릴레이로 이관.
-- 배포 순서: Edge Function 배포(action 분기 포함) → 이 SQL → Vercel. 재적용 안전.
-- Vault: yonhap_project_url, yonhap_sync_secret(수집 cron과 동일). 예전 yonhap_app_url·yonhap_cron_secret은 더 쓰지 않는다.
begin;

-- 1) 구독 저장: Microsoft 메일 연결 조건 제거. 이메일 인증만 필요.
create or replace function public.set_yonhap_notice_subscription(p_enabled boolean, p_send_time text)
returns public.yonhap_notice_subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  due timestamptz;
  saved public.yonhap_notice_subscriptions;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role in ('user', 'admin')) then
    raise exception 'User permission required' using errcode = '42501';
  end if;
  if p_enabled is null or p_send_time is null or p_send_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Invalid subscription settings' using errcode = '22023';
  end if;
  if p_enabled and not exists (select 1 from auth.users where id = caller and email is not null and email_confirmed_at is not null) then
    raise exception 'Verified email required' using errcode = '22023';
  end if;
  due := ((now() at time zone 'Asia/Seoul')::date + p_send_time::time) at time zone 'Asia/Seoul';
  if due <= now() then due := due + interval '1 day'; end if;
  insert into public.yonhap_notice_subscriptions (user_id, enabled, send_time, next_send_at)
    values (caller, p_enabled, p_send_time::time, case when p_enabled then due end)
  on conflict (user_id) do update set
    enabled = excluded.enabled, send_time = excluded.send_time,
    next_send_at = case
      when not excluded.enabled then null
      when public.yonhap_notice_subscriptions.enabled and public.yonhap_notice_subscriptions.send_time = excluded.send_time
        then public.yonhap_notice_subscriptions.next_send_at
      else excluded.next_send_at end,
    updated_at = now()
  returning * into saved;
  return saved;
end;
$$;
revoke all on function public.set_yonhap_notice_subscription(boolean, text) from public, anon;
grant execute on function public.set_yonhap_notice_subscription(boolean, text) to authenticated;

-- 2) 지금 수신 claim: 이메일 인증만 확인. 1분 쿨다운·최근 24시간 범위·예약 슬롯 무관은 그대로.
create or replace function public.claim_yonhap_notice_send_now()
returns table (delivery_id uuid, period_from timestamptz, period_to timestamptz)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); claimed public.yonhap_notice_manual_deliveries;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id=caller and role in ('user','admin')) then
    raise exception 'User permission required' using errcode='42501';
  end if;
  if not exists (select 1 from auth.users where id=caller and email is not null and email_confirmed_at is not null) then
    raise exception 'Verified email required' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('yonhap-send-now:' || caller::text,0));
  if exists (select 1 from public.yonhap_notice_manual_deliveries m where m.user_id=caller and m.period_to > now()-interval '1 minute') then
    return;
  end if;
  insert into public.yonhap_notice_manual_deliveries(user_id,period_from,period_to)
    values(caller,now()-interval '24 hours',now()) returning * into claimed;
  return query select claimed.id, claimed.period_from, claimed.period_to;
end;
$$;
revoke all on function public.claim_yonhap_notice_send_now() from public, anon;
grant execute on function public.claim_yonhap_notice_send_now() to authenticated;

-- 3) Microsoft 메일 연결 상태 RPC는 더 쓰지 않는다.
drop function if exists public.yonhap_notice_mail_connection();

-- 4) 매분 cron: Vercel 라우트 대신 Edge Function {"action":"send-digests"} 호출(수집 cron과 같은 Vault 비밀값).
create or replace function public.invoke_yonhap_notice_email()
returns bigint language plpgsql security definer set search_path = '' as $$
declare project_url text; sync_secret text; request_id bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'yonhap_project_url';
  select decrypted_secret into sync_secret from vault.decrypted_secrets where name = 'yonhap_sync_secret';
  if project_url is null or project_url !~ '^https://' or sync_secret is null or length(sync_secret) < 32 then
    raise exception 'Yonhap sync Vault secrets are missing';
  end if;
  select net.http_post(
    url := project_url || '/functions/v1/yonhap-notices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || sync_secret),
    body := '{"action":"send-digests"}'::jsonb, timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function public.invoke_yonhap_notice_email() from public, anon, authenticated, service_role;
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'yonhap_project_url') or
     not exists (select 1 from vault.decrypted_secrets where name = 'yonhap_sync_secret' and length(decrypted_secret) >= 32) then
    raise exception 'Set Yonhap Vault secrets before enabling cron';
  end if;
end;
$$;
select cron.schedule('yonhap-notice-email-every-minute', '* * * * *', 'select public.invoke_yonhap_notice_email();');

commit;
