begin;
-- Separate from scheduled deliveries: manual receipt never consumes the daily slot or watermark.
create table if not exists public.yonhap_notice_manual_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_from timestamptz not null,
  period_to timestamptz not null default now(),
  status text not null default 'processing' check (status in ('processing','sent','failed')),
  finished_at timestamptz,
  item_count integer not null default 0,
  provider_id text,
  error_message text
);
create index if not exists yonhap_manual_delivery_user_idx on public.yonhap_notice_manual_deliveries (user_id, period_to desc);
alter table public.yonhap_notice_manual_deliveries enable row level security;
revoke all on public.yonhap_notice_manual_deliveries from anon, authenticated;
grant all on public.yonhap_notice_manual_deliveries to service_role;

create or replace function public.claim_yonhap_notice_send_now()
returns table (delivery_id uuid, period_from timestamptz, period_to timestamptz)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); claimed public.yonhap_notice_manual_deliveries;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id=caller and role in ('user','admin')) then
    raise exception 'User permission required' using errcode='42501';
  end if;
  if not exists (select 1 from auth.users where id=caller and email_confirmed_at is not null) or
     not exists (select 1 from public.yonhap_notice_mail_connection() where ready) then
    raise exception 'Microsoft mail connection required' using errcode='55000';
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
commit;
