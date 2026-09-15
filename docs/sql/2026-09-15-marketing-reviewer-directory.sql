-- Reviewer visibility and guarded changes. After marketing-completion.sql.
-- Does not grant/revoke any existing reviewer or change the pilot access policy.
begin;
create index if not exists marketing_reviewer_event_target_idx on public.marketing_review_events((after_data->>'userId'),created_at desc,id desc) where action='검수 권한 변경';

-- Private helper: metadata comes from preserved audit records, not migration time.
create or replace function public.marketing_reviewer_details(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'userId',p.user_id,'name',coalesce(p.display_name,p.email),'email',p.email,'role',p.role,
  'pageAccess',a.allowed,'explicit',r.user_id is not null,
  'canReview',a.allowed and (p.role='admin' or r.user_id is not null),
  'grantedAt',case when r.user_id is not null and e.after_data->>'enabled'='true' then e.created_at end,
  'grantedBy',case when r.user_id is not null and e.after_data->>'enabled'='true' then e.actor_name end,
  'version',md5(jsonb_build_array(p.user_id,p.role,p.email,p.display_name,r.user_id,e.id,a.allowed)::text))
 from public.user_profiles p left join public.marketing_reviewers r on r.user_id=p.user_id
 cross join lateral (select p.role in ('user','admin') and p.user_id in
  ('46a2400a-f04f-4b78-bd20-e3f75507b154'::uuid,'a4e1906d-b915-4e00-9b4e-657beeb396ae'::uuid) allowed) a
 left join lateral (select ev.id,ev.actor_name,ev.created_at,ev.after_data from public.marketing_review_events ev
  where ev.action='검수 권한 변경' and ev.after_data->>'userId'=p.user_id::text order by ev.created_at desc,ev.id desc limit 1) e on true
 where p.user_id=p_user;
$$;
revoke all on function public.marketing_reviewer_details(uuid) from public,anon,authenticated,service_role;

create or replace function public.marketing_reviewer_directory(p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_page_access('marketing') then raise exception '마케팅 DB 접근 권한이 없습니다.' using errcode='42501'; end if;
 return jsonb_build_object(
  'canManage',exists(select 1 from public.user_profiles where user_id=auth.uid() and role='admin'),
  'rows',coalesce((select jsonb_agg(public.marketing_reviewer_details(p.user_id) order by p.display_name,p.user_id)
   from public.user_profiles p where p.user_id in ('46a2400a-f04f-4b78-bd20-e3f75507b154'::uuid,'a4e1906d-b915-4e00-9b4e-657beeb396ae'::uuid)
   or exists(select 1 from public.marketing_reviewers r where r.user_id=p.user_id)),'[]'::jsonb),
  'total',(select count(*) from public.marketing_review_events where action='검수 권한 변경'), 'pageSize',20,
  'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
   select e.id,e.created_at,e.actor_name,e.reason,e.after_data->>'userId' as user_id,
    coalesce(e.after_data->>'name',p.display_name,'이름 미상') as name,
    coalesce(e.after_data->>'email',p.email,'') as email,
    e.after_data->>'enabled'='true' as enabled
   from public.marketing_review_events e left join public.user_profiles p on p.user_id::text=e.after_data->>'userId'
   where e.action='검수 권한 변경' order by e.created_at desc,e.id desc
   limit 20 offset (greatest(1,least(100000,coalesce(p_page,1)))-1)*20
  ) h),'[]'::jsonb));
end $$;

-- Serialize changes per account; the version also covers effective role and audit state.
create or replace function public.marketing_change_reviewer(p_user uuid,p_enabled boolean,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior jsonb; updated jsonb; ident jsonb;
begin
 if not public.has_page_access('marketing') or not exists(select 1 from public.user_profiles where user_id=auth.uid() and role='admin') then raise exception '관리자만 검수자를 지정·해제할 수 있습니다.' using errcode='42501'; end if;
 if p_enabled is null then raise exception '지정 여부가 필요합니다.' using errcode='22023'; end if;
 perform 1 from public.user_profiles where user_id=p_user for update;
 if not found then raise exception '등록된 사용자 계정이 필요합니다.' using errcode='22023'; end if;
 prior:=public.marketing_reviewer_details(p_user);
 if p_enabled and not (prior->>'pageAccess')::boolean then raise exception '마케팅 접근이 허용된 계정만 검수자로 지정할 수 있습니다.' using errcode='42501'; end if;
 if p_version is not null and p_version is distinct from prior->>'version' then raise exception '권한 정보가 변경되었습니다. 새로고침 후 다시 확인해 주세요.' using errcode='40001'; end if;
 if (prior->>'explicit')::boolean=p_enabled then return jsonb_build_object('changed',false,'row',prior); end if;
 if p_enabled then insert into public.marketing_reviewers(user_id) values(p_user); else delete from public.marketing_reviewers where user_id=p_user; end if;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,before_data,after_data,source,created_at)
 values(auth.uid(),ident->>'name','검수 권한 변경',concat(prior->>'name',' · ',case when p_enabled then '검수자 지정' else '검수자 지정 해제' end),
  prior,jsonb_build_object('userId',p_user,'name',prior->>'name','email',prior->>'email','enabled',p_enabled,
   'role',prior->>'role','canReview',(prior->>'pageAccess')::boolean and (prior->>'role'='admin' or p_enabled)),
  jsonb_build_object('type','marketing-reviewer'),clock_timestamp());
 updated:=public.marketing_reviewer_details(p_user);
 return jsonb_build_object('changed',true,'row',updated);
end $$;
revoke all on function public.marketing_change_reviewer(uuid,boolean,text) from public,anon,authenticated,service_role;

create or replace function public.marketing_update_reviewer(p_user uuid,p_enabled boolean,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_version is null or length(p_version)<>32 then raise exception '현재 권한 정보를 불러온 뒤 변경해 주세요.' using errcode='22023'; end if;
 return public.marketing_change_reviewer(p_user,p_enabled,p_version);
end $$;
-- Preserve the existing RPC contract, including permission and target restrictions.
create or replace function public.marketing_set_reviewer(p_user uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin perform public.marketing_change_reviewer(p_user,p_enabled,null); end $$;
revoke all on function public.marketing_reviewer_directory(integer),public.marketing_update_reviewer(uuid,boolean,text),public.marketing_set_reviewer(uuid,boolean) from public,anon;
grant execute on function public.marketing_reviewer_directory(integer),public.marketing_update_reviewer(uuid,boolean,text),public.marketing_set_reviewer(uuid,boolean) to authenticated;
commit;
