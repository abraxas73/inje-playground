-- Transaction-only verification: marketing access via the permission map. Everything rolls back.
begin;
do $$
declare admin_id uuid; member_id uuid; other_admin uuid; n integer; ok boolean; saved public.user_page_access;
begin
  select user_id into admin_id from public.user_profiles where user_id = '46a2400a-f04f-4b78-bd20-e3f75507b154'::uuid and role = 'admin';
  select p.user_id into member_id from public.user_profiles p where p.role = 'user'
    and not exists (select 1 from public.marketing_reviewers r where r.user_id = p.user_id)
    and p.user_id not in ('46a2400a-f04f-4b78-bd20-e3f75507b154'::uuid, 'a4e1906d-b915-4e00-9b4e-657beeb396ae'::uuid) limit 1;
  select p.user_id into other_admin from public.user_profiles p where p.role = 'admin'
    and p.user_id not in ('46a2400a-f04f-4b78-bd20-e3f75507b154'::uuid, 'a4e1906d-b915-4e00-9b4e-657beeb396ae'::uuid)
    and not exists (select 1 from public.marketing_reviewers r where r.user_id = p.user_id) limit 1;
  if admin_id is null or member_id is null then raise exception 'Need the fixed admin and one plain user'; end if;

  -- Plain user: denied by default, allowed after the admin grants marketing, still cannot review.
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  if public.has_page_access('marketing') then raise exception 'plain user should be denied by default'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  select count(*) into n from public.marketing_designated_accounts() where marketing_designated_accounts = admin_id;
  if n <> 1 then raise exception 'fixed manager missing from designated accounts'; end if;
  saved := public.set_user_page_access(member_id, '{"marketing": true}'::jsonb, coalesce((select version from public.user_page_access where user_id = member_id), 0));
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  if not public.has_page_access('marketing') then raise exception 'granted user should have access'; end if;
  if public.marketing_can_review() then raise exception 'granted user must not review'; end if;
  if not public.has_page_access('people_news') then raise exception 'other pages keep role default'; end if;
  select count(*) into n from public.marketing_designated_accounts();
  if n <> 0 then raise exception 'non-admin must not list designated accounts'; end if;

  -- Revoking the key denies again.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  saved := public.set_user_page_access(member_id, '{"marketing": false}'::jsonb, saved.version);
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  if public.has_page_access('marketing') then raise exception 'revoked user should be denied'; end if;

  -- Admin target: marketing key allowed, any other key refused; admin without the key is denied for marketing only.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if other_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', other_admin, 'role', 'authenticated')::text, true);
    if public.has_page_access('marketing') then raise exception 'other admin should be denied marketing by default'; end if;
    if not public.has_page_access('rfp') then raise exception 'admin keeps ordinary pages'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    saved := public.set_user_page_access(other_admin, '{"marketing": true}'::jsonb, coalesce((select version from public.user_page_access where user_id = other_admin), 0));
    perform set_config('request.jwt.claims', json_build_object('sub', other_admin, 'role', 'authenticated')::text, true);
    if not public.has_page_access('marketing') then raise exception 'granted admin should have marketing access'; end if;
    if public.marketing_can_review() then raise exception 'granted admin must not review without designation'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    begin perform public.set_user_page_access(other_admin, '{"marketing": true, "food": false}'::jsonb, saved.version); raise exception 'admin ordinary page override accepted';
    exception when invalid_parameter_value then null; end;
  end if;

  -- Fixed manager keeps access even with an explicit false.
  saved := public.set_user_page_access(member_id, '{}'::jsonb, coalesce((select version from public.user_page_access where user_id = member_id), 0));
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  if not public.has_page_access('marketing') then raise exception 'fixed manager lost access'; end if;
  raise notice 'marketing page permission checks passed';
end;
$$;
rollback;
