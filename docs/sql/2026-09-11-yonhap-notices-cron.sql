-- Run after deploying yonhap-notices and setting the two Vault secrets.
-- yonhap_project_url = https://<project-ref>.supabase.co
-- yonhap_sync_secret = Edge Function secret YONHAP_SYNC_SECRET (same value)
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_yonhap_notices_sync()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  sync_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'yonhap_project_url';
  select decrypted_secret into sync_secret from vault.decrypted_secrets where name = 'yonhap_sync_secret';
  if project_url is null or sync_secret is null or length(sync_secret) < 32 then
    raise exception 'Yonhap sync Vault secrets are missing';
  end if;
  select net.http_post(
    url := project_url || '/functions/v1/yonhap-notices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || sync_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function public.invoke_yonhap_notices_sync() from public, anon, authenticated, service_role;

do $$
begin
  if coalesce(current_setting('cron.timezone', true), 'GMT') not in ('UTC', 'GMT', 'Etc/UTC') then
    raise exception 'Expected UTC cron.timezone for 07:00 Asia/Seoul schedule';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'yonhap_project_url') or
     not exists (select 1 from vault.decrypted_secrets where name = 'yonhap_sync_secret' and length(decrypted_secret) >= 32) then
    raise exception 'Set Yonhap Vault secrets before enabling cron';
  end if;
end;
$$;

-- UTC 22:00 = following day 07:00 in Asia/Seoul, including weekends.
-- A stable job name makes re-running this script update the existing schedule.
select cron.schedule('yonhap-notices-daily-0700-kst', '0 22 * * *', 'select public.invoke_yonhap_notices_sync();');
commit;
