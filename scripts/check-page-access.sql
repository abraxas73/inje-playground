-- Execute in a transaction and roll back: never persist test restrictions.
begin;
do $$
declare administrator uuid; subject uuid; result public.user_page_access; version_now integer;
begin
  select user_id into administrator from public.user_profiles where role='admin' limit 1;
  select user_id into subject from public.user_profiles where role='user' limit 1;
  if administrator is null or subject is null then raise exception 'Need existing admin and user test subjects'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', administrator, 'role', 'authenticated')::text,true);
  select coalesce((select version from public.user_page_access where user_id=subject),0) into version_now;
  result:=public.set_user_page_access(subject,'{"food":false,"rfp":false}',version_now);
  if result.version<>version_now+1 then raise exception 'Version not advanced'; end if;
  begin
    perform public.set_user_page_access(subject,'{}',version_now);
    raise exception 'Stale write accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.set_user_page_access(administrator,'{"food":false}',0);
    raise exception 'Admin restriction accepted';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub',subject,'role','authenticated')::text,true);
  if public.has_page_access('food') or public.has_page_access('rfp') then raise exception 'Denied page accepted'; end if;
  if not public.has_page_access('team') then raise exception 'Default access lost'; end if;
  begin
    perform public.set_user_page_access(subject,'{}',result.version);
    raise exception 'Self escalation accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub',administrator,'role','authenticated')::text,true);
  update public.user_profiles set role='guest' where user_id=subject;
  perform set_config('request.jwt.claims', json_build_object('sub',subject,'role','authenticated')::text,true);
  if public.has_page_access('usage_code') then raise exception 'Guest elevated'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',administrator,'role','authenticated')::text,true);
  result:=public.set_user_page_access(subject,'{}',result.version);
  if result.permissions<>'{}'::jsonb then raise exception 'Reset failed'; end if;
  update public.user_profiles set role='user' where user_id=subject;
  result:=public.set_user_page_access(subject,'{"people_news":false}',result.version);
  perform set_config('request.jwt.claims', json_build_object('sub',subject,'role','authenticated')::text,true);
  begin
    perform public.claim_yonhap_notice_send_now();
    raise exception 'Direct mail RPC bypassed page restriction';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_yonhap_notice_subscription(true,'07:10');
    raise exception 'Direct subscription RPC bypassed page restriction';
  exception when insufficient_privilege then null; end;
end;
$$;
set local role authenticated;
do $$
begin
  if exists(select 1 from public.user_page_access where user_id<>auth.uid()) then raise exception 'Other user access leaked'; end if;
  if exists(select 1 from public.yonhap_notices) then raise exception 'Restricted notices leaked through RLS'; end if;
  begin
    update public.user_page_access set permissions='{}' where user_id=auth.uid();
    raise exception 'Direct self update accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
rollback;
