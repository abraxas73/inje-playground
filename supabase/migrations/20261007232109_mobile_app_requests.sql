-- Platform-specific tester requests. All access goes through authenticated server APIs.
create table public.mobile_app_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  store_email text not null check (length(store_email) between 3 and 254),
  status text not null default 'pending' check (status in ('pending', 'processing', 'approved', 'rejected')),
  admin_note text not null default '' check (length(admin_note) <= 2000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique(user_id, platform)
);
create index mobile_app_requests_status_submitted_idx on public.mobile_app_requests(status, submitted_at desc);
alter table public.mobile_app_requests enable row level security;
revoke all on public.mobile_app_requests from public, anon, authenticated;
grant select, insert, update, delete on public.mobile_app_requests to service_role;
