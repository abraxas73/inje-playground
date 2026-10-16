-- 마케팅 Master DB v2.0 양식(INNOGRID Master DB_v2.0_20261006, 커뮤니케이션실) 반영 + 삭제 후보
-- 1) 필드 목록: 원본출처(source)·Eco ID(ecoId)·최종확인일(confirmedAt) 제거,
--    DM 발송 관리 6개 추가 — dmTarget(DM 발송 대상)·unsubscribed(수신거부)·hardBounce(Hard Bounce)·
--    softBounce3m(3개월 연속 Soft Bounce)·unopened3m(3개월 연속 미오픈)·dmCheckedAt(발송 상태 확인일, YYYY-MM-DD)
--    아래 함수 4개는 2026-10-16 운영 정의(pg_get_functiondef)에서 필드 목록만 바꾼 것이다.
-- 2) 삭제 후보: 최신 Master 파일에 없는 Contact를 delete_candidate로 표시(정비 필요 필터에 포함),
--    검수자가 marketing_resolve_delete_candidate로 후보 해제(keep) 또는 삭제(delete)한다.
--    이메일 정합성 검사 이력이 있는 Contact는 검사 기록 보존을 위해 삭제하지 않는다.
begin;
alter table public.marketing_contacts add column if not exists delete_candidate jsonb
  check (delete_candidate is null or jsonb_typeof(delete_candidate)='object');

CREATE OR REPLACE FUNCTION public.marketing_submit(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; ident jsonb; result jsonb:='[]'; sid uuid; prior public.marketing_submissions; normalized jsonb; k text; selected_org public.marketing_organizations; selected_id uuid; selection_source jsonb;
begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 then raise exception '한 번에 1~200건을 제출할 수 있습니다.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 ident:=public.marketing_identity();
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r->'data')<>'object' or length((r->'data')::text)>40000 then raise exception '잘못된 입력입니다.' using errcode='22023'; end if;
  normalized:='{}';
  foreach k in array array['company','name','department','position','email','phone','eco','ecoType','ecoMiddle','ecoSmall','dmTarget','unsubscribed','hardBounce','softBounce3m','unopened3m','dmCheckedAt','notes','ownerDepartment','sourceSheet'] loop
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
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_review(p_id uuid, p_version integer, p_action text, p_final jsonb, p_target uuid, p_target_version integer, p_org uuid, p_org_version integer, p_category text, p_reason text, p_resolution jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 foreach k in array array['company','name','department','position','email','phone','eco','ecoType','ecoMiddle','ecoSmall','dmTarget','unsubscribed','hardBounce','softBounce3m','unopened3m','dmCheckedAt','notes','ownerDepartment','sourceSheet'] loop
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
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_rule_config_valid(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare fields text[]:=array['category','db_id','company','name','department','position','email','phone','eco','ecoType','ecoMiddle','ecoSmall','dmTarget','unsubscribed','hardBounce','softBounce3m','unopened3m','dmCheckedAt','notes','ownerDepartment','sourceSheet']; op text:=p->>'operator'; k text; v jsonb; begin
 if jsonb_typeof(p) is distinct from 'object' or length(p::text)>10000 or op is null or op not in ('required','email','date','one_of','forbidden_values','max_length','review','builtin','duplicates','company_standard','classification','organization','provenance') then return false; end if;
 if op in ('required','email','date','one_of','forbidden_values','max_length') and not coalesce(p->>'field'=any(fields),false) then return false; end if;
 if p ? 'whenField' and not coalesce(p->>'whenField'=any(fields),false) then return false; end if;
 if p ? 'whenValue' and (not p ? 'whenField' or jsonb_typeof(p->'whenValue') is distinct from 'string') then return false; end if;
 if p ? 'whenAnyFields' then
  if jsonb_typeof(p->'whenAnyFields') is distinct from 'array' or jsonb_array_length(p->'whenAnyFields')<1 then return false; end if;
  for v in select value from jsonb_array_elements(p->'whenAnyFields') loop if jsonb_typeof(v)<>'string' or not (v#>>'{}')=any(fields) then return false; end if; end loop;
 end if;
 if op in ('one_of','forbidden_values') then
  if jsonb_typeof(p->'values') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p->'values') not between 1 and 100 then return false; end if;
  for v in select value from jsonb_array_elements(p->'values') loop if jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200 then return false; end if; end loop;
 end if;
 if op='max_length' and (jsonb_typeof(p->'max') is distinct from 'number' or not (p->>'max')~'^[0-9]{1,4}$') then return false; end if;
 if op='max_length' and (p->>'max')::integer not between 1 and 2000 then return false; end if;
 for k in select jsonb_object_keys(p) loop if k not in ('operator','field','values','max','whenField','whenValue','whenAnyFields') then return false; end if; end loop;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_search_contacts(p_q text, p_category text, p_issues boolean, p_offset integer, p_department text DEFAULT ''::text, p_limit integer DEFAULT 25, p_sort text DEFAULT 'db_id'::text, p_direction text DEFAULT 'asc'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with matched as (select c.*,to_jsonb(o) as organization, (c.delete_candidate is not null or c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))='') as needs_maintenance,
 nullif(lower(btrim(case
  when p_sort='category' then coalesce(o.category,'확인 필요')
  when p_sort='company' then coalesce(o.name,c.data->>'company')
  when p_sort in ('name','department','position','email','phone','eco','ecoType','ecoMiddle','ecoSmall','dmTarget','unsubscribed','hardBounce','softBounce3m','unopened3m','dmCheckedAt','notes','ownerDepartment','sourceSheet') then c.data->>p_sort
  else c.db_id end)),'') as sort_value
 from public.marketing_contacts c left join public.marketing_organizations o on o.id=c.organization_id
 where (coalesce(p_q,'')='' or position(lower(p_q) in lower(concat_ws(' ',c.db_id,c.data->>'name',c.data->>'email',c.data->>'company',o.name)))>0)
 and (coalesce(p_department,'')='' or position(lower(p_department) in lower(coalesce(c.data->>'ownerDepartment','')))>0)
 and (coalesce(p_category,'')='' or o.category=p_category)
 and (not coalesce(p_issues,false) or c.delete_candidate is not null or c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))=''))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(t)-'sort_value') from (
  select * from matched order by
   case when p_direction='desc' then sort_value end desc nulls last,
   case when p_direction is distinct from 'desc' then sort_value end asc nulls last,
   db_id asc,id asc
  offset greatest(0,p_offset) limit case when p_limit is null then null else greatest(1,least(1000,p_limit)) end
 ) t),'[]'), 'total',(select count(*) from matched),'pageSize',p_limit);
