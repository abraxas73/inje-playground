-- 매체·부서 관리 및 부고 매칭 알림. yonhap-notices·page-access SQL 이후 적용. 재적용 안전.
begin;

create or replace function public.media_norm(p text) returns text
language sql immutable strict set search_path = '' as $$
  select translate(regexp_replace(lower(p), '㈜|㈔|\(주\)|\(사\)|주식회사|사단법인|\s', '', 'g'), '·.,()[]/\''"“”‘’&:;!?-', '');
$$;

create table if not exists public.media_outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 100),
  name_norm text not null unique check (length(name_norm) >= 2),
  aliases text[] not null default '{}',
  aliases_norm text[] not null default '{}',
  any_department boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists media_outlets_aliases_norm_idx on public.media_outlets using gin (aliases_norm);

create table if not exists public.media_departments (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.media_outlets(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 100),
  name_norm text not null check (length(name_norm) >= 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (outlet_id, name_norm)
);

create table if not exists public.media_obituary_matches (
  id bigint generated always as identity primary key,
  source_id text not null references public.yonhap_notices(source_id) on delete cascade,
  outlet_id uuid not null references public.media_outlets(id) on delete cascade,
  department_id uuid references public.media_departments(id) on delete cascade,
  matched_text text not null,
  sync_run_id bigint references public.yonhap_notice_sync_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
create unique index if not exists media_obituary_matches_unique on public.media_obituary_matches (source_id, outlet_id, department_id) nulls not distinct;
create index if not exists media_obituary_matches_source_idx on public.media_obituary_matches (source_id);
create index if not exists media_obituary_matches_run_idx on public.media_obituary_matches (sync_run_id);

create table if not exists public.media_alert_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.media_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  sync_run_id bigint not null references public.yonhap_notice_sync_runs(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  match_count integer not null check (match_count >= 0),
  status text not null check (status in ('sent', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  unique (sync_run_id, recipient_user_id)
);
create index if not exists media_alert_deliveries_created_idx on public.media_alert_deliveries (created_at desc);

alter table public.media_outlets enable row level security;
alter table public.media_departments enable row level security;
alter table public.media_obituary_matches enable row level security;
alter table public.media_alert_subscriptions enable row level security;
alter table public.media_alert_deliveries enable row level security;
revoke all on public.media_outlets, public.media_departments, public.media_obituary_matches, public.media_alert_subscriptions, public.media_alert_deliveries from anon, authenticated;
grant select on public.media_outlets, public.media_departments, public.media_obituary_matches, public.media_alert_subscriptions, public.media_alert_deliveries to authenticated;
grant all on public.media_outlets, public.media_departments, public.media_obituary_matches, public.media_alert_subscriptions, public.media_alert_deliveries to service_role;
grant usage, select on sequence public.media_obituary_matches_id_seq to service_role;

drop policy if exists media_outlets_read on public.media_outlets;
create policy media_outlets_read on public.media_outlets for select to authenticated using ((select public.has_page_access('people_news')));
drop policy if exists media_departments_read on public.media_departments;
create policy media_departments_read on public.media_departments for select to authenticated using ((select public.has_page_access('people_news')));
drop policy if exists media_obituary_matches_read on public.media_obituary_matches;
create policy media_obituary_matches_read on public.media_obituary_matches for select to authenticated using ((select public.has_page_access('people_news')));
drop policy if exists media_alert_subscriptions_own on public.media_alert_subscriptions;
create policy media_alert_subscriptions_own on public.media_alert_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists media_alert_deliveries_read on public.media_alert_deliveries;
create policy media_alert_deliveries_read on public.media_alert_deliveries for select to authenticated
using (recipient_user_id = (select auth.uid()) or (select exists (select 1 from public.user_profiles where user_id = auth.uid() and role = 'admin')));

-- Admin bulk import from the media list spreadsheet. Idempotent: existing rows are kept and re-activated.
create or replace function public.media_directory_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  item jsonb; outlet_name text; dept_name text; outlet_norm text; dept_norm text; outlet_row public.media_outlets;
  outlets_added integer := 0; outlets_existing integer := 0; depts_added integer := 0; depts_existing integer := 0; any_set integer := 0; skipped integer := 0;
  seen_outlets text[] := '{}'; seen_pairs text[] := '{}';
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Invalid rows' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(p_rows) loop
    outlet_name := btrim(coalesce(item->>'outlet', '')); dept_name := btrim(coalesce(item->>'department', ''));
    outlet_norm := public.media_norm(outlet_name);
    if length(outlet_norm) < 2 or length(outlet_name) > 100 or length(dept_name) > 100 then skipped := skipped + 1; continue; end if;
    select * into outlet_row from public.media_outlets where name_norm = outlet_norm;
    if not found then
      insert into public.media_outlets (name, name_norm, updated_by) values (outlet_name, outlet_norm, caller) returning * into outlet_row;
      outlets_added := outlets_added + 1;
    elsif not (outlet_norm = any(seen_outlets)) then
      outlets_existing := outlets_existing + 1;
      if not outlet_row.active then update public.media_outlets set active = true, updated_at = now(), updated_by = caller where id = outlet_row.id; end if;
    end if;
    seen_outlets := array_append(seen_outlets, outlet_norm);
    if dept_name = '' then
      if not outlet_row.any_department then
        update public.media_outlets set any_department = true, updated_at = now(), updated_by = caller where id = outlet_row.id;
        any_set := any_set + 1;
      end if;
      continue;
    end if;
    dept_norm := public.media_norm(dept_name);
    if length(dept_norm) < 2 then skipped := skipped + 1; continue; end if;
    if exists (select 1 from public.media_departments where outlet_id = outlet_row.id and name_norm = dept_norm) then
      if not ((outlet_norm || '|' || dept_norm) = any(seen_pairs)) then depts_existing := depts_existing + 1; end if;
      update public.media_departments set active = true, updated_at = now(), updated_by = caller where outlet_id = outlet_row.id and name_norm = dept_norm and not active;
    else
      insert into public.media_departments (outlet_id, name, name_norm, updated_by) values (outlet_row.id, dept_name, dept_norm, caller);
      depts_added := depts_added + 1;
    end if;
    seen_pairs := array_append(seen_pairs, outlet_norm || '|' || dept_norm);
  end loop;
  return jsonb_build_object('outletsAdded', outlets_added, 'outletsExisting', outlets_existing, 'departmentsAdded', depts_added,
    'departmentsExisting', depts_existing, 'anyDepartmentSet', any_set, 'skipped', skipped);
end;
$$;
revoke all on function public.media_directory_import(jsonb) from public, anon;
grant execute on function public.media_directory_import(jsonb) to authenticated;

create or replace function public.media_outlet_save(p_id uuid, p_name text, p_aliases text[], p_any_department boolean, p_active boolean) returns public.media_outlets
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); n text := btrim(coalesce(p_name, '')); nn text := public.media_norm(btrim(coalesce(p_name, '')));
  al text[] := '{}'; aln text[] := '{}'; a text; an text; result public.media_outlets;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if length(n) < 2 or length(n) > 100 or length(nn) < 2 then raise exception 'Invalid outlet name' using errcode = '22023'; end if;
  foreach a in array coalesce(p_aliases, '{}'::text[]) loop
    a := btrim(coalesce(a, '')); an := public.media_norm(a);
    if a = '' then continue; end if;
    if length(a) > 100 or length(an) < 2 then raise exception 'Invalid alias' using errcode = '22023'; end if;
    if an = nn or an = any(aln) then continue; end if;
    al := array_append(al, a); aln := array_append(aln, an);
  end loop;
  if cardinality(al) > 20 then raise exception 'Too many aliases' using errcode = '22023'; end if;
  if exists (select 1 from public.media_outlets o where o.id is distinct from p_id
             and (o.name_norm = nn or o.name_norm = any(aln) or nn = any(o.aliases_norm) or o.aliases_norm && aln)) then
    raise exception 'Outlet name or alias already used' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.media_outlets (name, name_norm, aliases, aliases_norm, any_department, active, updated_by)
      values (n, nn, al, aln, coalesce(p_any_department, false), coalesce(p_active, true), caller) returning * into result;
  else
    update public.media_outlets set name = n, name_norm = nn, aliases = al, aliases_norm = aln,
      any_department = coalesce(p_any_department, any_department), active = coalesce(p_active, active), updated_at = now(), updated_by = caller
      where id = p_id returning * into result;
    if not found then raise exception 'Outlet not found' using errcode = 'P0002'; end if;
  end if;
  return result;
end;
$$;
revoke all on function public.media_outlet_save(uuid, text, text[], boolean, boolean) from public, anon;
grant execute on function public.media_outlet_save(uuid, text, text[], boolean, boolean) to authenticated;

create or replace function public.media_department_save(p_id uuid, p_outlet_id uuid, p_name text, p_active boolean) returns public.media_departments
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); n text := btrim(coalesce(p_name, '')); nn text := public.media_norm(btrim(coalesce(p_name, ''))); result public.media_departments;
begin
  if caller is null or not exists (select 1 from public.user_profiles where user_id = caller and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_outlet_id is null or not exists (select 1 from public.media_outlets where id = p_outlet_id) then raise exception 'Outlet not found' using errcode = 'P0002'; end if;
  if length(n) < 2 or length(n) > 100 or length(nn) < 2 then raise exception 'Invalid department name' using errcode = '22023'; end if;
  if exists (select 1 from public.media_departments d where d.outlet_id = p_outlet_id and d.name_norm = nn and d.id is distinct from p_id) then
    raise exception 'Department already exists' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.media_departments (outlet_id, name, name_norm, active, updated_by) values (p_outlet_id, n, nn, coalesce(p_active, true), caller) returning * into result;
  else
    update public.media_departments set name = n, name_norm = nn, active = coalesce(p_active, active), updated_at = now(), updated_by = caller
      where id = p_id and outlet_id = p_outlet_id returning * into result;
    if not found then raise exception 'Department not found' using errcode = 'P0002'; end if;
  end if;
  return result;
end;
$$;
revoke all on function public.media_department_save(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.media_department_save(uuid, uuid, text, boolean) to authenticated;

create or replace function public.set_media_alert_subscription(p_enabled boolean) returns public.media_alert_subscriptions
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); saved public.media_alert_subscriptions;
begin
  if caller is null or not public.has_page_access('people_news') then raise exception 'Page access denied' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'Invalid subscription' using errcode = '22023'; end if;
  if p_enabled and not exists (select 1 from auth.users where id = caller and email is not null and email_confirmed_at is not null) then
    raise exception 'Verified email required' using errcode = '22023';
  end if;
  insert into public.media_alert_subscriptions (user_id, enabled) values (caller, p_enabled)
    on conflict (user_id) do update set enabled = excluded.enabled, updated_at = now() returning * into saved;
  return saved;
end;
$$;
revoke all on function public.set_media_alert_subscription(boolean) from public, anon;
grant execute on function public.set_media_alert_subscription(boolean) to authenticated;

-- Collector only. Matches the given obituaries against active outlets; returns rows inserted by THIS call.
create or replace function public.media_match_notices(p_source_ids text[], p_run_id bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inserted jsonb;
begin
  with notices as (
    select n.source_id, public.media_norm(n.title || ' ' || n.summary) as body
    from public.yonhap_notices n where n.source_id = any(coalesce(p_source_ids, '{}'::text[])) and n.category = 'obituary'
  ), outlet_hits as (
    select x.source_id, o.id as outlet_id, o.name, o.any_department
    from notices x join public.media_outlets o on o.active
    where position(o.name_norm in x.body) > 0 or exists (select 1 from unnest(o.aliases_norm) a where position(a in x.body) > 0)
  ), candidates as (
    select h.source_id, h.outlet_id, null::uuid as department_id, h.name as matched_text from outlet_hits h where h.any_department
    union all
    select h.source_id, h.outlet_id, d.id, h.name || ' / ' || d.name
    from outlet_hits h join public.media_departments d on d.outlet_id = h.outlet_id and d.active
    join notices x on x.source_id = h.source_id where position(d.name_norm in x.body) > 0
  ), ins as (
    insert into public.media_obituary_matches (source_id, outlet_id, department_id, matched_text, sync_run_id)
    select c.source_id, c.outlet_id, c.department_id, c.matched_text, p_run_id from candidates c
    on conflict do nothing returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'sourceId', i.source_id, 'outlet', o.name, 'department', d.name, 'matchedText', i.matched_text,
           'title', n.title, 'summary', n.summary, 'url', n.source_url, 'publishedAt', n.published_at) order by n.published_at desc, i.id), '[]'::jsonb)
    into inserted
  from ins i join public.yonhap_notices n on n.source_id = i.source_id
  join public.media_outlets o on o.id = i.outlet_id left join public.media_departments d on d.id = i.department_id;
  return inserted;
end;
$$;
revoke all on function public.media_match_notices(text[], bigint) from public, anon, authenticated;
grant execute on function public.media_match_notices(text[], bigint) to service_role;

create or replace function public.media_alert_recipients() returns table (user_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select s.user_id, u.email
  from public.media_alert_subscriptions s
  join auth.users u on u.id = s.user_id and u.email is not null and u.email_confirmed_at is not null
  join public.user_profiles p on p.user_id = s.user_id and p.role in ('user', 'admin')
  left join public.user_page_access a on a.user_id = s.user_id
  where s.enabled and (p.role = 'admin' or coalesce((a.permissions->>'people_news')::boolean, true))
  order by u.email;
$$;
revoke all on function public.media_alert_recipients() from public, anon, authenticated;
grant execute on function public.media_alert_recipients() to service_role;

commit;
