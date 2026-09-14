-- Apply after marketing-master.sql and marketing-pilot-access.sql.
begin;
alter table public.marketing_organizations add column if not exists review_status text not null default 'pending' check(review_status in ('pending','confirmed'));
alter table public.marketing_submissions drop constraint if exists marketing_submissions_status_check;
alter table public.marketing_submissions add constraint marketing_submissions_status_check check(status in ('validating','pending','approved','rejected','unchanged'));
alter table public.marketing_review_events add column if not exists contact_id uuid references public.marketing_contacts(id);
alter table public.marketing_review_events add column if not exists organization_id uuid references public.marketing_organizations(id);
alter table public.marketing_review_events add column if not exists submitter text;
alter table public.marketing_review_events add column if not exists division text;
alter table public.marketing_review_events add column if not exists source jsonb;
alter table public.marketing_review_events add column if not exists validation_snapshot jsonb;
create index if not exists marketing_event_contact_idx on public.marketing_review_events(contact_id,created_at desc);
create index if not exists marketing_event_org_idx on public.marketing_review_events(organization_id,created_at desc);
create table if not exists public.marketing_validations (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.marketing_submissions(id),
 submission_version integer not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 actor uuid references auth.users(id), origin text not null default 'validation', unique(submission_id,submission_version)
);
alter table public.marketing_validations enable row level security;
revoke all on public.marketing_validations from anon,authenticated;
grant select on public.marketing_validations to authenticated;
grant all on public.marketing_validations to service_role;
drop policy if exists marketing_read on public.marketing_validations;
create policy marketing_read on public.marketing_validations for select to authenticated using((select public.has_page_access('marketing')) and
 ((select public.marketing_can_review()) or exists(select 1 from public.marketing_submissions s where s.id=submission_id and s.submitted_by=(select auth.uid()))));
create index if not exists marketing_validation_submission_idx on public.marketing_validations(submission_id,created_at desc);
-- Historical latest result: original generation time is unknown; never fabricate it.
insert into public.marketing_validations(submission_id,submission_version,result,origin)
 select id,version,validation,'migration_latest' from public.marketing_submissions on conflict do nothing;
create or replace function public.marketing_record_validation() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.marketing_validations(submission_id,submission_version,result,actor) values(new.id,new.version,new.validation,auth.uid()) on conflict do nothing;
 return new;
end $$;
drop trigger if exists marketing_validation_log on public.marketing_submissions;
create trigger marketing_validation_log after insert or update of validation on public.marketing_submissions for each row execute function public.marketing_record_validation();
create or replace function public.marketing_enrich_event() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.marketing_submissions; begin
 if new.submission_id is not null then
  select * into s from public.marketing_submissions where id=new.submission_id;
  new.contact_id:=coalesce(s.result_contact_id,s.target_id);
  new.submitter:=s.submitter; new.division:=s.division; new.source:=s.source; new.validation_snapshot:=s.validation;
  select organization_id into new.organization_id from public.marketing_contacts where id=new.contact_id;
 elsif new.action='회사·기관 기준 변경' then new.organization_id:=nullif(new.after_data->>'id','')::uuid;
 end if;
 return new;
end $$;
drop trigger if exists marketing_event_context on public.marketing_review_events;
create trigger marketing_event_context before insert on public.marketing_review_events for each row execute function public.marketing_enrich_event();
update public.marketing_review_events e set contact_id=coalesce(s.result_contact_id,s.target_id),submitter=s.submitter,division=s.division,source=s.source
 from public.marketing_submissions s where e.submission_id=s.id and e.submitter is null;