$function$;

-- 규칙 2개를 v2.0 필드로 옮긴다(규칙 버전 이력 1건씩).
update public.marketing_rules set config='{"operator":"review","whenAnyFields":["eco","ecoType","ecoMiddle","ecoSmall"]}'::jsonb,
  version=version+1, updated_at=now() where code='EXCEL-11';
update public.marketing_rules set title='발송 상태 확인일 형식', config='{"operator":"date","field":"dmCheckedAt"}'::jsonb,
  description='날짜가 있으면 유효한 YYYY-MM-DD여야 합니다. 마지막으로 발송 상태를 확인한 날짜를 입력합니다.',
  source='Master DB v2.0 DM 발송 관리정보', version=version+1, updated_at=now() where code='EXCEL-14';
insert into public.marketing_rule_versions(rule_id,version,definition,reason,actor_name)
 select r.id,r.version,to_jsonb(r),'Master DB v2.0 양식 반영(Eco ID·최종확인일 컬럼 삭제, 발송 상태 확인일 추가)','Master DB v2.0 반영'
 from public.marketing_rules r where r.code in ('EXCEL-11','EXCEL-14')
 and not exists(select 1 from public.marketing_rule_versions v where v.rule_id=r.id and v.version=r.version);

create or replace function public.marketing_resolve_delete_candidate(p_id uuid, p_version integer, p_action text, p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare c public.marketing_contacts; ident jsonb;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_action is null or p_action not in ('keep','delete') or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '처리 사유를 입력해 주세요.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into c from public.marketing_contacts where id=p_id for update;
 if not found or c.version is distinct from p_version then raise exception 'Contact 정보가 변경되었습니다. 새로고침해 주세요.' using errcode='40001'; end if;
 if c.delete_candidate is null then raise exception '삭제 후보가 아닙니다.' using errcode='22023'; end if;
 ident:=public.marketing_identity();
 if p_action='keep' then
  update public.marketing_contacts set delete_candidate=null,version=version+1,updated_at=now() where id=p_id;
  insert into public.marketing_review_events(actor,actor_name,action,reason,before_data,after_data,contact_id,organization_id)
   values(auth.uid(),ident->>'name','삭제 후보 해제',p_reason,to_jsonb(c),jsonb_build_object('contact',(select to_jsonb(x) from public.marketing_contacts x where x.id=p_id)),p_id,c.organization_id);
  return;
 end if;
 if exists(select 1 from public.marketing_email_targets where contact_id=p_id) then
  raise exception '이메일 정합성 검사 이력이 있어 삭제할 수 없습니다. 후보로 남겨 두세요.' using errcode='22023';
 end if;
 update public.marketing_review_events set contact_id=null where contact_id=p_id;
 update public.marketing_submissions set target_id=null where target_id=p_id;
 update public.marketing_submissions set result_contact_id=null where result_contact_id=p_id;
 insert into public.marketing_review_events(actor,actor_name,action,reason,before_data,after_data,organization_id)
  values(auth.uid(),ident->>'name','삭제',p_reason,jsonb_build_object('contact',to_jsonb(c),
   'sources',(select coalesce(jsonb_agg(jsonb_build_object('sheet',s.sheet,'row',s.row_number,'raw',s.raw)),'[]') from public.marketing_source_rows s where s.contact_id=p_id)),
   jsonb_build_object('deletedContactId',p_id,'dbId',c.db_id),c.organization_id);
 delete from public.marketing_source_rows where contact_id=p_id;
 delete from public.marketing_contacts where id=p_id;
end $$;
revoke all on function public.marketing_resolve_delete_candidate(uuid,integer,text,text) from public, anon;
grant execute on function public.marketing_resolve_delete_candidate(uuid,integer,text,text) to authenticated;
commit;
