-- 기존 개인 토큰 연결은 로그인 재연결을 안내하고 OAuth로 교체한다.
alter table public.jira_connections
  add column auth_type text not null default 'api_token' check (auth_type in ('api_token', 'oauth')),
  add column refresh_token_enc text,
  add column expires_at timestamptz,
  add column refresh_lock uuid,
  add column refresh_lock_until timestamptz;
-- 새 컬럼도 기존 service_role 전용 권한을 상속한다.
alter table public.jira_connections enable row level security;
revoke all on public.jira_connections from public, anon, authenticated;
grant select, insert, update, delete on public.jira_connections to service_role;
