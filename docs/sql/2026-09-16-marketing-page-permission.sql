-- 마케팅 Master DB를 페이지 접근 권한 화면에서도 관리한다.
-- 접근 = 고정 관리자·검수자(기존) OR user_page_access.permissions.marketing = true. 기본은 여전히 차단.
-- 관리자 계정은 마케팅 키만 개별 설정할 수 있다(다른 페이지는 항상 허용). 재적용 안전.
begin;

create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case
      when p_page = 'marketing' then
        public.marketing_access_account(p.user_id)
        or (p.role in ('user', 'admin') and coalesce((a.permissions->>'marketing')::boolean, false))
      else p.role = 'admin' or (
        p_page in ('food','ladder','team','survey','usage_code','usage_chat','usage_perf','rfp','people_news','guide','marketing')
        and (p.role = 'user' or (p.role = 'guest' and p_page in ('food','ladder','team','survey')))
        and coalesce((a.permissions->>p_page)::boolean, true))
    end
    from public.user_profiles p left join public.user_page_access a on a.user_id = p.user_id
    where p.user_id = auth.uid()), false);
$$;

create or replace function public.set_user_page_access(p_user_id uuid, p_permissions jsonb, p_expected_version integer)
returns public.user_page_access language plpgsql security definer set search_path = '' as $$
declare target_role text; current_version integer; result public.user_page_access;
begin
  if not exists (select 1 from public.user_profiles where user_id = auth.uid() and role = 'admin') then
    raise exception 'Admin required' using errcode = '42501';
  end if;
  if p_permissions is null or not public.valid_page_permissions(p_permissions) or p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid permissions' using errcode = '22023';
  end if;
  select role into target_role from public.user_profiles where user_id = p_user_id for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  -- Administrators always reach every ordinary page; only the marketing key may be stored for them.
  if target_role = 'admin' and exists (select 1 from jsonb_object_keys(p_permissions) k where k <> 'marketing') then
    raise exception 'Administrators always have access' using errcode = '22023';
  end if;
  select version into current_version from public.user_page_access where user_id = p_user_id;
  if coalesce(current_version, 0) <> p_expected_version then
    raise exception 'Permissions changed; reload first' using errcode = '40001';
  end if;
  insert into public.user_page_access(user_id, permissions, version, updated_by)
    values (p_user_id, p_permissions, 1, auth.uid())
    on conflict (user_id) do update set permissions = excluded.permissions,
      version = public.user_page_access.version + 1, updated_at = now(), updated_by = auth.uid()
    returning * into result;
  return result;
end;
$$;

-- Admin-only: accounts that reach marketing regardless of the permission map (fixed managers and designated reviewers).
create or replace function public.marketing_designated_accounts() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.user_id from public.user_profiles p
  where exists (select 1 from public.user_profiles me where me.user_id = auth.uid() and me.role = 'admin')
    and (public.marketing_manager_account(p.user_id) or exists (select 1 from public.marketing_reviewers r where r.user_id = p.user_id));
$$;
revoke all on function public.marketing_designated_accounts() from public, anon;
grant execute on function public.marketing_designated_accounts() to authenticated;

commit;
