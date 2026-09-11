begin;

create or replace function public.valid_page_permissions(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) <> 'object' then false else
    not exists (select 1 from jsonb_each(p) e where e.key not in
      ('food','ladder','team','survey','usage_code','usage_chat','usage_perf','rfp','people_news','guide')
      or jsonb_typeof(e.value) <> 'boolean') end;
$$;

create table if not exists public.user_page_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions jsonb not null default '{}' check (public.valid_page_permissions(permissions)),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.user_page_access enable row level security;
revoke all on public.user_page_access from anon, authenticated;
grant select on public.user_page_access to authenticated;
grant all on public.user_page_access to service_role;
drop policy if exists user_page_access_read on public.user_page_access;
create policy user_page_access_read on public.user_page_access for select to authenticated using (
  user_id=(select auth.uid()) or (select exists(select 1 from public.user_profiles where user_id=auth.uid() and role='admin'))
);

-- Caller-bound helper; role is always taken from the authoritative profile.
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role='admin' or (
    p_page in ('food','ladder','team','survey','usage_code','usage_chat','usage_perf','rfp','people_news','guide')
    and (p.role='user' or (p.role='guest' and p_page in ('food','ladder','team','survey')))
    and coalesce((a.permissions->>p_page)::boolean,true)
  ) from public.user_profiles p left join public.user_page_access a on a.user_id=p.user_id
    where p.user_id=auth.uid()),false);
$$;
revoke all on function public.has_page_access(text) from public, anon;
grant execute on function public.has_page_access(text) to authenticated, service_role;

create or replace function public.set_user_page_access(p_user_id uuid, p_permissions jsonb, p_expected_version integer)
returns public.user_page_access language plpgsql security definer set search_path = '' as $$
declare target_role text; current_version integer; result public.user_page_access;
begin
  if not exists (select 1 from public.user_profiles where user_id=auth.uid() and role='admin') then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if p_permissions is null or not public.valid_page_permissions(p_permissions) or p_expected_version is null or p_expected_version<0 then
    raise exception 'Invalid permissions' using errcode='22023';
  end if;
  select role into target_role from public.user_profiles where user_id=p_user_id for update;
  if not found then raise exception 'User not found' using errcode='P0002'; end if;
  if target_role='admin' then raise exception 'Administrators always have access' using errcode='22023'; end if;
  select version into current_version from public.user_page_access where user_id=p_user_id;
  if coalesce(current_version,0)<>p_expected_version then
    raise exception 'Permissions changed; reload first' using errcode='40001';
  end if;
  insert into public.user_page_access(user_id,permissions,version,updated_by)
    values(p_user_id,p_permissions,1,auth.uid())
    on conflict(user_id) do update set permissions=excluded.permissions,
      version=public.user_page_access.version+1,updated_at=now(),updated_by=auth.uid()
    returning * into result;
  return result;
end;
$$;
revoke all on function public.set_user_page_access(uuid,jsonb,integer) from public, anon;
grant execute on function public.set_user_page_access(uuid,jsonb,integer) to authenticated;

-- Existing SECURITY DEFINER actions must also reject direct RPC calls by restricted users.
do $$
declare signature text; definition text;
begin
  foreach signature in array array['public.set_yonhap_notice_subscription(boolean,text)', 'public.claim_yonhap_notice_send_now()'] loop
    if to_regprocedure(signature) is not null then
      select pg_get_functiondef(to_regprocedure(signature)) into definition;
      if position('public.has_page_access' in definition)=0 then
        definition:=regexp_replace(definition, E'\\mbegin\\M', E'begin\n  if not public.has_page_access(''people_news'') then raise exception ''Page access denied'' using errcode=''42501''; end if;', 'i');
        execute definition;
      end if;
    end if;
  end loop;
end;
$$;

-- Restrictive policies compose with existing ownership/publication rules, never widen them.
do $$
declare entry record;
begin
  for entry in select * from (values
    ('surveys','survey'),('survey_questions','survey'),('survey_responses','survey'),
    ('yonhap_notices','people_news'),('yonhap_notice_sync_runs','people_news'),
    ('yonhap_notice_subscriptions','people_news'),('yonhap_notice_email_deliveries','people_news'),
    ('team_sessions','team'),('team_attendance','team'),('team_comments','team'),('ladder_sessions','ladder')
  ) as t(table_name,page_key) loop
    if to_regclass('public.'||entry.table_name) is not null then
      execute format('drop policy if exists page_access_limit on public.%I',entry.table_name);
      execute format('create policy page_access_limit on public.%I as restrictive for all to authenticated using ((select public.has_page_access(%L))) with check ((select public.has_page_access(%L)))',entry.table_name,entry.page_key,entry.page_key);
    end if;
  end loop;
end;
$$;
commit;
