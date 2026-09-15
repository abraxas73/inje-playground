-- Transaction-only verification for media directory + matching. Runs on the linked DB and rolls back everything.
begin;
do $$
declare
  admin_id uuid; member_id uuid; o public.media_outlets; d public.media_departments; r jsonb; s public.media_alert_subscriptions; n integer;
begin
  select p.user_id into admin_id from public.user_profiles p join auth.users u on u.id = p.user_id where p.role = 'admin' limit 1;
  select p.user_id into member_id from public.user_profiles p join auth.users u on u.id = p.user_id and u.email_confirmed_at is not null where p.role = 'user' limit 1;
  if admin_id is null or member_id is null then raise exception 'Need one admin and one user'; end if;

  if public.media_norm('㈜헤럴드 경제') <> '헤럴드경제' then raise exception 'norm 1: %', public.media_norm('㈜헤럴드 경제'); end if;
  if public.media_norm('IT산업부 팩플팀') <> 'it산업부팩플팀' then raise exception 'norm 2'; end if;
  if public.media_norm('테크&사이언스부') <> '테크사이언스부' then raise exception 'norm 3'; end if;

  -- Non-admin cannot import or edit.
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  begin perform public.media_directory_import('[{"outlet":"테스트일보","department":"테크부"}]'::jsonb); raise exception 'user imported';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  r := public.media_directory_import('[{"outlet":"테스트일보","department":"테크부"},{"outlet":"테스트일보","department":"테크부"},{"outlet":"테스트일보","department":null},{"outlet":"검증경제","department":"산업부"},{"outlet":"X","department":"y"}]'::jsonb);
  if (r->>'outletsAdded')::int <> 2 or (r->>'departmentsAdded')::int <> 2 or (r->>'anyDepartmentSet')::int <> 1 or (r->>'skipped')::int <> 1 then raise exception 'import counts %', r; end if;
  r := public.media_directory_import('[{"outlet":"테스트일보","department":"테크부"},{"outlet":"테스트 일보","department":null}]'::jsonb);
  if (r->>'outletsAdded')::int <> 0 or (r->>'departmentsAdded')::int <> 0 or (r->>'outletsExisting')::int <> 1 then raise exception 'reimport not idempotent %', r; end if;

  select * into o from public.media_outlets where name_norm = '검증경제';
  o := public.media_outlet_save(o.id, '검증경제', array['검증경제신문', ' '], false, true);
  if o.aliases <> array['검증경제신문'] or o.aliases_norm <> array['검증경제신문'] then raise exception 'alias save'; end if;
  begin perform public.media_outlet_save(null, '검증경제신문', '{}', false, true); raise exception 'alias collision accepted';
  exception when unique_violation then null; end;
  begin perform public.media_department_save(null, o.id, '산업부', true); raise exception 'duplicate department accepted';
  exception when unique_violation then null; end;
  -- Department delete: admin only, cascades to matches recorded for that department.
  d := public.media_department_save(null, o.id, '삭제부', true);
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  begin perform public.media_department_delete(d.id); raise exception 'user deleted department';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  d := public.media_department_delete(d.id);
  if exists (select 1 from public.media_departments where id = d.id) then raise exception 'department not deleted'; end if;
  begin perform public.media_department_delete(d.id); raise exception 'deleting missing department succeeded';
  exception when no_data_found then null; end;

  -- Matching: outlet+department required unless any_department.
  insert into public.yonhap_notices (source_id, category, title, summary, source_url, published_at) values
    ('AKR99990000000001', 'obituary', '[부고] 김검증(검증경제 기자)씨 부친상', '▲ 김검증(검증경제 산업부 기자)씨 부친상 = 15일', 'https://www.yna.co.kr/view/AKR99990000000001', now()),
    ('AKR99990000000002', 'obituary', '[부고] 이검증(검증경제 기자)씨 모친상', '▲ 이검증(검증경제 기자)씨 모친상 = 15일', 'https://www.yna.co.kr/view/AKR99990000000002', now()),
    ('AKR99990000000003', 'obituary', '[부고] 박검증(테스트일보 기자)씨 조부상', '▲ 박검증(테스트일보 기자)씨 조부상', 'https://www.yna.co.kr/view/AKR99990000000003', now()),
    ('AKR99990000000004', 'personnel', '[인사] 검증경제 산업부', '검증경제 산업부 인사', 'https://www.yna.co.kr/view/AKR99990000000004', now());
  r := public.media_match_notices(array['AKR99990000000001','AKR99990000000002','AKR99990000000003','AKR99990000000004'], null);
  if jsonb_array_length(r) <> 2 then raise exception 'expected 2 matches, got %', r; end if;
  if not exists (select 1 from jsonb_array_elements(r) e where e->>'sourceId' = 'AKR99990000000001' and e->>'department' = '산업부') then raise exception 'dept match missing'; end if;
  if not exists (select 1 from jsonb_array_elements(r) e where e->>'sourceId' = 'AKR99990000000003' and e->>'department' is null and e->>'matchedText' = '테스트일보') then raise exception 'any-department match missing'; end if;
  r := public.media_match_notices(array['AKR99990000000001','AKR99990000000003'], null);
  if jsonb_array_length(r) <> 0 then raise exception 'rematch returned rows %', r; end if;
  -- Alias hit
  update public.yonhap_notices set summary = '▲ 최검증(검증경제신문 산업부 차장)씨 빙모상' where source_id = 'AKR99990000000002';
  r := public.media_match_notices(array['AKR99990000000002'], null);
  if jsonb_array_length(r) <> 1 then raise exception 'alias match failed %', r; end if;

  -- Subscription: page access + recipients filter.
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  s := public.set_media_alert_subscription(true);
  if not s.enabled then raise exception 'subscribe failed'; end if;
  select count(*) into n from public.media_alert_recipients() rec where rec.user_id = s.user_id;
  if n <> 1 then raise exception 'recipient missing'; end if;
  s := public.set_media_alert_subscription(false);
  select count(*) into n from public.media_alert_recipients() rec where rec.user_id = s.user_id;
  if n <> 0 then raise exception 'unsubscribed still recipient'; end if;
  -- Reader without people_news permission cannot see outlets.
  insert into public.user_page_access (user_id, permissions) values (member_id, '{"people_news": false}'::jsonb)
    on conflict (user_id) do update set permissions = '{"people_news": false}'::jsonb;
  set local role authenticated;
  select count(*) into n from public.media_outlets;
  if n <> 0 then raise exception 'restricted user read % outlets', n; end if;
  reset role;
  raise notice 'media directory checks passed';
end;
$$;
rollback;
