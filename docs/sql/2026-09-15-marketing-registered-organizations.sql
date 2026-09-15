-- Registered company selection for Contact intake and approval.
-- Apply after reviewer-delegation; preserves existing submissions, contacts and organizations.
begin;
alter table public.marketing_submissions add column if not exists submitted_organization_id uuid references public.marketing_organizations(id);
create index if not exists marketing_submission_org_idx on public.marketing_submissions(submitted_organization_id) where submitted_organization_id is not null;

create or replace function public.marketing_find_organizations(p_q text default '',p_page integer default 1,p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 if length(coalesce(p_q,''))>2000 or p_page is null or p_page not between 1 and 100000 then raise exception '검색 조건을 확인해 주세요.' using errcode='22023'; end if;
 with matched as materialized (
  select o.* from public.marketing_organizations o where
  (p_id is not null and o.id=p_id) or (p_id is null and btrim(coalesce(p_q,''))<>'' and
   exists(select 1 from unnest(array_prepend(o.name,o.aliases)) n where position(lower(btrim(p_q)) in lower(n))>0 or public.marketing_company_key(n)=public.marketing_company_key(p_q)))
 ), page as (select * from matched order by name,id limit 25 offset (p_page-1)*25)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by name,id) from page p),'[]'::jsonb),'total',(select count(*) from matched),'pageSize',25) into result;
 return result;
end $$;

create or replace function public.marketing_create_organization(p_id uuid,p_name text,p_category text,p_aliases text[],p_reason text,p_review_status text default 'pending',p_separate boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.marketing_organizations; ident jsonb; payload jsonb; aliases_clean text[]; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_id is null or length(btrim(coalesce(p_name,''))) not between 1 and 2000 or p_category is null or not public.marketing_category_valid(p_category) or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 or coalesce(array_length(p_aliases,1),0)>50 then raise exception '회사명·분류·등록 사유를 확인해 주세요.' using errcode='22023'; end if;
 if p_review_status is null or p_review_status not in ('pending','confirmed') or (p_review_status='confirmed' and p_category='확인 필요') then raise exception '분류 미확정 회사는 확인 완료로 처리할 수 없습니다.' using errcode='22023'; end if;
 if exists(select 1 from unnest(p_aliases) a where a is null or length(btrim(a)) not between 1 and 2000) then raise exception '별칭은 1~2,000자여야 합니다.' using errcode='22023'; end if;
 select coalesce(array_agg(distinct btrim(a) order by btrim(a)),'{}'::text[]) into aliases_clean from unnest(p_aliases) a;
 payload:=jsonb_build_object('id',p_id,'name',btrim(p_name),'category',p_category,'aliases',aliases_clean,'reason',btrim(p_reason),'reviewStatus',p_review_status,'separate',coalesce(p_separate,false));
 perform pg_advisory_xact_lock(20260914,1);
 select * into o from public.marketing_organizations where id=p_id;
 if found then
  if exists(select 1 from public.marketing_review_events where organization_id=p_id and actor=auth.uid() and action='회사·기관 등록' and after_data->'request'=payload) then return to_jsonb(o); end if;
  raise exception '등록 요청이 이미 사용되었습니다. 목록을 새로고침해 주세요.' using errcode='40001';
 end if;
 if not coalesce(p_separate,false) and exists(
  select 1 from public.marketing_organizations existing,unnest(array_prepend(existing.name,existing.aliases)) a,unnest(array_prepend(btrim(p_name),aliases_clean)) b
  where public.marketing_company_key(a)=public.marketing_company_key(b)
 ) then raise exception '같거나 유사한 회사명·별칭이 이미 등록되어 있습니다. 기존 회사를 선택하거나 별도 법인 여부와 근거를 확인해 주세요.' using errcode='23505'; end if;
 insert into public.marketing_organizations(id,name,category,aliases,review_status) values(p_id,btrim(p_name),p_category,aliases_clean,p_review_status) returning * into o;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,organization_id,after_data)
 values(auth.uid(),ident->>'name','회사·기관 등록',btrim(p_reason),o.id,jsonb_build_object('organization',to_jsonb(o),'request',payload));
 return to_jsonb(o);
