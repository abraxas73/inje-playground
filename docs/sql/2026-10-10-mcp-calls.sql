-- 데스크탑 MCP 커넥터(2026-10-10): 웹 /api/mcp ↔ 데스크탑 앱 도구 호출 중계 테이블.
-- 행은 웹이 응답 뒤 삭제, 10분 지나면 크론(/api/cron/mcp-purge) 삭제.
-- INSERT·DELETE는 service role(웹)만, 앱 세션은 자기 행만 SELECT·UPDATE(클레임·결과 쓰기).
-- 적용: Supabase MCP 또는 Management API(메모리 supabase-sql-via-management-api).
create table if not exists public.mcp_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool text not null,
  args jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','running','done','error')),
  result jsonb,
  worker text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz
);

create index if not exists mcp_calls_user_status_idx on public.mcp_calls (user_id, status, created_at);

alter table public.mcp_calls enable row level security;

drop policy if exists mcp_calls_own_select on public.mcp_calls;
create policy mcp_calls_own_select on public.mcp_calls
  for select using (auth.uid() = user_id);

drop policy if exists mcp_calls_own_update on public.mcp_calls;
create policy mcp_calls_own_update on public.mcp_calls
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, update on public.mcp_calls to authenticated;
revoke insert, delete on public.mcp_calls from authenticated, anon;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'mcp_calls') then
    alter publication supabase_realtime add table public.mcp_calls;
  end if;
end $$;
