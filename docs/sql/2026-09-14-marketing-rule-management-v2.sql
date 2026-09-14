-- After marketing-sort. Business rule versions and durable Master validation.
-- No Master Contact is changed by this migration or by validation jobs.
begin;

create or replace function public.marketing_rule_config_valid(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare fields text[]:=array['category','db_id','company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes']; op text:=p->>'operator'; k text; v jsonb; begin
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
end $$;

create table public.marketing_rule_versions (
 rule_id uuid not null references public.marketing_rules(id), version integer not null,
 definition jsonb not null, reason text not null, actor uuid, actor_name text not null,
 created_at timestamptz not null default now(), primary key(rule_id,version)
);
insert into public.marketing_rule_versions(rule_id,version,definition,reason,actor,actor_name,created_at)
 select rule_id,version,after_data,reason,actor,actor_name,created_at from public.marketing_rule_history;
create table public.marketing_rule_drafts (
 id uuid primary key, rule_id uuid references public.marketing_rules(id), base_version integer,
 revision integer not null default 1, definition jsonb not null, reason text not null,
 actor uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 published_version integer, published_rule_id uuid references public.marketing_rules(id)
);
create index on public.marketing_rule_drafts(rule_id);

create or replace function public.marketing_rule_definition_check(p jsonb,p_code text default '') returns void language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or length(btrim(coalesce(p->>'title',''))) not between 1 and 120 or length(coalesce(p->>'description',''))>2000
 or jsonb_typeof(p->'enabled') is distinct from 'boolean' or not public.marketing_rule_config_valid(p->'config')
 or coalesce(p->>'severity','') not in ('error','warning') or (p->'config'->>'operator'='review' and p->>'severity'<>'warning') then
  raise exception '규칙 이름·조건·등급을 확인해 주세요.' using errcode='22023'; end if;
 -- Organization names are structurally required to establish a company relationship.
 if p_code='EXCEL-03' and (p->'config'<>'{"operator":"required","field":"company"}'::jsonb or p->>'severity'<>'error' or p->>'enabled'<>'true') then
  raise exception '회사명 필수는 회사 연결의 시스템 제약입니다. 규칙 이름·설명은 수정할 수 있습니다.' using errcode='22023'; end if;
end $$;

create or replace function public.marketing_save_rule(p_id uuid,p_version integer,p_title text,p_description text,p_config jsonb,p_severity text,p_enabled boolean,p_reason text)
returns public.marketing_rules language plpgsql security definer set search_path='' as $$
declare old public.marketing_rules; result public.marketing_rules; ident jsonb; begin
 if not public.marketing_can_review() then raise exception '검수 담당자만 규칙을 변경할 수 있습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 if length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '변경 사유를 입력해 주세요.' using errcode='22023'; end if;
 if p_id is not null then
  select * into old from public.marketing_rules where id=p_id for update;
  if not found or old.version is distinct from p_version then raise exception '규칙이 변경되었습니다. 최신 버전과 비교해 주세요.' using errcode='40001'; end if;
 end if;
 perform public.marketing_rule_definition_check(jsonb_build_object('title',p_title,'description',p_description,'config',p_config,'severity',p_severity,'enabled',p_enabled),coalesce(old.code,''));
 ident:=public.marketing_identity();
 if p_id is null then
  insert into public.marketing_rules(code,title,description,config,severity,enabled,updated_by) values('CUSTOM-'||gen_random_uuid(),btrim(p_title),coalesce(p_description,''),p_config,p_severity,p_enabled,auth.uid()) returning * into result;
 else
  update public.marketing_rules set title=btrim(p_title),description=coalesce(p_description,''),config=p_config,severity=p_severity,enabled=p_enabled,protected=false,version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id returning * into result;
 end if;
 insert into public.marketing_rule_history(rule_id,version,actor,actor_name,reason,before_data,after_data) values(result.id,result.version,auth.uid(),ident->>'name',p_reason,case when p_id is null then null else to_jsonb(old) end,to_jsonb(result));
 insert into public.marketing_rule_versions(rule_id,version,definition,reason,actor,actor_name) values(result.id,result.version,to_jsonb(result),p_reason,auth.uid(),ident->>'name');
 return result;
end $$;

-- The immutable original versions remain in history. This is an explicit migration version.
do $$ declare old public.marketing_rules; r public.marketing_rules; op text; begin
 for old in select * from public.marketing_rules where protected loop
  op:=case old.code when 'EXCEL-05' then 'duplicates' when 'EXCEL-07' then 'company_standard' when 'EXCEL-08' then 'classification' when 'EXCEL-09' then 'organization' when 'EXCEL-10' then 'provenance' else old.config->>'operator' end;
  update public.marketing_rules set protected=false,config=jsonb_set(config,'{operator}',to_jsonb(op)),version=version+1,updated_at=now() where id=old.id returning * into r;
  insert into public.marketing_rule_history(rule_id,version,actor_name,reason,before_data,after_data) values(r.id,r.version,'규칙 관리 개선','원본 업무 규칙 편집 및 실행 방식 명시',to_jsonb(old),to_jsonb(r));
  insert into public.marketing_rule_versions(rule_id,version,definition,reason,actor_name) values(r.id,r.version,to_jsonb(r),'원본 업무 규칙 편집 및 실행 방식 명시','규칙 관리 개선');
 end loop;
end $$;

create or replace function public.marketing_edit_rule(p_draft_id uuid,p_revision integer,p_rule_id uuid,p_base_version integer,p_definition jsonb,p_reason text,p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.marketing_rule_drafts; r public.marketing_rules; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into d from public.marketing_rule_drafts where id=p_draft_id for update;
 if found then
  if d.published_version is not null and p_publish and d.definition=p_definition and d.reason=p_reason then return jsonb_build_object('draft',to_jsonb(d),'published',true); end if;
  if d.published_version is not null or d.revision is distinct from p_revision or d.rule_id is distinct from p_rule_id or d.base_version is distinct from p_base_version then raise exception '수정본이 변경되었습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 elsif p_revision<>0 or p_draft_id is null then raise exception '수정본 버전을 확인해 주세요.' using errcode='40001'; end if;
 select * into r from public.marketing_rules where id=p_rule_id;
 if p_rule_id is not null and (r.id is null or r.version is distinct from p_base_version) then raise exception '적용 규칙이 변경되었습니다. 최신 버전과 비교해 주세요.' using errcode='40001'; end if;
 perform public.marketing_rule_definition_check(p_definition,coalesce(r.code,''));
 if length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '변경 사유를 입력해 주세요.' using errcode='22023'; end if;
 insert into public.marketing_rule_drafts(id,rule_id,base_version,definition,reason,actor) values(p_draft_id,p_rule_id,p_base_version,p_definition,p_reason,auth.uid())
 on conflict(id) do update set definition=excluded.definition,reason=excluded.reason,actor=excluded.actor,revision=marketing_rule_drafts.revision+1,updated_at=now() returning * into d;
 if p_publish then
  r:=public.marketing_save_rule(p_rule_id,p_base_version,p_definition->>'title',p_definition->>'description',p_definition->'config',p_definition->>'severity',(p_definition->>'enabled')::boolean,p_reason);
  update public.marketing_rule_drafts set published_version=r.version,published_rule_id=r.id where id=d.id returning * into d;
 end if;
 return jsonb_build_object('draft',to_jsonb(d),'published',p_publish);
end $$;

-- Pure evaluator: identical field semantics for intake, approval, samples and frozen batch jobs.
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

create or replace function public.marketing_validate_rules_context(p_data jsonb,p_context jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r public.marketing_rules; rules jsonb:='[]'; violations jsonb:='[]'; results jsonb:='[]'; evaluated jsonb; begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Contact 필드가 필요합니다.' using errcode='22023'; end if;
 for r in select * from public.marketing_rules where enabled order by code loop
  rules:=rules||jsonb_build_array(to_jsonb(r)); evaluated:=public.marketing_evaluate_rule(to_jsonb(r),p_data,p_context);
  results:=results||jsonb_build_array(evaluated||jsonb_build_object('id',r.id,'code',r.code,'version',r.version,'title',r.title));
  if evaluated->>'outcome' in ('fail','review','error') then
   violations:=violations||jsonb_build_array(evaluated||jsonb_build_object('id',r.id,'code',r.code,'version',r.version,'title',r.title,'message',r.title||': '||(evaluated->>'message')));
  end if;
 end loop;
 return jsonb_build_object('version',md5(rules::text),'rules',rules,'violations',violations,'results',results);
end $$;

create or replace function public.marketing_validate_rules(p_data jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select public.marketing_validate_rules_context(p_data,'{}');
$$;
revoke all on function public.marketing_validate_rules_context(jsonb,jsonb) from public,anon;
grant execute on function public.marketing_validate_rules_context(jsonb,jsonb) to authenticated;

create table public.marketing_validation_runs (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique, request jsonb not null,
 actor uuid not null references auth.users(id), actor_name text not null, scope text not null check(scope in ('all','filtered','selected')),
 filters jsonb not null, rules jsonb not null, trial boolean not null default false, engine_version text not null default '2026-09-14.2',
 status text not null default 'queued' check(status in ('queued','running','completed','completed_with_errors','cancel_requested','cancelled','failed')),
 total integer not null default 0, processed integer not null default 0, attempt integer not null default 1,
 created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz, last_error text
);
create index on public.marketing_validation_runs(created_at desc,id);
create index on public.marketing_validation_runs(status,created_at) where status in ('queued','running','cancel_requested');
create table public.marketing_validation_targets (
 run_id uuid not null references public.marketing_validation_runs(id), contact_id uuid not null,
 ordinal bigint not null, snapshot jsonb not null, context jsonb not null, submission_request_key uuid not null default gen_random_uuid(),
 processed boolean not null default false, outcome text, severity text, issue_count integer not null default 0,
 primary key(run_id,contact_id), unique(run_id,ordinal)
);
create index on public.marketing_validation_targets(run_id,processed,ordinal);
create index on public.marketing_validation_targets(run_id,outcome,severity);
create table public.marketing_validation_reference (
 run_id uuid not null references public.marketing_validation_runs(id), contact_id uuid not null, version integer not null,
 db_id text not null, email_key text, name_key text, company_keys text[] not null, organization_id uuid,
 primary key(run_id,contact_id)
);
create index on public.marketing_validation_reference(run_id,email_key);
create index on public.marketing_validation_reference(run_id,name_key);
create index on public.marketing_validation_reference(run_id,organization_id);
create table public.marketing_validation_organizations (
 run_id uuid not null references public.marketing_validation_runs(id), organization_id uuid not null,
 snapshot jsonb not null, context jsonb not null, primary key(run_id,organization_id)
);
create table public.marketing_validation_results (
 id bigint generated always as identity primary key, run_id uuid not null, contact_id uuid not null,
 rule_index integer not null, attempt integer not null, outcome text not null check(outcome in ('pass','fail','review','not_applicable','error')),
 severity text not null check(severity in ('error','warning')), detail jsonb not null, created_at timestamptz not null default now(),
 foreign key(run_id,contact_id) references public.marketing_validation_targets(run_id,contact_id),
 unique(run_id,contact_id,rule_index,attempt)
);
create index on public.marketing_validation_results(run_id,contact_id,rule_index,attempt desc);
create index on public.marketing_validation_results(run_id,outcome,severity);
create table public.marketing_validation_followups (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique,
 run_id uuid not null, contact_id uuid not null, result_id bigint references public.marketing_validation_results(id),
 status text not null check(status in ('confirmed','deferred','submitted')), reason text not null check(length(btrim(reason)) between 2 and 2000),
 actor uuid not null references auth.users(id), actor_name text not null, current_version integer not null, organization_version integer,
 submission_id uuid references public.marketing_submissions(id), created_at timestamptz not null default now(),
 foreign key(run_id,contact_id) references public.marketing_validation_targets(run_id,contact_id)
);
create index on public.marketing_validation_followups(run_id,contact_id,created_at desc);
create index on public.marketing_validation_followups(submission_id);
create index if not exists marketing_submission_result_idx on public.marketing_submissions(result_contact_id) where result_contact_id is not null;

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

-- A chunk is one transaction holding a run row lock. Backend death rolls back the
-- chunk and releases the lock, so no externally held lease or stale worker can commit.
create or replace function public.marketing_process_validation_chunk(p_run uuid default null,p_limit integer default 200) returns integer language plpgsql security definer set search_path='' as $$
declare job public.marketing_validation_runs; t public.marketing_validation_targets; rule jsonb; idx integer; eval jsonb; ctx jsonb; vals jsonb; n integer:=0; v_outcome text; v_severity text; issues integer; begin
 select * into job from public.marketing_validation_runs where (p_run is null or id=p_run) and status in ('queued','running','cancel_requested') order by created_at,id for update skip locked limit 1;
 if not found then return 0; end if;
 begin
 if job.status='cancel_requested' then update public.marketing_validation_runs set status='cancelled',finished_at=clock_timestamp() where id=job.id; return 0; end if;
 update public.marketing_validation_runs set status='running',started_at=coalesce(started_at,clock_timestamp()) where id=job.id;
 for t in select * from public.marketing_validation_targets where run_id=job.id and not processed order by ordinal limit greatest(1,least(p_limit,500)) loop
  begin
   ctx:=t.context;
   if exists(select 1 from jsonb_array_elements(job.rules) r where r->'config'->>'operator'='duplicates') then
    select ctx||jsonb_build_object('duplicates',coalesce(jsonb_agg(jsonb_build_object('id',b.contact_id,'dbId',b.db_id,'version',b.version) order by b.db_id),'[]'::jsonb)) into ctx
    from public.marketing_validation_reference a join public.marketing_validation_reference b on b.run_id=a.run_id and b.contact_id<>a.contact_id
     and (b.email_key=a.email_key or (b.name_key=a.name_key and (b.organization_id=a.organization_id or b.company_keys&&array_remove(a.company_keys,''))))
    where a.run_id=job.id and a.contact_id=t.contact_id;
   end if;
   vals:=t.snapshot->'data'||jsonb_build_object('company',coalesce(t.snapshot->'organization'->>'name',t.snapshot->'data'->>'company',''),'category',coalesce(t.snapshot->'organization'->>'category','확인 필요'),'db_id',t.snapshot->>'db_id','organization_status',t.snapshot->'organization'->>'review_status');
   for rule,idx in select value,ordinality::integer from jsonb_array_elements(job.rules) with ordinality loop
    -- Preserve successful results and all previous error attempts.
    if exists(select 1 from public.marketing_validation_results r where r.run_id=job.id and r.contact_id=t.contact_id and r.rule_index=idx and r.outcome<>'error') then continue; end if;
    eval:=public.marketing_evaluate_rule(rule,vals,ctx);
    insert into public.marketing_validation_results(run_id,contact_id,rule_index,attempt,outcome,severity,detail) values(job.id,t.contact_id,idx,job.attempt,eval->>'outcome',eval->>'severity',eval);
   end loop;
  exception when others then
   for rule,idx in select value,ordinality::integer from jsonb_array_elements(job.rules) with ordinality loop
    if not exists(select 1 from public.marketing_validation_results r where r.run_id=job.id and r.contact_id=t.contact_id and r.rule_index=idx and r.outcome<>'error') then
     insert into public.marketing_validation_results(run_id,contact_id,rule_index,attempt,outcome,severity,detail) values(job.id,t.contact_id,idx,job.attempt,'error','error',jsonb_build_object('message','검증 처리 오류 · '||sqlstate));
    end if;
   end loop;
  end;
  select x.outcome,x.severity into v_outcome,v_severity from (select distinct on (rule_index) r.outcome,r.severity,r.rule_index from public.marketing_validation_results r where r.run_id=job.id and r.contact_id=t.contact_id order by rule_index,attempt desc) x
   order by case when x.outcome='error' then 0 when x.outcome='fail' and x.severity='error' then 1 when x.outcome='fail' then 2 when x.outcome='review' then 3 when x.outcome='pass' then 4 else 5 end limit 1;
  select count(*) into issues from (select distinct on (rule_index) r.outcome from public.marketing_validation_results r where r.run_id=job.id and r.contact_id=t.contact_id order by rule_index,attempt desc) x where x.outcome in ('error','fail','review');
  -- Column-qualified assignment below avoids PL/pgSQL name ambiguity.
  update public.marketing_validation_targets mt set processed=true,outcome=v_outcome,severity=v_severity,issue_count=issues where mt.run_id=job.id and mt.contact_id=t.contact_id;
  n:=n+1;
 end loop;
 update public.marketing_validation_runs j set processed=(select count(*) from public.marketing_validation_targets where run_id=job.id and processed) where j.id=job.id;
 if not exists(select 1 from public.marketing_validation_targets where run_id=job.id and not processed) then
  update public.marketing_validation_runs set status=case when exists(select 1 from public.marketing_validation_targets where run_id=job.id and outcome='error') then 'completed_with_errors' else 'completed' end,finished_at=clock_timestamp() where id=job.id;
 end if;
 return n;
 exception when others then
  update public.marketing_validation_runs set status='failed',last_error='작업 처리 실패 · '||sqlstate,finished_at=clock_timestamp() where id=job.id;
  return 0;
 end;
end $$;

create or replace function public.marketing_validation_basis_changed(p_run uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.marketing_validation_runs j,jsonb_array_elements(j.rules) r where j.id=p_run and r->'config'->>'operator' in ('duplicates','company_standard','classification','organization')) and (
 exists(select 1 from public.marketing_validation_reference r left join public.marketing_contacts c on c.id=r.contact_id where r.run_id=p_run and (c.id is null or c.version<>r.version))
 or exists(select 1 from public.marketing_contacts c where not exists(select 1 from public.marketing_validation_reference r where r.run_id=p_run and r.contact_id=c.id))
 or exists(select 1 from public.marketing_validation_organizations r left join public.marketing_organizations o on o.id=r.organization_id where r.run_id=p_run and (o.id is null or o.version<>(r.snapshot->>'version')::integer))
 or exists(select 1 from public.marketing_organizations o where not exists(select 1 from public.marketing_validation_organizations r where r.run_id=p_run and r.organization_id=o.id)));
$$;
revoke all on function public.marketing_validation_basis_changed(uuid) from public,anon;
grant execute on function public.marketing_validation_basis_changed(uuid) to authenticated;

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

create or replace function public.marketing_validation_followup(p_request_key uuid,p_run uuid,p_contact uuid,p_status text,p_reason text,p_current_version integer,p_org_version integer,p_submission uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.marketing_validation_targets; c public.marketing_contacts; j public.marketing_validation_runs; ov integer; result uuid; prior public.marketing_validation_followups; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into prior from public.marketing_validation_followups where request_key=p_request_key;
 if found then
  if prior.run_id=p_run and prior.contact_id=p_contact and prior.status=p_status and prior.reason=p_reason and prior.submission_id is not distinct from p_submission and prior.actor=auth.uid() then return prior.id; end if;
  raise exception '같은 요청 키에 다른 처리 내용입니다.' using errcode='22023';
 end if;
 select * into t from public.marketing_validation_targets where run_id=p_run and contact_id=p_contact;
 select * into j from public.marketing_validation_runs where id=p_run;
 select * into c from public.marketing_contacts where id=p_contact;
 select version into ov from public.marketing_organizations where id=c.organization_id;
 if t.contact_id is null or c.id is null or c.version is distinct from p_current_version or ov is distinct from p_org_version then raise exception '현재 Contact/회사 기준이 변경되었습니다. 다시 조회해 주세요.' using errcode='40001'; end if;
 if p_status='confirmed' and (public.marketing_validation_basis_changed(p_run) or not t.processed or c.version<>(t.snapshot->>'version')::integer or coalesce(ov,0)<>coalesce((t.snapshot->'organization'->>'version')::integer,0) or
  exists(select 1 from jsonb_array_elements(j.rules) r join public.marketing_rules live on live.id=(r->>'id')::uuid where r->>'code'<>'DRAFT' and live.version<>(r->>'version')::integer)) then raise exception '검증 이후 기준이 바뀌었거나 미처리 자료입니다. 최신 상태로 재검증해 주세요.' using errcode='40001'; end if;
 if p_status='submitted' and not exists(select 1 from public.marketing_submissions s where s.id=p_submission and s.target_id=p_contact and s.source->>'validationRunId'=p_run::text) then raise exception '이 검증에서 제출한 변경 요청만 연결할 수 있습니다.' using errcode='22023'; end if;
 insert into public.marketing_validation_followups(request_key,run_id,contact_id,status,reason,actor,actor_name,current_version,organization_version,submission_id)
 values(p_request_key,p_run,p_contact,p_status,p_reason,auth.uid(),public.marketing_identity()->>'name',c.version,ov,p_submission) returning id into result;
 return result;
end $$;

-- Safe public kick; the periodic database worker does not depend on an open browser.
create or replace function public.marketing_validation_action(p_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.marketing_validation_runs; begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_action='kick' then perform public.marketing_process_validation_chunk(p_id,200); return jsonb_build_object('ok',true); end if;
 select * into j from public.marketing_validation_runs where id=p_id for update;
 if not found then raise exception '검증 실행을 찾을 수 없습니다.' using errcode='P0002'; end if;
 if p_action='cancel' then
  if j.status in ('queued','running','cancel_requested') then update public.marketing_validation_runs set status='cancelled',finished_at=clock_timestamp() where id=p_id; end if;
 elsif p_action='retry' then
  if j.status not in ('completed_with_errors','failed','cancelled') then raise exception '실패 또는 취소된 실행만 재시도할 수 있습니다.' using errcode='22023'; end if;
  update public.marketing_validation_targets set processed=false where run_id=p_id and outcome='error';
  update public.marketing_validation_runs set status='queued',attempt=attempt+1,finished_at=null,last_error=null,processed=(select count(*) from public.marketing_validation_targets where run_id=p_id and processed) where id=p_id;
 else raise exception '지원하지 않는 작업입니다.' using errcode='22023'; end if;
 return jsonb_build_object('ok',true);
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
  if coalesce(final_value->>'company','')='' or not public.marketing_category_valid(p_category) then raise exception '회사명과 분류를 확인해 주세요.' using errcode='22023'; end if;
  insert into public.marketing_organizations(name,category) values(final_value->>'company',p_category) returning id into oid;
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

-- Link an explicitly submitted change to its validation target atomically.
create or replace function public.marketing_link_validation_submission() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.marketing_validation_targets; c public.marketing_contacts; ov integer; begin
 if coalesce(new.source->>'validationRunId','')='' then return new; end if;
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 select * into t from public.marketing_validation_targets where run_id=(new.source->>'validationRunId')::uuid and contact_id=new.target_id;
 if not found or t.submission_request_key<>new.request_key or new.source->>'validationContactId' is distinct from new.target_id::text then raise exception '검증 결과의 변경 요청 키와 대상을 확인해 주세요.' using errcode='22023'; end if;
 select * into c from public.marketing_contacts where id=new.target_id;
 select version into ov from public.marketing_organizations where id=c.organization_id;
 insert into public.marketing_validation_followups(request_key,run_id,contact_id,status,reason,actor,actor_name,current_version,organization_version,submission_id)
 values(new.request_key,t.run_id,t.contact_id,'submitted','검증 결과를 검토하고 변경 요청 제출',auth.uid(),public.marketing_identity()->>'name',c.version,ov,new.id);
 return new;
end $$;
create trigger marketing_validation_submission_link after insert on public.marketing_submissions for each row execute function public.marketing_link_validation_submission();
revoke all on function public.marketing_link_validation_submission() from public,anon,authenticated;

-- DB-owned worker: commits every chunk, releases locks between chunks and checks
-- cancellation at every boundary. Only the cron owner can invoke this procedure.
create procedure public.marketing_validation_worker() language plpgsql as $$
declare started timestamptz:=clock_timestamp(); n integer; begin
 loop
  n:=public.marketing_process_validation_chunk(null,200);
  commit;
  exit when n=0 or clock_timestamp()-started>interval '20 seconds';
 end loop;
end $$;

do $$ declare t text; begin
 foreach t in array array['marketing_rule_versions','marketing_rule_drafts','marketing_validation_runs','marketing_validation_targets','marketing_validation_reference','marketing_validation_organizations','marketing_validation_results','marketing_validation_followups'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy marketing_read on public.%I for select to authenticated using((select public.has_page_access(''marketing'')))',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
revoke all on function public.marketing_rule_definition_check(jsonb,text),public.marketing_evaluate_rule(jsonb,jsonb,jsonb),public.marketing_process_validation_chunk(uuid,integer) from public,anon,authenticated;
revoke all on procedure public.marketing_validation_worker() from public,anon,authenticated,service_role;
revoke all on function public.marketing_edit_rule(uuid,integer,uuid,integer,jsonb,text,boolean),public.marketing_create_validation(uuid,text,jsonb,uuid[],jsonb,uuid,integer),public.marketing_validation_action(uuid,text),public.marketing_validation_report(uuid,integer,integer,text,text,text,integer,text),public.marketing_validation_followup(uuid,uuid,uuid,text,text,integer,integer,uuid) from public,anon;
grant execute on function public.marketing_evaluate_rule(jsonb,jsonb,jsonb),public.marketing_edit_rule(uuid,integer,uuid,integer,jsonb,text,boolean),public.marketing_create_validation(uuid,text,jsonb,uuid[],jsonb,uuid,integer),public.marketing_validation_action(uuid,text),public.marketing_validation_report(uuid,integer,integer,text,text,text,integer,text),public.marketing_validation_followup(uuid,uuid,uuid,text,text,integer,integer,uuid) to authenticated;
-- pg_cron is installed in production; local databases do not require the extension.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('marketing-master-validation','* * * * *','call public.marketing_validation_worker()');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
