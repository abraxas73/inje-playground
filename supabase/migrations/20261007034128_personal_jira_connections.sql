-- 개인 Jira API 토큰. 서버가 세션 user_id로만 접근하며 일반 클라이언트에는 암호문도 공개하지 않는다.
create table if not exists public.jira_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_id text not null,
  account_name text not null,
  email text not null,
  api_base text not null,
  token_enc text not null,
  connected_at timestamptz not null default now()
);
alter table public.jira_connections enable row level security;
revoke all on public.jira_connections from public, anon, authenticated;
grant select, insert, update, delete on public.jira_connections to service_role;
