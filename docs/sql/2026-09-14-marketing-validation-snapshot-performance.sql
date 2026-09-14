-- After rule-management-v2. Group company/result scans; bind values for a per-run plan.
-- Pass messages are standardized at read time; immutable stored outcomes/history are preserved.
begin;
create or replace function public.marketing_evaluate_rule(p_rule jsonb,p_data jsonb,p_context jsonb default '{}') returns jsonb language plpgsql immutable set search_path='' as $$
declare cfg jsonb:=p_rule->'config'; op text:=cfg->>'operator'; val text:=btrim(coalesce(p_data->>(cfg->>'field'),'')); outcome text:='pass'; msg text:='기준 충족'; failed boolean:=false; applicable boolean:=true; related jsonb:='[]'; begin
 if not public.marketing_rule_config_valid(cfg) then raise exception '지원하지 않는 검증기/설정'; end if;
 if cfg ? 'whenField' then
  if cfg ? 'whenValue' then applicable:=lower(btrim(coalesce(p_data->>(cfg->>'whenField'),'')))=lower(btrim(cfg->>'whenValue'));
  else applicable:=btrim(coalesce(p_data->>(cfg->>'whenField'),''))<>''; end if;
 end if;
 if cfg ? 'whenAnyFields' then applicable:=applicable and exists(select 1 from jsonb_array_elements_text(cfg->'whenAnyFields') f where btrim(coalesce(p_data->>f,''))<>''); end if;
 if not applicable then outcome:='not_applicable'; msg:='적용 조건에 해당하지 않음';
 elsif op='builtin' then outcome:='not_applicable'; msg:='운영 원칙 · 자동 실행 대상 아님';
 elsif cfg->>'field' in ('category','db_id') and not p_data ? (cfg->>'field') then outcome:='not_applicable'; msg:='이 입력에는 해당 Master 기준값이 없음';
 elsif op='review' then outcome:='review'; msg:=p_rule->>'description';
 elsif op in ('duplicates','company_standard','classification','organization','provenance') then
  if p_context->>'mode' is distinct from 'master' then outcome:='not_applicable'; msg:='Master 비교 컨텍스트 필요 · 접수/승인의 별도 비교 단계에서 확인';
  elsif op='duplicates' then
   related:=coalesce(p_context->'duplicates','[]');
   if related<>'[]'::jsonb then outcome:='review'; msg:='전체 Master에서 중복 후보 발견 · 동일 인물 확인 필요';
   elsif btrim(coalesce(p_data->>'email',''))='' and (btrim(coalesce(p_data->>'name',''))='' or btrim(coalesce(p_data->>'company',''))='') then outcome:='not_applicable'; msg:='중복 비교에 필요한 이메일 또는 회사·성명 부족'; end if;
  elsif op='company_standard' then
   related:=coalesce(p_context->'companies','[]');
   if not coalesce((p_context->>'companyLinked')::boolean,false) or coalesce((p_context->>'companyAmbiguous')::boolean,false) then outcome:='review'; msg:='표준 회사 연결 또는 동일 법인 여부 확인 필요'; end if;
  elsif op='classification' then
   related:=coalesce(p_context->'companies','[]');
   if coalesce(p_data->>'category','확인 필요')='확인 필요' or p_data->>'organization_status' is distinct from 'confirmed' or coalesce((p_context->>'categoryConflict')::boolean,false) then outcome:='review'; msg:='회사 단위 분류 또는 상이한 분류 후보 확인 필요'; end if;
  elsif op='organization' then failed:=not coalesce((p_context->>'hasOrganization')::boolean,false); msg:=case when failed then '회사·기관 기준 연결 누락' else '기준 충족' end;
  elsif op='provenance' then failed:=not coalesce((p_context->>'hasProvenance')::boolean,false); msg:=case when failed then '최초 이관 또는 제출·승인 출처 연결 누락' else '기준 충족' end; end if;
 elsif op='required' then failed:=val='';
 elsif op='email' then failed:=val<>'' and val!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
 elsif op='date' and val<>'' then
  begin failed:=val!~'^\d{4}-\d{2}-\d{2}$' or to_char(val::date,'YYYY-MM-DD')<>val; exception when invalid_datetime_format or datetime_field_overflow then failed:=true; end;
 elsif op='one_of' then failed:=not exists(select 1 from jsonb_array_elements_text(cfg->'values') x where lower(btrim(x))=lower(val));
 elsif op='forbidden_values' then failed:=exists(select 1 from jsonb_array_elements_text(cfg->'values') x where lower(btrim(x))=lower(val));
 elsif op='max_length' then failed:=length(val)>(cfg->>'max')::integer;
 end if;
 if failed then outcome:='fail'; if op not in ('organization','provenance') then msg:=coalesce(nullif(p_rule->>'description',''),p_rule->>'title'); end if; end if;
 return jsonb_build_object('outcome',outcome,'severity',case when outcome='review' then 'warning' else p_rule->>'severity' end,'message',msg,'field',cfg->>'field','actual',val,'related',related,'manual',outcome='review');
