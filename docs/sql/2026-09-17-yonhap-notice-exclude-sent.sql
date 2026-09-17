-- 인사·부고 소식 메일 "이전 발송 내역 제외" 옵션 (2026-09-17). 재적용 안전.
-- 배경: 예약 수신은 이미 마지막 예약 발송 이후 수집분만 보내지만, '지금 수신'은 항상 최근 24시간을 보내
--       예약분과 겹쳤다. 옵션을 켜면 두 경로 모두 "이미 보낸 것(예약+즉시) 이후"만 보낸다.
-- 적용 순서: 이 SQL → Edge Function 배포 → Vercel. (구 Edge Function은 기본값으로 계속 동작)
begin;

alter table public.yonhap_notice_subscriptions add column if not exists exclude_sent boolean not null default true;

-- 즉시 발송 기록에 '보낼 것이 없어 건너뜀' 상태 추가
alter table public.yonhap_notice_manual_deliveries drop constraint if exists yonhap_notice_manual_deliveries_status_check;
alter table public.yonhap_notice_manual_deliveries
  add constraint yonhap_notice_manual_deliveries_status_check check (status in ('processing', 'sent', 'failed', 'skipped'));

-- 예약·즉시를 통틀어 마지막으로 발송에 성공한 구간의 끝
create or replace function public.yonhap_notice_last_sent_all(p_user uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select max(t) from (
    select max(period_to) as t from public.yonhap_notice_email_deliveries where user_id = p_user and status = 'sent'
    union all
    select max(period_to) from public.yonhap_notice_manual_deliveries where user_id = p_user and status = 'sent'
  ) s;
$$;

-- 옵션 저장. p_exclude_sent가 null이면 기존 값을 유지(신규 행은 컬럼 기본값 true).
drop function if exists public.set_yonhap_notice_subscription(boolean, text);
create or replace function public.set_yonhap_notice_subscription(p_enabled boolean, p_send_time text, p_exclude_sent boolean default null)
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
  insert into public.yonhap_notice_subscriptions (user_id, enabled, send_time, next_send_at, exclude_sent)
    values (caller, p_enabled, p_send_time::time, case when p_enabled then due end, coalesce(p_exclude_sent, true))
  on conflict (user_id) do update set
    enabled = excluded.enabled, send_time = excluded.send_time,
    exclude_sent = coalesce(p_exclude_sent, public.yonhap_notice_subscriptions.exclude_sent),
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
revoke all on function public.set_yonhap_notice_subscription(boolean, text, boolean) from public, anon;
grant execute on function public.set_yonhap_notice_subscription(boolean, text, boolean) to authenticated;

-- 즉시 수신 claim. p_exclude_sent가 null이면 저장된 설정을 따른다. 적용된 값을 excluded로 돌려준다.
drop function if exists public.claim_yonhap_notice_send_now();
create or replace function public.claim_yonhap_notice_send_now(p_exclude_sent boolean default null)
returns table (delivery_id uuid, period_from timestamptz, period_to timestamptz, excluded boolean)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); claimed public.yonhap_notice_manual_deliveries; v_exclude boolean; v_from timestamptz;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id=caller and role in ('user','admin')) then
    raise exception 'User permission required' using errcode='42501';
  end if;
  if not exists (select 1 from auth.users where id=caller and email is not null and email_confirmed_at is not null) then
    raise exception 'Verified email required' using errcode='22023';
  end if;
  v_exclude := coalesce(p_exclude_sent, (select s.exclude_sent from public.yonhap_notice_subscriptions s where s.user_id = caller), true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('yonhap-send-now:' || caller::text,0));
  if exists (select 1 from public.yonhap_notice_manual_deliveries m where m.user_id=caller and m.period_to > now()-interval '1 minute') then
    return;
  end if;
  v_from := case when v_exclude then coalesce(public.yonhap_notice_last_sent_all(caller), now()-interval '24 hours')
                 else now()-interval '24 hours' end;
  insert into public.yonhap_notice_manual_deliveries(user_id,period_from,period_to)
    values(caller, v_from, now()) returning * into claimed;
  return query select claimed.id, claimed.period_from, claimed.period_to, v_exclude;
end;
$$;
revoke all on function public.claim_yonhap_notice_send_now(boolean) from public, anon;
grant execute on function public.claim_yonhap_notice_send_now(boolean) to authenticated;

-- 미리보기용 창(발송·기록 없음) — 즉시 수신과 같은 구간을 계산한다.
create or replace function public.yonhap_notice_digest_window(p_user uuid, p_exclude_sent boolean default null)
returns table (period_from timestamptz, period_to timestamptz)
language sql stable security definer set search_path = '' as $$
  select case when coalesce(p_exclude_sent, (select s.exclude_sent from public.yonhap_notice_subscriptions s where s.user_id = p_user), true)
              then coalesce(public.yonhap_notice_last_sent_all(p_user), now()-interval '24 hours')
              else now()-interval '24 hours' end,
         now();
$$;
revoke execute on function public.yonhap_notice_digest_window(uuid, boolean) from public, anon, authenticated;
grant execute on function public.yonhap_notice_digest_window(uuid, boolean) to service_role;

-- 예약 발송 claim: 옵션이 켜져 있으면 즉시 발송분까지 제외한다.
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
    if due.exclude_sent then
      period_start := coalesce(public.yonhap_notice_last_sent_all(due.user_id), now() - interval '1 day');
    else
      select coalesce(max(e.period_to), now() - interval '1 day') into period_start
        from public.yonhap_notice_email_deliveries e where e.user_id = due.user_id and e.status = 'sent';
    end if;
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
