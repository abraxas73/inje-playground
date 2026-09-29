-- 2026-09-29 Claude 시트 할당·해제 — 요청·실행 이력과 실행기 하트비트
-- 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md §4. 멱등(재실행 가능).

create table if not exists public.claude_seat_actions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             text not null references public.claude_orgs(id),
  email              text not null,                                   -- 소문자
  action             text not null check (action in ('unassign', 'assign')),
  target_tier        text check (target_tier in ('Standard', 'Premium')), -- assign만
  status             text not null default 'requested' check (status in ('requested', 'running', 'done', 'failed', 'cancelled')),
  requested_by       uuid not null,
  requested_by_email text not null,
  requested_at       timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  before_tier        text,
  after_tier         text,
  error              text,
  executor           text
);
create index if not exists claude_seat_actions_email_idx on public.claude_seat_actions (email, requested_at desc);
create index if not exists claude_seat_actions_open_idx on public.claude_seat_actions (status) where status in ('requested', 'running');
-- 같은 조직·이메일에 대기·실행 중 요청은 하나만
create unique index if not exists claude_seat_actions_open_uniq on public.claude_seat_actions (org_id, email) where status in ('requested', 'running');

create table if not exists public.claude_seat_executor (
  id           text primary key,             -- 항상 'default'
  last_seen_at timestamptz not null,
  logged_in    boolean not null default false,
  note         text,
  host         text,
  version      text
);

-- 가장 오래된 requested 1건을 running으로 바꿔 돌려준다(동시 실행기 대비 skip locked)
create or replace function public.claude_seat_action_claim(p_executor text)
returns setof public.claude_seat_actions
language sql
security definer
set search_path = public
as $$
  update public.claude_seat_actions a
     set status = 'running', started_at = now(), executor = p_executor
   where a.id = (
     select id from public.claude_seat_actions
      where status = 'requested'
      order by requested_at
      limit 1
      for update skip locked
   )
  returning a.*;
$$;
revoke execute on function public.claude_seat_action_claim(text) from public, anon, authenticated;
grant execute on function public.claude_seat_action_claim(text) to service_role;

-- RLS: 읽기는 admin만, 쓰기 정책 없음(service role) — claude_org_members와 같은 규칙
do $$
begin
  execute 'alter table public.claude_seat_actions enable row level security';
  execute 'drop policy if exists claude_seat_actions_admin_read on public.claude_seat_actions';
  execute 'create policy claude_seat_actions_admin_read on public.claude_seat_actions for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))';
  execute 'alter table public.claude_seat_executor enable row level security';
  execute 'drop policy if exists claude_seat_executor_admin_read on public.claude_seat_executor';
  execute 'create policy claude_seat_executor_admin_read on public.claude_seat_executor for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))';
end $$;

-- 확인:
-- select column_name, data_type from information_schema.columns where table_name = 'claude_seat_actions' order by ordinal_position;
-- select proname from pg_proc where proname = 'claude_seat_action_claim';
-- select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'claude_seat_action_claim';  -- service_role·postgres만