end $$;
revoke all on function public.marketing_find_organizations(text,integer,uuid),public.marketing_create_organization(uuid,text,text,text[],text,text,boolean) from public,anon;
grant execute on function public.marketing_find_organizations(text,integer,uuid),public.marketing_create_organization(uuid,text,text,text[],text,text,boolean) to authenticated;

create or replace function public.marketing_submit(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; ident jsonb; result jsonb:='[]'; sid uuid; prior public.marketing_submissions; normalized jsonb; k text; selected_org public.marketing_organizations; selected_id uuid; selection_source jsonb;
begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 then raise exception '한 번에 1~200건을 제출할 수 있습니다.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 ident:=public.marketing_identity();
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r->'data')<>'object' or length((r->'data')::text)>40000 then raise exception '잘못된 입력입니다.' using errcode='22023'; end if;
  normalized:='{}';
  foreach k in array array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes'] loop
   if r->'data' ? k and (jsonb_typeof(r->'data'->k)<>'string' or length(r->'data'->>k)>2000) then raise exception 'Contact 필드는 2,000자 이하 문자열이어야 합니다.' using errcode='22023'; end if;
   normalized:=normalized||jsonb_build_object(k,btrim(coalesce(r->'data'->>k,'')));
  end loop;
  selected_id:=nullif(r->>'organizationId','')::uuid;
  selection_source:=coalesce(r->'source','{}')-'companySelection';
  if r->>'requireOrganization'='true' and selected_id is null then raise exception '등록된 회사·기관을 검색하여 선택해 주세요.' using errcode='22023'; end if;
  if selected_id is not null then
   select * into selected_org from public.marketing_organizations where id=selected_id;
   if not found then raise exception '선택한 회사·기관이 없습니다. 다시 검색해 주세요.' using errcode='22023'; end if;
   if selected_org.version is distinct from (r->>'organizationVersion')::integer then raise exception '회사 기준이 변경되었습니다. 다시 선택해 주세요.' using errcode='40001'; end if;
   if exists(select 1 from jsonb_array_elements_text(coalesce(r->'clearFields','[]')) f where f='company') then raise exception '회사·기관 선택은 삭제할 수 없습니다.' using errcode='22023'; end if;
   normalized:=jsonb_set(normalized,'{company}',to_jsonb(selected_org.name));
   selection_source:=selection_source||jsonb_build_object('companySelection',to_jsonb(selected_org));
  end if;
  insert into public.marketing_submissions(request_key,submitted_by,submitter,division,data,target_id,clear_fields,validation,source,status,submitted_organization_id)
   values((r->>'requestKey')::uuid,auth.uid(),ident->>'name',ident->>'division',normalized,nullif(r->>'targetId','')::uuid,
   array(select jsonb_array_elements_text(coalesce(r->'clearFields','[]'))),public.marketing_safe_validation(r->'validation'),selection_source,case when r->>'processing'='true' then 'validating' else 'pending' end,selected_id)
   on conflict(request_key) do nothing returning id into sid;
  if sid is null then
   select * into prior from public.marketing_submissions where request_key=(r->>'requestKey')::uuid;
   if prior.submitted_by<>auth.uid() or prior.data<>normalized or prior.submitted_organization_id is distinct from selected_id or prior.target_id is distinct from nullif(r->>'targetId','')::uuid or prior.clear_fields is distinct from array(select jsonb_array_elements_text(coalesce(r->'clearFields','[]'))) then raise exception '동일 요청 키가 다른 제출에 사용되었습니다.' using errcode='22023'; end if;
   sid:=prior.id;
  end if;
  result:=result||jsonb_build_array(sid);
 end loop;
 return result;
