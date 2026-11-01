-- 2026-11-02: 할 일(TODO) — 시급도 매트릭스(오늘·받은함·예정·언젠가)·중요도 매트릭스(p1~p4)·프로젝트·주간 리뷰.
-- JARVIS(todos·todo_projects·todo_review_runs·migrate_todo·suggest_stale_cleanup)를 옮겼다. JARVIS의 옛 status 한 칸은 처음부터 state(진행)·urgency(분류) 두 칸으로만 둔다.
-- 앱이 본인 행만 직접 읽고 쓴다(RLS, mcp_calls와 같은 방식). 주간 리뷰는 크론 /api/cron/todo-review(service role)가 쓴다.
-- 권한 함수는 2026-10-23-org-chart.sql 정의 그대로에 todo만 더했다(정책이 쓰므로 맨 앞) — 드리프트 테스트는 이제 이 파일을 읽는다.
-- RLS는 본인 행 + todo 페이지 권한 — 관리자 스위치를 끄면 앱이 직접 읽고 쓰는 것도 막힌다.

begin;
create or replace function public.valid_page_permissions(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p)<>'object' then false else not exists
 (select 1 from jsonb_each(p) e where e.key not in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','marketing','guide','mcp','gw_mail','gw_approvals','gw_attendance','gw_today','gw_board','gw_messenger','gw_notes','gw_attend','dooray','assistant','proposal','org_chart','todo') or jsonb_typeof(e.value)<>'boolean') end;
$$;
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select case
      when p_page = 'marketing' then
        public.marketing_access_account(p.user_id)
        or (p.role in ('user', 'admin') and coalesce((a.permissions->>'marketing')::boolean, false))
      else p.role = 'admin' or (
        p_page in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','guide','mcp','gw_mail','gw_approvals','gw_attendance','gw_today','gw_board','gw_messenger','gw_notes','gw_attend','dooray','assistant','proposal','org_chart','todo')
        and (p.role = 'user' or (p.role = 'guest' and p_page in ('food','ladder','team','survey')))
        and coalesce((a.permissions->>p_page)::boolean, true))
    end
    from public.user_profiles p left join public.user_page_access a on a.user_id = p.user_id
    where p.user_id = auth.uid()), false);
$$;
commit;

create table if not exists public.todo_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (length(title) between 1 and 200),
  outcome     text check (length(outcome) <= 2000),
  status      text not null default 'active' check (status in ('active','archived')),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists todo_projects_user_status_idx on public.todo_projects (user_id, status);

create table if not exists public.todos (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title             text not null check (length(title) between 1 and 500),
  notes             text check (length(notes) <= 5000),
  state             text not null default 'in_progress' check (state in ('in_progress','done','cancelled')),
  urgency           text not null default 'inbox' check (urgency in ('today','inbox','scheduled','someday')),
  priority          text not null default 'p3' check (priority in ('p1','p2','p3','p4')),
  estimated_minutes integer check (estimated_minutes between 1 and 10080),
  scheduled_for     timestamptz,
  project_id        uuid references public.todo_projects(id) on delete set null,
  context_tags      text[] not null default '{}' check (cardinality(context_tags) <= 20),
  migration_count   integer not null default 0,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists todos_user_state_idx on public.todos (user_id, state, urgency);
create index if not exists todos_user_updated_idx on public.todos (user_id, updated_at desc);
create index if not exists todos_project_idx on public.todos (project_id) where project_id is not null;

-- 남의 프로젝트에 내 할 일을 걸지 못하게(project_id는 FK만으로는 소유자를 확인하지 않는다)
create or replace function public.todos_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null and not exists (select 1 from public.todo_projects p where p.id = new.project_id and p.user_id = new.user_id) then
    raise exception 'project not found' using errcode = '23503';
  end if;
  new.updated_at := now();
  -- 완료 시각은 상태가 바뀔 때 서버가 정한다(앱 시계에 기대지 않음)
  if new.state = 'done' and (tg_op = 'INSERT' or old.state <> 'done') then new.completed_at := now();
  elsif new.state <> 'done' then new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists todos_guard on public.todos;
create trigger todos_guard before insert or update on public.todos for each row execute function public.todos_guard();

alter table public.todos enable row level security;
alter table public.todo_projects enable row level security;
drop policy if exists todos_own on public.todos;
-- 관리자가 todo 페이지 권한을 끄면(또는 guest) 데이터도 막는다 — has_page_access는 아래에서 todo 키를 더한 정의
create policy todos_own on public.todos for all to authenticated using (auth.uid() = user_id and public.has_page_access('todo')) with check (auth.uid() = user_id and public.has_page_access('todo'));
drop policy if exists todo_projects_own on public.todo_projects;
create policy todo_projects_own on public.todo_projects for all to authenticated using (auth.uid() = user_id and public.has_page_access('todo')) with check (auth.uid() = user_id and public.has_page_access('todo'));

-- 명시적 이월(어제 '오늘'에 남은 할 일): 분류를 바꾸거나 취소하고 이월 횟수 +1. 3회 이상이면 앱이 정리를 권한다.
create or replace function public.migrate_todo(p_id uuid, p_to text) returns public.todos
language plpgsql security invoker set search_path = public as $$
declare r public.todos;
begin
  if p_to not in ('today','inbox','scheduled','someday','cancelled') then
    raise exception 'invalid target: %', p_to using errcode = '22023';
  end if;
  update public.todos
     set urgency = case when p_to = 'cancelled' then urgency else p_to end,
         state = case when p_to = 'cancelled' then 'cancelled' else state end,
         migration_count = migration_count + 1
   where id = p_id and user_id = auth.uid()
  returning * into r;
  if r.id is null then raise exception 'todo not found' using errcode = '42501'; end if;
  return r;
end $$;
grant execute on function public.migrate_todo(uuid, text) to authenticated;

-- 주간 리뷰 — 사용자당 최근 1건(크론이 덮어씀). 본인은 읽기만.
create table if not exists public.todo_review_runs (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  last_run_at  timestamptz not null default now(),
  last_summary text,
  last_stats   jsonb,
  model        text
);
alter table public.todo_review_runs enable row level security;
drop policy if exists todo_review_runs_own on public.todo_review_runs;
create policy todo_review_runs_own on public.todo_review_runs for select to authenticated using (auth.uid() = user_id and public.has_page_access('todo'));
