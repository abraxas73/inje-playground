-- Mail delivery is driven by Supabase pg_cron every minute. The claim RPC
-- selects each user's configured KST time, so this also supports arbitrary minutes.
-- Vault secrets: yonhap_app_url (deployed HTTPS app URL), yonhap_cron_secret (same as Vercel YONHAP_EMAIL_CRON_SECRET).
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create or replace function public.invoke_yonhap_notice_email()
returns bigint language plpgsql security definer set search_path = '' as $$
declare app_url text; cron_secret text; request_id bigint;
begin
  select decrypted_secret into app_url from vault.decrypted_secrets where name = 'yonhap_app_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'yonhap_cron_secret';
  if app_url is null or app_url !~ '^https://' or cron_secret is null or length(cron_secret) < 32 then
    raise exception 'Yonhap email Vault secrets are missing';
  end if;
  select net.http_post(
    url := app_url || '/api/cron/yonhap-notice-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cron_secret),
    body := '{}'::jsonb, timeout_milliseconds := 180000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function public.invoke_yonhap_notice_email() from public, anon, authenticated, service_role;
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'yonhap_app_url') or
     not exists (select 1 from vault.decrypted_secrets where name = 'yonhap_cron_secret' and length(decrypted_secret) >= 32) then
    raise exception 'Set Yonhap email Vault secrets before enabling cron';
  end if;
end;
$$;
select cron.unschedule(jobid) from cron.job where jobname = 'yonhap-notice-email-every-5-minutes';
select cron.schedule('yonhap-notice-email-every-minute', '* * * * *', 'select public.invoke_yonhap_notice_email();');
commit;