exception when others then
 return jsonb_build_object('outcome','error','severity','error','message','검증 실행 오류 · '||sqlstate,'field',cfg->>'field','actual',val,'related','[]'::jsonb,'manual',false);
end $$;

create or replace function public.marketing_create_validation(p_request_key uuid,p_scope text,p_filters jsonb,p_ids uuid[],p_rules jsonb,p_trial uuid default null,p_trial_revision integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare run uuid:=gen_random_uuid(); chosen jsonb; n integer; prior public.marketing_validation_runs; draft public.marketing_rule_drafts; request jsonb; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_request_key is null or p_scope is null or p_scope not in ('all','filtered','selected') or jsonb_typeof(p_filters) is distinct from 'object' or jsonb_typeof(p_rules) is distinct from 'array' then raise exception '검증 범위를 확인해 주세요.' using errcode='22023'; end if;
 if p_scope='selected' and coalesce(cardinality(p_ids),0)=0 then raise exception 'Contact를 하나 이상 선택해 주세요.' using errcode='22023'; end if;
 request:=jsonb_build_object('scope',p_scope,'filters',p_filters,'ids',p_ids,'rules',p_rules,'trial',p_trial,'trialRevision',p_trial_revision);
 perform pg_advisory_xact_lock(20260914,1);
 select * into prior from public.marketing_validation_runs where request_key=p_request_key;
 if found then
  if prior.actor<>auth.uid() or prior.request<>request then raise exception '같은 요청 키에 다른 실행 설정입니다.' using errcode='22023'; end if;
  return prior.id;
 end if;
 if p_trial is not null then
  select * into draft from public.marketing_rule_drafts where id=p_trial;
  if not found or draft.revision is distinct from p_trial_revision or draft.published_version is not null then raise exception '시험 수정본이 변경되었습니다.' using errcode='40001'; end if;
  chosen:=jsonb_build_array(draft.definition||jsonb_build_object('id',coalesce(draft.rule_id,draft.id),'code','DRAFT','version',draft.revision,'draftId',draft.id));
 else
  if jsonb_array_length(p_rules) not between 1 and 100 then raise exception '규칙을 1~100개 선택해 주세요.' using errcode='22023'; end if;
  select jsonb_agg(to_jsonb(r) order by r.code) into chosen from public.marketing_rules r
  join jsonb_to_recordset(p_rules) as x(id uuid,version integer) on x.id=r.id and x.version=r.version where r.enabled;
  if coalesce(jsonb_array_length(chosen),0)<>jsonb_array_length(p_rules) or (select count(distinct x->>'id') from jsonb_array_elements(p_rules) x)<>jsonb_array_length(p_rules) then raise exception '선택 규칙이 변경되거나 비활성화되었습니다. 목록을 갱신해 주세요.' using errcode='40001'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(chosen) r where not public.marketing_rule_config_valid(r->'config') or r->'config'->>'operator'='builtin') then raise exception '운영 원칙은 자동 실행할 수 없습니다. 실행할 규칙을 선택해 주세요.' using errcode='22023'; end if;

 -- All source reads and copies below use ONE MVCC statement snapshot.
 with orgs as materialized (select o.*, array_prepend(public.marketing_company_key(o.name),array(select public.marketing_company_key(a) from unnest(o.aliases) a)) as keys from public.marketing_organizations o),
 org_keys as materialized (select distinct o.id,k.key from orgs o cross join lateral unnest(o.keys) k(key) where k.key<>''),
 org_pairs as materialized (select distinct a.id,b.id as other_id from org_keys a join org_keys b on b.key=a.key and b.id<>a.id),
 org_relations as materialized (select p.id,jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'category',x.category,'version',x.version) order by x.id) as companies,bool_or(x.category<>o.category) as category_conflict from org_pairs p join orgs x on x.id=p.other_id join orgs o on o.id=p.id group by p.id),
 org_counts as materialized (select organization_id,count(*) as contacts from public.marketing_contacts group by organization_id),
 org_context as materialized (select o.id,to_jsonb(o)-'keys' as snapshot,
  jsonb_build_object('hasOrganization',true,'companyAmbiguous',r.id is not null,'categoryConflict',coalesce(r.category_conflict,false),'companies',coalesce(r.companies,'[]'::jsonb),'companyContacts',coalesce(c.contacts,0)) as context
  from orgs o left join org_relations r on r.id=o.id left join org_counts c on c.organization_id=o.id),
 contacts as materialized (select c.*,to_jsonb(o)-'keys' as organization,coalesce(o.keys,array[public.marketing_company_key(c.data->>'company')]) as keys from public.marketing_contacts c left join orgs o on o.id=c.organization_id),
 selected as materialized (select c.*,row_number() over(order by
  case when p_filters->>'direction'='desc' then nullif(lower(btrim(case when p_filters->>'sort'='category' then coalesce(c.organization->>'category','확인 필요') when p_filters->>'sort'='company' then coalesce(c.organization->>'name',c.data->>'company') when p_filters->>'sort'='db_id' then c.db_id else c.data->>coalesce(p_filters->>'sort','db_id') end)),'') end desc nulls last,
  case when p_filters->>'direction' is distinct from 'desc' then nullif(lower(btrim(case when p_filters->>'sort'='category' then coalesce(c.organization->>'category','확인 필요') when p_filters->>'sort'='company' then coalesce(c.organization->>'name',c.data->>'company') when coalesce(p_filters->>'sort','db_id')='db_id' then c.db_id else c.data->>(p_filters->>'sort') end)),'') end asc nulls last,c.db_id,c.id) as ordinal from contacts c
  where p_scope='all' or (p_scope='selected' and c.id=any(p_ids)) or (p_scope='filtered'
   and (coalesce(p_filters->>'q','')='' or position(lower(p_filters->>'q') in lower(concat_ws(' ',c.db_id,c.data->>'name',c.data->>'email',c.data->>'company',c.organization->>'name')))>0)
   and (coalesce(p_filters->>'department','')='' or position(lower(p_filters->>'department') in lower(coalesce(c.data->>'ownerDepartment','')))>0)
   and (coalesce(p_filters->>'category','')='' or c.organization->>'category'=p_filters->>'category')
   and (coalesce(p_filters->>'issues','false')<>'true' or c.organization_id is null or c.organization->>'category'='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))=''))),
 new_run as (insert into public.marketing_validation_runs(id,request_key,request,actor,actor_name,scope,filters,rules,trial,total)
  select run,p_request_key,request,auth.uid(),public.marketing_identity()->>'name',p_scope,p_filters,chosen,p_trial is not null,(select count(*) from selected) returning id),
 copy_orgs as (insert into public.marketing_validation_organizations select run,o.id,o.snapshot,o.context from org_context o cross join new_run returning organization_id),
 copy_reference as (insert into public.marketing_validation_reference select run,c.id,c.version,c.db_id,nullif(lower(btrim(c.data->>'email')),''),nullif(lower(btrim(c.data->>'name')),''),c.keys,c.organization_id from contacts c cross join new_run returning contact_id),
 copy_targets as (insert into public.marketing_validation_targets(run_id,contact_id,ordinal,snapshot,context)
  select run,c.id,c.ordinal,jsonb_build_object('id',c.id,'db_id',c.db_id,'version',c.version,'organization_id',c.organization_id,'organization',c.organization,'data',c.data),
   coalesce(oc.context,'{}')||jsonb_build_object('mode','master','hasProvenance',exists(select 1 from public.marketing_source_rows s where s.contact_id=c.id) or exists(select 1 from public.marketing_submissions s where s.result_contact_id=c.id and s.status in ('approved','unchanged')),
    'companyLinked',c.organization_id is not null and lower(btrim(coalesce(c.data->>'company','')))=any(array_prepend(lower(btrim(c.organization->>'name')),array(select lower(btrim(a)) from jsonb_array_elements_text(coalesce(c.organization->'aliases','[]')) a))))
  from selected c left join org_context oc on oc.id=c.organization_id cross join new_run returning contact_id)
 select count(*) into n from copy_targets;
 if n=0 then raise exception '검증 대상이 없습니다.' using errcode='22023'; end if;
 if p_scope='selected' and n<>(select count(distinct x) from unnest(p_ids) x) then raise exception '선택한 Contact가 변경되거나 삭제되었습니다.' using errcode='40001'; end if;
 return run;
end $$;

create or replace function public.marketing_validation_report(p_id uuid,p_page integer default 1,p_rule integer default 0,p_outcome text default '',p_q text default '',p_followup text default '',p_limit integer default 25,p_severity text default '')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; begin
 -- A parameter-specific plan avoids the generic SQL-function plan for differently sized runs.
 -- The query is fixed text; all caller inputs are bound with USING.
 execute $report$
with job as materialized (select * from public.marketing_validation_runs where id=$1),
 latest as materialized (select distinct on (r.contact_id,r.rule_index) r.* from public.marketing_validation_results r join job on job.id=r.run_id order by r.contact_id,r.rule_index,r.attempt desc),
 targets as materialized (select t.*, (c.id is null or c.version<>(t.snapshot->>'version')::integer or coalesce(o.version,0)<>coalesce((t.snapshot->'organization'->>'version')::integer,0)) as stale,
  f.status as followup_status, f.reason as followup_reason, f.submission_id, s.status as submission_status,
  (f.id is not null and (c.version<>f.current_version or coalesce(o.version,0)<>coalesce(f.organization_version,0) or (select public.marketing_validation_basis_changed($1)) or exists(select 1 from job,jsonb_array_elements(job.rules) r join public.marketing_rules live on live.id=(r->>'id')::uuid where r->>'code'<>'DRAFT' and live.version<>(r->>'version')::integer))) as followup_stale,
  c.version as current_version, o.version as current_organization_version
  from public.marketing_validation_targets t join job on job.id=t.run_id left join public.marketing_contacts c on c.id=t.contact_id left join public.marketing_organizations o on o.id=c.organization_id
  left join lateral (select * from public.marketing_validation_followups f where f.run_id=t.run_id and f.contact_id=t.contact_id order by f.created_at desc,f.id desc limit 1) f on true
  left join public.marketing_submissions s on s.id=f.submission_id),
 filtered as materialized (select t.* from targets t where
  (coalesce($5,'')='' or position(lower($5) in lower(concat_ws(' ',t.snapshot->>'db_id',t.snapshot->'data'->>'name',t.snapshot->'organization'->>'name',t.snapshot->'data'->>'company')))>0)
  and (coalesce($6,'')='' or ($6='open' and (t.followup_status is null or t.followup_stale)) or (t.followup_status=$6 and not t.followup_stale))
  and (($3=0 and coalesce($4,'')='' and coalesce($8,'')='') or exists(select 1 from latest r where r.contact_id=t.contact_id and ($3=0 or r.rule_index=$3) and (coalesce($4,'')='' or r.outcome=$4) and (coalesce($8,'')='' or r.severity=$8)))),
 page_targets as materialized (select * from filtered order by ordinal offset (greatest(1,$2)-1)*greatest(1,least($7,500)) limit greatest(1,least($7,500))),
 page_results as materialized (select r.contact_id,jsonb_agg(to_jsonb(r)||case when r.outcome='pass' then jsonb_build_object('detail',r.detail||jsonb_build_object('message','기준 충족')) else '{}'::jsonb end order by r.rule_index) as results from latest r join page_targets t on t.contact_id=r.contact_id where ($3=0 or r.rule_index=$3) and (coalesce($4,'')='' or r.outcome=$4) and (coalesce($8,'')='' or r.severity=$8) group by r.contact_id)
 select jsonb_build_object('run',(select to_jsonb(job)-'request' from job),'total',(select count(*) from filtered),
 'comparisonChanged',(select public.marketing_validation_basis_changed($1)),
 'rulesChanged',exists(select 1 from job,jsonb_array_elements(job.rules) r left join public.marketing_rules live on live.id=(r->>'id')::uuid where r->>'code'<>'DRAFT' and (live.id is null or live.version<>(r->>'version')::integer)),
 'exportToken',md5(coalesce((select jsonb_agg(jsonb_build_array(t.contact_id,t.current_version,t.current_organization_version,t.followup_status,t.followup_reason,t.submission_status,t.followup_stale) order by ordinal)::text from targets t),'[]')||coalesce((select to_jsonb(job)::text from job),'')||coalesce((select jsonb_agg(jsonb_build_array(id,version) order by id)::text from public.marketing_rules),'')||'report-v2.3'),
 'selectedIds',case when (select scope from job)='selected' then coalesce((select jsonb_agg(contact_id order by ordinal) from targets),'[]') else '[]'::jsonb end,
 'counts',coalesce((select jsonb_object_agg(outcome,n) from (select coalesce(outcome,'pending') as outcome,count(*) as n from targets group by 1) x),'{}'),
 'ruleCounts',coalesce((select jsonb_agg(to_jsonb(x) order by rule_index,outcome) from (select r.rule_index,r.outcome,r.severity,count(*) as count,
  count(distinct t.snapshot->>'organization_id') as companies from latest r join targets t on t.contact_id=r.contact_id group by r.rule_index,r.outcome,r.severity) x),'[]'),
 'rows',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('results',coalesce(pr.results,'[]'),'followups',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from public.marketing_validation_followups f where f.run_id=t.run_id and f.contact_id=t.contact_id),'[]')) order by t.ordinal)
  from page_targets t left join page_results pr on pr.contact_id=t.contact_id),'[]'));
$report$ into result using p_id,p_page,p_rule,p_outcome,p_q,p_followup,p_limit,p_severity;
 return result;
end $$;


notify pgrst,'reload schema';
commit;
