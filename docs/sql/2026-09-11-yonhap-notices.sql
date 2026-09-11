-- 연합뉴스 인사·부고: 공식 사람들 RSS의 제목·제공 요약·송고 시각·원문 URL만 누적.
begin;

create table if not exists public.yonhap_notices (
  source_id text primary key check (source_id ~ '^AKR[0-9]+$'),
  category text not null check (category in ('personnel', 'obituary')),
  title text not null,
  summary text not null default '',
  source_url text not null check (source_url = 'https://www.yna.co.kr/view/' || source_id),
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  fetched_at timestamptz not null default now()
);

create index if not exists yonhap_notices_published_idx on public.yonhap_notices (published_at desc, source_id desc);
create index if not exists yonhap_notices_category_published_idx on public.yonhap_notices (category, published_at desc, source_id desc);
create index if not exists yonhap_notices_created_idx on public.yonhap_notices (created_at);

create table if not exists public.yonhap_notice_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  trigger_source text not null default 'cron' check (trigger_source in ('cron', 'manual')),
  item_count integer not null default 0 check (item_count >= 0),
  error_message text
);

create index if not exists yonhap_notice_sync_runs_started_idx on public.yonhap_notice_sync_runs (started_at desc);
create index if not exists yonhap_notice_sync_runs_success_idx on public.yonhap_notice_sync_runs (finished_at desc) where status = 'success';

alter table public.yonhap_notices enable row level security;
alter table public.yonhap_notice_sync_runs enable row level security;

-- Guest/anonymous users cannot read. Writes belong exclusively to the collector.
revoke all on public.yonhap_notices, public.yonhap_notice_sync_runs from anon, authenticated;
grant select on public.yonhap_notices to authenticated;
grant select (id, started_at, finished_at, status, item_count) on public.yonhap_notice_sync_runs to authenticated;
grant all on public.yonhap_notices, public.yonhap_notice_sync_runs to service_role;
grant usage, select on sequence public.yonhap_notice_sync_runs_id_seq to service_role;

drop policy if exists yonhap_notices_read on public.yonhap_notices;
create policy yonhap_notices_read on public.yonhap_notices for select to authenticated
using ((select exists (select 1 from public.user_profiles where user_id = (select auth.uid()) and role in ('user', 'admin'))));

drop policy if exists yonhap_notice_sync_runs_read on public.yonhap_notice_sync_runs;
create policy yonhap_notice_sync_runs_read on public.yonhap_notice_sync_runs for select to authenticated
using ((select exists (select 1 from public.user_profiles where user_id = (select auth.uid()) and role in ('user', 'admin'))));

-- A global, atomic one-minute cooldown for manual requests, across all Edge workers.
create table if not exists public.yonhap_notice_manual_sync_gate (
  singleton boolean primary key default true check (singleton),
  requested_at timestamptz not null
);
alter table public.yonhap_notice_manual_sync_gate enable row level security;
revoke all on public.yonhap_notice_manual_sync_gate from anon, authenticated;
grant all on public.yonhap_notice_manual_sync_gate to service_role;

create or replace function public.claim_yonhap_notice_manual_sync()
returns boolean language sql set search_path = '' as $$
  with claimed as (
    insert into public.yonhap_notice_manual_sync_gate (singleton, requested_at)
    values (true, clock_timestamp())
    on conflict (singleton) do update set requested_at = excluded.requested_at
      where public.yonhap_notice_manual_sync_gate.requested_at < clock_timestamp() - interval '1 minute'
    returning singleton
  ) select exists (select 1 from claimed);
$$;
revoke all on function public.claim_yonhap_notice_manual_sync() from public, anon, authenticated;
grant execute on function public.claim_yonhap_notice_manual_sync() to service_role;

commit;