update public.marketing_review_events e set organization_id=c.organization_id from public.marketing_contacts c where e.contact_id=c.id and e.organization_id is null;
update public.marketing_review_events set organization_id=(after_data->>'id')::uuid where action='회사·기관 기준 변경' and organization_id is null;
drop policy if exists marketing_read on public.marketing_reviewers;
create policy marketing_read on public.marketing_reviewers for select to authenticated using((select public.has_page_access('marketing')) and (user_id=(select auth.uid()) or (select public.marketing_can_review())));
create or replace function public.marketing_company_key(p text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(lower(btrim(coalesce(p,''))),'주식회사|\(주\)|㈜|[[:space:]]','','g');
$$;
create or replace function public.marketing_company_matches(a text,b text) returns boolean language sql stable set search_path='' as $$
 select public.marketing_company_key(a)<>'' and public.marketing_company_key(b)<>'' and (public.marketing_company_key(a)=public.marketing_company_key(b) or exists(
 select 1 from public.marketing_organizations o where
 public.marketing_company_key(a)=any(array_prepend(public.marketing_company_key(o.name),array(select public.marketing_company_key(x) from unnest(o.aliases) x))) and
 public.marketing_company_key(b)=any(array_prepend(public.marketing_company_key(o.name),array(select public.marketing_company_key(x) from unnest(o.aliases) x)))));
$$;
create or replace function public.marketing_review_check(p_id uuid,p_final jsonb,p_target uuid,p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.marketing_submissions; c public.marketing_contacts; r record; conflicts jsonb:='[]'; blocking jsonb:='[]'; company text; token text; begin
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
 token:=md5(jsonb_build_object('id',p_id,'version',s.version,'final',p_final,'target',p_target,'org',p_org,'conflicts',conflicts)::text);
 return jsonb_build_object('conflicts',conflicts,'blockingErrors',blocking,'token',token,'checkedAt',clock_timestamp());
end $$;
create or replace function public.marketing_set_reviewer(p_user uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare ident jsonb; begin
 if not public.has_page_access('marketing') or not exists(select 1 from public.user_profiles where user_id=auth.uid() and role='admin') then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
 if not exists(select 1 from public.user_profiles where user_id=p_user and role in ('user','admin')) then raise exception '등록된 사용자 계정이 필요합니다.' using errcode='22023'; end if;
 if p_enabled then insert into public.marketing_reviewers(user_id) values(p_user) on conflict do nothing; else delete from public.marketing_reviewers where user_id=p_user; end if;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,after_data) values(auth.uid(),ident->>'name','검수 권한 변경',case when p_enabled then '검수자 지정' else '검수자 해제' end,jsonb_build_object('userId',p_user,'enabled',p_enabled));
end $$;

create or replace function public.marketing_submit(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; ident jsonb; result jsonb:='[]'; sid uuid; prior public.marketing_submissions; normalized jsonb; k text;
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
  insert into public.marketing_submissions(request_key,submitted_by,submitter,division,data,target_id,clear_fields,validation,source,status)
   values((r->>'requestKey')::uuid,auth.uid(),ident->>'name',ident->>'division',normalized,nullif(r->>'targetId','')::uuid,
   array(select jsonb_array_elements_text(coalesce(r->'clearFields','[]'))),public.marketing_safe_validation(r->'validation'),coalesce(r->'source','{}'),case when r->>'processing'='true' then 'validating' else 'pending' end)
   on conflict(request_key) do nothing returning id into sid;
  if sid is null then
   select * into prior from public.marketing_submissions where request_key=(r->>'requestKey')::uuid;
   if prior.submitted_by<>auth.uid() or prior.data<>normalized or prior.target_id is distinct from nullif(r->>'targetId','')::uuid or prior.clear_fields is distinct from array(select jsonb_array_elements_text(coalesce(r->'clearFields','[]'))) then raise exception '동일 요청 키가 다른 제출에 사용되었습니다.' using errcode='22023'; end if;
   sid:=prior.id;
  end if;
  result:=result||jsonb_build_array(sid);
 end loop;
 return result;
end $$;

-- A short feature-local lock serializes Master writes; AI/network calls happen BEFORE this transaction.
drop function if exists public.marketing_review(uuid,integer,text,jsonb,uuid,integer,uuid,integer,text,text);
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
 if coalesce(final_value->>'name','')='' or coalesce(final_value->>'email','')='' or (final_value->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception '성명과 유효한 이메일이 필요합니다.' using errcode='22023'; end if;
 if (final_value->>'confirmedAt')<>'' then
  if (final_value->>'confirmedAt') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '최종확인일 형식 오류' using errcode='22023'; end if;
  perform (final_value->>'confirmedAt')::date;
 end if;
 if p_target is not null then
  select * into c from public.marketing_contacts where id=p_target for update;
  if not found or c.version is distinct from p_target_version then raise exception '기존 정보가 변경되었습니다. 재검증해 주세요.' using errcode='40001'; end if;
  before_value:=to_jsonb(c); cid:=c.id;
 end if;
 if exists(select 1 from public.marketing_contacts where lower(btrim(data->>'email'))=lower(btrim(final_value->>'email')) and id is distinct from p_target) then raise exception '다른 Contact에서 사용 중인 이메일입니다. 대상을 다시 선택해 주세요.' using errcode='23505'; end if;
 check_result:=public.marketing_review_check(p_id,final_value,p_target,p_org);
 if jsonb_array_length(check_result->'conflicts')>0 and
 (p_resolution->>'token' is distinct from check_result->>'token' or length(btrim(coalesce(p_resolution->>'reason','')))<2) then
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

drop function if exists public.marketing_update_organization(uuid,integer,text,text,text[],text);
create or replace function public.marketing_update_organization(p_id uuid,p_version integer,p_name text,p_category text,p_aliases text[],p_reason text,p_review_status text default 'pending')
returns void language plpgsql security definer set search_path='' as $$
declare old public.marketing_organizations; ident jsonb;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if length(btrim(coalesce(p_name,''))) not between 1 and 2000 or not public.marketing_category_valid(p_category) or length(btrim(coalesce(p_reason,'')))<2 or coalesce(array_length(p_aliases,1),0)>50 then raise exception '회사명·분류·변경 사유를 확인해 주세요.' using errcode='22023'; end if;
 if p_review_status not in ('pending','confirmed') or (p_review_status='confirmed' and p_category='확인 필요') then raise exception '분류 미확정 회사는 확인 완료로 처리할 수 없습니다.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into old from public.marketing_organizations where id=p_id for update;
 if not found or old.version is distinct from p_version then raise exception '회사 정보가 변경되었습니다.' using errcode='40001'; end if;
 update public.marketing_organizations set name=btrim(p_name),category=p_category,aliases=p_aliases,review_status=p_review_status,version=version+1 where id=p_id;
 -- Invalidates open contact reviews when the company-wide classification/name changes.
 update public.marketing_contacts set version=version+1,updated_at=now() where organization_id=p_id;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,before_data,after_data) values(auth.uid(),ident->>'name','회사·기관 기준 변경',p_reason,to_jsonb(old),(select to_jsonb(o) from public.marketing_organizations o where id=p_id));
end $$;

drop function if exists public.marketing_search_contacts(text,text,boolean,integer);
create or replace function public.marketing_search_contacts(p_q text,p_category text,p_issues boolean,p_offset integer,p_department text default '')
returns jsonb language sql stable set search_path='' as $$
 with matched as (select c.*,to_jsonb(o) as organization, (c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))='') as needs_maintenance from public.marketing_contacts c left join public.marketing_organizations o on o.id=c.organization_id
 where (coalesce(p_q,'')='' or position(lower(p_q) in lower(concat_ws(' ',c.db_id,c.data->>'name',c.data->>'email',c.data->>'company',o.name)))>0)
 and (coalesce(p_department,'')='' or position(lower(p_department) in lower(coalesce(c.data->>'ownerDepartment','')))>0)
 and (coalesce(p_category,'')='' or o.category=p_category)
 and (not coalesce(p_issues,false) or c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))=''))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from matched order by db_id offset greatest(0,p_offset) limit 25) t),'[]'), 'total',(select count(*) from matched),'pageSize',25);
