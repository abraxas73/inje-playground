begin;

create table if not exists public.yonhap_notice_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  send_time time not null default '07:10',
  next_send_at timestamptz,
  updated_at timestamptz not null default now(),
  check (extract(second from send_time) = 0)
);
create index if not exists yonhap_notice_subscriptions_due_idx
  on public.yonhap_notice_subscriptions (next_send_at) where enabled;
alter table public.yonhap_notice_subscriptions enable row level security;
revoke all on public.yonhap_notice_subscriptions from anon, authenticated;
grant select on public.yonhap_notice_subscriptions to authenticated;
grant all on public.yonhap_notice_subscriptions to service_role;
drop policy if exists yonhap_notice_subscription_own on public.yonhap_notice_subscriptions;
create policy yonhap_notice_subscription_own on public.yonhap_notice_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create table if not exists public.yonhap_notice_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  send_date date not null,
  scheduled_for timestamptz not null,
  period_from timestamptz not null,
  period_to timestamptz not null,
  status text not null default 'processing' check (status in ('processing', 'sent', 'failed', 'cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  item_count integer not null default 0,
  provider_id text,
  error_message text,
  unique (user_id, send_date)
);
create index if not exists yonhap_notice_email_deliveries_user_idx on public.yonhap_notice_email_deliveries (user_id, started_at desc);
alter table public.yonhap_notice_email_deliveries enable row level security;
revoke all on public.yonhap_notice_email_deliveries from anon, authenticated;
grant select (id, user_id, scheduled_for, status, started_at, finished_at, item_count) on public.yonhap_notice_email_deliveries to authenticated;
grant all on public.yonhap_notice_email_deliveries to service_role;
drop policy if exists yonhap_notice_email_delivery_own on public.yonhap_notice_email_deliveries;
create policy yonhap_notice_email_delivery_own on public.yonhap_notice_email_deliveries for select to authenticated
using (user_id = (select auth.uid()));

-- The caller cannot select another recipient or manipulate the scheduler timestamp.
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
  if p_enabled and not exists (
    select 1 from public.ms_connections m join auth.users u on u.id = m.user_id
    where m.user_id = caller and lower(trim(m.account_upn)) = lower(trim(u.email))
      and lower(m.scopes) ~ '(^|[ /])mail.send($| )' and m.last_error is null
  ) then
    raise exception 'Connect matching Microsoft mailbox with Mail.Send permission' using errcode = '55000';
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

create or replace function public.yonhap_notice_mail_connection()
returns table (ready boolean, account_email text)
language sql security definer set search_path = '' as $$
  select coalesce(lower(trim(m.account_upn)) = lower(trim(u.email))
    and lower(m.scopes) ~ '(^|[ /])mail.send($| )' and m.last_error is null, false), m.account_upn
  from auth.users u left join public.ms_connections m on m.user_id = u.id
  where u.id = auth.uid();
$$;
revoke all on function public.yonhap_notice_mail_connection() from public, anon;
grant execute on function public.yonhap_notice_mail_connection() to authenticated;

-- Claim due subscriptions atomically. SKIP LOCKED + one delivery per user/KST day
-- prevents overlapping cron workers from sending the same digest twice.
create or replace function public.claim_yonhap_notice_emails(p_limit integer default 20)
returns table (delivery_id uuid, recipient_id uuid, recipient_email text, period_from timestamptz, period_to timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  due record;
  delivery public.yonhap_notice_email_deliveries;
  period_start timestamptz;
begin
  update public.yonhap_notice_email_deliveries set status = 'failed', finished_at = now(), error_message = '발송 작업이 중단되었습니다.'
    where status = 'processing' and started_at < now() - interval '10 minutes';
  for due in
    select s.*, u.email from public.yonhap_notice_subscriptions s
    join auth.users u on u.id = s.user_id and u.email_confirmed_at is not null
    join public.user_profiles p on p.user_id = s.user_id and p.role in ('user', 'admin')
    where s.enabled and s.next_send_at <= now()
    order by s.next_send_at for update of s skip locked limit least(greatest(p_limit, 1), 50)
  loop
    update public.yonhap_notice_subscriptions set next_send_at =
      (((now() at time zone 'Asia/Seoul')::date + 1) + due.send_time) at time zone 'Asia/Seoul'
      where user_id = due.user_id;
    select coalesce(max(e.period_to), now() - interval '1 day') into period_start
      from public.yonhap_notice_email_deliveries e where e.user_id = due.user_id and e.status = 'sent';
    insert into public.yonhap_notice_email_deliveries (user_id, send_date, scheduled_for, period_from, period_to)
      values (due.user_id, (now() at time zone 'Asia/Seoul')::date, due.next_send_at, period_start, now())
      on conflict (user_id, send_date) do nothing returning * into delivery;
    if found then
      delivery_id := delivery.id; recipient_id := due.user_id; recipient_email := due.email;
      period_from := delivery.period_from; period_to := delivery.period_to;
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.claim_yonhap_notice_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_yonhap_notice_emails(integer) to service_role;

commit;
