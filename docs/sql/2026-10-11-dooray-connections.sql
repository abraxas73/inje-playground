-- Dooray personal REST connections. No client role may read even encrypted credentials.
begin;
create table if not exists public.dooray_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id text not null,
  organization_id text not null,
  account_name text not null,
  account_email text not null,
  token_enc text not null,
  connected_at timestamptz not null default now()
);
alter table public.dooray_connections enable row level security;
revoke all on public.dooray_connections from public, anon, authenticated;
grant select, insert, update, delete on public.dooray_connections to service_role;

create or replace function public.valid_page_permissions(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p)<>'object' then false else not exists
 (select 1 from jsonb_each(p) e where e.key not in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','marketing','guide','mcp','gw_mail','dooray') or jsonb_typeof(e.value)<>'boolean') end;
$$;
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select case
      when p_page = 'marketing' then
        public.marketing_access_account(p.user_id)
        or (p.role in ('user', 'admin') and coalesce((a.permissions->>'marketing')::boolean, false))
      else p.role = 'admin' or (
        p_page in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','guide','mcp','gw_mail','dooray')
        and (p.role = 'user' or (p.role = 'guest' and p_page in ('food','ladder','team','survey')))
        and coalesce((a.permissions->>p_page)::boolean, true))
    end
    from public.user_profiles p left join public.user_page_access a on a.user_id = p.user_id
    where p.user_id = auth.uid()), false);
$$;
commit;