$$;


create or replace function public.marketing_organization_conflicts() returns jsonb language sql stable set search_path='' as $$
 with grouped as (select public.marketing_company_key(name) as key,jsonb_agg(jsonb_build_object('id',id,'name',name,'category',category,'review_status',review_status) order by name,id) as organizations,
 bool_or(review_status='pending') as unresolved from public.marketing_organizations group by public.marketing_company_key(name) having count(distinct category)>1)
 select coalesce(jsonb_agg(to_jsonb(grouped) order by key),'[]') from grouped;
$$;
create or replace function public.marketing_finish_validation(p_id uuid,p_validation jsonb) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 update public.marketing_submissions set validation=public.marketing_safe_validation(p_validation),status='pending',version=version+1
 where id=p_id and submitted_by=auth.uid() and status='validating';
end $$;
create or replace function public.marketing_revalidate(p_id uuid,p_version integer,p_validation jsonb) returns public.marketing_submissions
language plpgsql security definer set search_path='' as $$ declare result public.marketing_submissions; begin
 if not public.marketing_can_review() then raise exception '검수 권한이 필요합니다.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 update public.marketing_submissions set validation=public.marketing_safe_validation(p_validation),status='pending',version=version+1
 where id=p_id and version=p_version and status in ('pending','validating') returning * into result;
 if not found then raise exception '제출 상태가 변경되었습니다. 새로고침해 주세요.' using errcode='40001'; end if;
 return result;
end $$;
drop function if exists public.marketing_pending_duplicate(jsonb);
create or replace function public.marketing_pending_duplicate(p_data jsonb,p_exclude uuid default null) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_page_access('marketing') and exists(select 1 from public.marketing_submissions s left join public.marketing_contacts t on t.id=s.target_id left join public.marketing_organizations o on o.id=t.organization_id
 where s.status in ('pending','validating') and s.id is distinct from p_exclude and
 (nullif(lower(btrim(coalesce(nullif(s.data->>'email',''),t.data->>'email'))),'')=nullif(lower(btrim(p_data->>'email')),'') or
 (nullif(lower(btrim(coalesce(nullif(s.data->>'name',''),t.data->>'name'))),'')=nullif(lower(btrim(p_data->>'name')),'') and public.marketing_company_matches(coalesce(nullif(s.data->>'company',''),o.name,t.data->>'company'),p_data->>'company'))));
$$;
-- Helper trigger functions are not callable RPCs. All mutation RPCs enforce access internally.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'marketing_%' loop
  execute format('revoke all on function %s from public, anon',f.signature);
  if f.proname in ('marketing_record_validation','marketing_enrich_event') then execute format('revoke all on function %s from authenticated',f.signature);
  else execute format('grant execute on function %s to authenticated, service_role',f.signature); end if;
 end loop;
end $$;
notify pgrst, 'reload schema';
commit;