end $$;

create or replace function public.marketing_review_check(p_id uuid,p_final jsonb,p_target uuid,p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.marketing_submissions; c public.marketing_contacts; r record; conflicts jsonb:='[]'; blocking jsonb:='[]'; company text; token text; rule_check jsonb; violation jsonb; begin
 if not public.marketing_can_review() then raise exception '검수 권한이 필요합니다.' using errcode='42501'; end if;
 select * into s from public.marketing_submissions where id=p_id;
 if not found or s.status<>'pending' then raise exception '검수 상태가 변경되었습니다.' using errcode='40001'; end if;
 select * into c from public.marketing_contacts where id=p_target;
 select name into company from public.marketing_organizations where id=p_org;
 company:=coalesce(company,p_final->>'company','');
 if p_org is not null and nullif(btrim(s.data->>'company'),'') is not null and not exists(
 select 1 from public.marketing_organizations o where o.id=p_org and lower(btrim(s.data->>'company'))=any(array_prepend(lower(btrim(o.name)),array(select lower(btrim(a)) from unnest(o.aliases) a)))) then
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','company','message','제출 회사명이 선택한 표준명·승인 별칭과 다릅니다. 동일 법인 여부를 확인하세요.'));
 end if;
 if s.target_id is not null and s.target_id is distinct from p_target then conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','target','message','원래 지정한 DB ID와 최종 반영 대상이 다릅니다.')); end if;
 if c.id is not null and (lower(btrim(c.data->>'name')) is distinct from lower(btrim(p_final->>'name')) or c.organization_id is distinct from p_org) then
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','identity','message','대상 Contact의 성명 또는 회사가 변경됩니다. 동일 인물·법인 여부를 확인하세요.','version',c.version));
 end if;
 for r in select mc.id,mc.db_id,mc.version from public.marketing_contacts mc left join public.marketing_organizations o on o.id=mc.organization_id
 where mc.id is distinct from p_target and
 (nullif(lower(btrim(mc.data->>'email')),'')=nullif(lower(btrim(s.data->>'email')),'') or
 (nullif(lower(btrim(mc.data->>'name')),'')=nullif(lower(btrim(p_final->>'name')),'') and
 (mc.organization_id=p_org or public.marketing_company_matches(coalesce(o.name,mc.data->>'company'),company)))) order by mc.id loop
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','contact:'||r.id,'message',r.db_id||' · 이메일 또는 회사·성명이 겹치는 기존 Contact','version',r.version));
 end loop;
 for r in select x.id,x.version from public.marketing_submissions x left join public.marketing_contacts t on t.id=x.target_id left join public.marketing_organizations o on o.id=t.organization_id
 where x.status in ('pending','validating') and x.id<>p_id and
 (nullif(lower(btrim(coalesce(nullif(x.data->>'email',''),t.data->>'email'))),'')=nullif(lower(btrim(p_final->>'email')),'') or
 (nullif(lower(btrim(coalesce(nullif(x.data->>'name',''),t.data->>'name'))),'')=nullif(lower(btrim(p_final->>'name')),'') and
 public.marketing_company_matches(coalesce(nullif(x.data->>'company',''),o.name,t.data->>'company'),company))) order by x.id loop
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','submission:'||r.id,'message','다른 검수 대기 제출과 이메일 또는 회사·성명이 겹칩니다.','version',r.version));
 end loop;
 if exists(select 1 from public.marketing_contacts where id is distinct from p_target and nullif(lower(btrim(data->>'email')),'')=nullif(lower(btrim(p_final->>'email')),'')) then
  blocking:=jsonb_build_array('최종 이메일을 다른 Contact가 사용하고 있습니다. 대상을 다시 선택하거나 이메일을 수정하세요.');
 end if;
 if p_org is null or not exists(select 1 from public.marketing_organizations where id=p_org) then
  blocking:=blocking||jsonb_build_array('회사·기관에 먼저 등록한 뒤 검색 결과에서 선택해 주세요.');
 end if;
 if s.submitted_organization_id is not null and s.submitted_organization_id is distinct from p_org then
  conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','submitted-company','message','제출자가 선택한 회사·기관과 승인 대상이 다릅니다. 동일 법인 여부와 변경 근거를 확인하세요.'));
 end if;
 rule_check:=public.marketing_validate_rules_context(p_final||jsonb_build_object('company',company,'category',coalesce((select category from public.marketing_organizations where id=p_org),p_final->>'category','확인 필요'),'organization_status',coalesce((select review_status from public.marketing_organizations where id=p_org),'pending'))||case when c.id is not null then jsonb_build_object('db_id',c.db_id) else '{}'::jsonb end,
 jsonb_build_object('mode','master','hasOrganization',btrim(company)<>'','hasProvenance',true,'companyLinked',not exists(select 1 from jsonb_array_elements(conflicts) x where x->>'key'='company'),'duplicates',coalesce((select jsonb_agg(x) from jsonb_array_elements(conflicts) x where x->>'key' like 'contact:%'),'[]'::jsonb)));

 for violation in select value from jsonb_array_elements(rule_check->'violations') loop
  if violation->>'severity'='error' then blocking:=blocking||jsonb_build_array(violation->>'message');
  else conflicts:=conflicts||jsonb_build_array(jsonb_build_object('key','rule:'||(violation->>'id'),'message',violation->>'message','version',(violation->>'version')::integer)); end if;
 end loop;
 token:=md5(jsonb_build_object('id',p_id,'version',s.version,'final',p_final,'target',p_target,'org',p_org,'conflicts',conflicts,'rulesVersion',rule_check->>'version')::text);
 return jsonb_build_object('conflicts',conflicts,'blockingErrors',blocking,'ruleCheck',rule_check,'token',token,'checkedAt',clock_timestamp());
end $$;

create or replace function public.marketing_review(p_id uuid,p_version integer,p_action text,p_final jsonb,p_target uuid,p_target_version integer,p_org uuid,p_org_version integer,p_category text,p_reason text,p_resolution jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.marketing_submissions; c public.marketing_contacts; o public.marketing_organizations; ident jsonb;
 cid uuid; oid uuid; before_value jsonb; final_value jsonb; k text; duplicate_count integer; check_result jsonb;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_action is null or p_action not in ('approve','reject','unchanged') or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '검수 사유를 입력해 주세요.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into s from public.marketing_submissions where id=p_id for update;
 if not found then raise exception '제출을 찾을 수 없습니다.' using errcode='P0002'; end if;
 if (s.status='approved' and p_action='approve') or (s.status='unchanged' and p_action='unchanged') then return s.result_contact_id; end if;
 if s.status<>'pending' or s.version is distinct from p_version then raise exception '검수 상태가 변경되었습니다. 새로고침해 주세요.' using errcode='40001'; end if;
 ident:=public.marketing_identity();
 if p_action='reject' then
  update public.marketing_submissions set status='rejected',version=version+1 where id=p_id;
  insert into public.marketing_review_events(submission_id,actor,actor_name,action,reason,before_data,after_data) values(p_id,auth.uid(),ident->>'name','반려',p_reason,to_jsonb(s),null);
  return null;
 end if;
 if jsonb_typeof(p_final) is distinct from 'object' then raise exception '최종 반영값이 필요합니다.' using errcode='22023'; end if;
 final_value:='{}';
 foreach k in array array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes'] loop
  if p_final ? k and jsonb_typeof(p_final->k)<>'string' then raise exception '문자 필드가 필요합니다.' using errcode='22023'; end if;
  if length(coalesce(p_final->>k,''))>2000 then raise exception '입력값이 너무 깁니다.' using errcode='22023'; end if;
  final_value:=final_value||jsonb_build_object(k,btrim(coalesce(p_final->>k,'')));
 end loop;
 if p_target is not null then
  select * into c from public.marketing_contacts where id=p_target for update;
  if not found or c.version is distinct from p_target_version then raise exception '기존 정보가 변경되었습니다. 재검증해 주세요.' using errcode='40001'; end if;
  before_value:=to_jsonb(c); cid:=c.id;
 end if;
 if exists(select 1 from public.marketing_contacts where nullif(lower(btrim(data->>'email')),'')=nullif(lower(btrim(final_value->>'email')),'') and id is distinct from p_target) then raise exception '다른 Contact에서 사용 중인 이메일입니다. 대상을 다시 선택해 주세요.' using errcode='23505'; end if;
 check_result:=public.marketing_review_check(p_id,final_value||jsonb_build_object('category',p_category),p_target,p_org);
 if jsonb_array_length(check_result->'blockingErrors')>0 then raise exception '%', (check_result->'blockingErrors')::text using errcode='22023'; end if;
 if p_resolution->>'token' is distinct from check_result->>'token' or (jsonb_array_length(check_result->'conflicts')>0 and length(btrim(coalesce(p_resolution->>'reason','')))<2) then
  raise exception '미해결 충돌이 있거나 검증 기준이 바뀌었습니다. 최종값 재검증 후 해결 근거를 확인해 주세요.' using errcode='40001';
 end if;
 if p_action='unchanged' then
  if p_target is null or c.organization_id is distinct from p_org or exists(
   select 1 from jsonb_each_text(final_value) f where f.value is distinct from
   case when f.key='company' then coalesce((select name from public.marketing_organizations where id=c.organization_id),c.data->>'company','') else coalesce(c.data->>f.key,'') end
  ) then raise exception '변경 없음 종결은 기존 대상과 모든 최종값이 같아야 합니다.' using errcode='22023'; end if;
  update public.marketing_submissions set status='unchanged',version=version+1,result_contact_id=cid where id=p_id;
  insert into public.marketing_review_events(submission_id,actor,actor_name,action,reason,before_data,after_data)
   values(p_id,auth.uid(),ident->>'name','변경 없음',p_reason,to_jsonb(c),jsonb_build_object('contact',to_jsonb(c),'reviewCheck',check_result,'resolution',p_resolution));
  return cid;
 end if;
 if p_org is not null then
  select * into o from public.marketing_organizations where id=p_org for update;
  if not found or o.version is distinct from p_org_version then raise exception '회사 기준이 변경되었습니다. 재검증해 주세요.' using errcode='40001'; end if;
  oid:=o.id; final_value:=jsonb_set(final_value,'{company}',to_jsonb(o.name));
 else
  raise exception '회사·기관에 먼저 등록한 뒤 선택해 주세요.' using errcode='22023';
 end if;
 if p_target is null then
  cid:=gen_random_uuid();
  insert into public.marketing_contacts(id,db_id,organization_id,data) values(cid,'M-'||cid::text,oid,final_value);
 else
  update public.marketing_contacts set organization_id=oid,data=final_value,version=version+1,updated_at=now() where id=cid;
 end if;
 update public.marketing_submissions set status='approved',version=version+1,result_contact_id=cid where id=p_id;
 insert into public.marketing_review_events(submission_id,actor,actor_name,action,reason,before_data,after_data)
 values(p_id,auth.uid(),ident->>'name',case when p_target is null then '신규 등록' else '기존 정보 업데이트' end,p_reason,before_value,
 jsonb_build_object('contact',(select to_jsonb(mc) from public.marketing_contacts mc where id=cid),'organization',(select to_jsonb(mo) from public.marketing_organizations mo where id=oid),'submissionSource',s.source,'reviewCheck',check_result,'resolution',p_resolution));
 return cid;
end $$;


commit;
