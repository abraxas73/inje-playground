-- Prerequisite: 2026-09-11-page-access.sql. Additive, rerunnable migration.
begin;
create or replace function public.valid_page_permissions(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p)<>'object' then false else not exists
 (select 1 from jsonb_each(p) e where e.key not in ('food','ladder','team','survey','usage_code','usage_chat','usage_perf','rfp','people_news','guide','marketing') or jsonb_typeof(e.value)<>'boolean') end;
$$;
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select p.role='admin' or (p_page in ('food','ladder','team','survey','usage_code','usage_chat','usage_perf','rfp','people_news','guide','marketing')
 and (p.role='user' or (p.role='guest' and p_page in ('food','ladder','team','survey')))
 and coalesce((a.permissions->>p_page)::boolean,true)) from public.user_profiles p left join public.user_page_access a on a.user_id=p.user_id where p.user_id=auth.uid()),false);
$$;

create or replace function public.marketing_category_valid(p text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(p in ('IT기업','솔루션·제품사','공공기관','확인 필요','기타','교육·연구','제조사','금융','협회·단체','언론'),false);
$$;
create table if not exists public.marketing_reviewers (
 user_id uuid primary key references auth.users(id) on delete cascade
);
create or replace function public.marketing_can_review() returns boolean language sql stable security definer set search_path='' as $$
 select public.has_page_access('marketing') and (exists(select 1 from public.user_profiles where user_id=auth.uid() and role='admin') or exists(select 1 from public.marketing_reviewers where user_id=auth.uid()));
$$;
create table if not exists public.marketing_organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 2000),
 category text not null check(public.marketing_category_valid(category)), aliases text[] not null default '{}', version integer not null default 1,
 created_at timestamptz not null default now()
);
-- An exact name can belong to separate legal entities; names/aliases deliberately are NOT unique.
create index if not exists marketing_org_name_idx on public.marketing_organizations(lower(btrim(name)));
create table if not exists public.marketing_contacts (
 id uuid primary key default gen_random_uuid(), db_id text not null unique,
 organization_id uuid references public.marketing_organizations(id), data jsonb not null check(jsonb_typeof(data)='object'),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists marketing_contact_email_idx on public.marketing_contacts(lower(btrim(data->>'email'))) where btrim(coalesce(data->>'email',''))<>'';
create index if not exists marketing_contact_org_idx on public.marketing_contacts(organization_id);
create index if not exists marketing_contact_name_idx on public.marketing_contacts(lower(btrim(data->>'name')));
create table if not exists public.marketing_import_batches (
 id uuid primary key default gen_random_uuid(), file_hash text not null unique, filename text not null,
 row_count integer not null, imported_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.marketing_source_rows (
 id bigint generated always as identity primary key, batch_id uuid not null references public.marketing_import_batches(id),
 contact_id uuid not null references public.marketing_contacts(id), sheet text not null, row_number integer not null,
 raw jsonb not null, unique(batch_id,sheet,row_number)
);
create index if not exists marketing_source_contact_idx on public.marketing_source_rows(contact_id);
create table if not exists public.marketing_submissions (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique,
 submitted_by uuid not null references auth.users(id), submitter text not null, division text not null,
 data jsonb not null check(jsonb_typeof(data)='object'), target_id uuid references public.marketing_contacts(id),
 clear_fields text[] not null default '{}', validation jsonb not null, source jsonb not null default '{}',
 status text not null default 'pending' check(status in ('pending','approved','rejected')), version integer not null default 1,
 result_contact_id uuid references public.marketing_contacts(id), created_at timestamptz not null default now()
);
create index if not exists marketing_submission_queue_idx on public.marketing_submissions(status,created_at desc);
create index if not exists marketing_submission_owner_idx on public.marketing_submissions(submitted_by,created_at desc);
create table if not exists public.marketing_review_events (
 id uuid primary key default gen_random_uuid(), submission_id uuid references public.marketing_submissions(id),
 actor uuid references auth.users(id), actor_name text not null, action text not null, reason text not null,
 before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create index if not exists marketing_event_submission_idx on public.marketing_review_events(submission_id);
create index if not exists marketing_event_time_idx on public.marketing_review_events(created_at desc);

do $$ declare t text; begin
 foreach t in array array['marketing_reviewers','marketing_organizations','marketing_contacts','marketing_import_batches','marketing_source_rows','marketing_submissions','marketing_review_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('drop policy if exists marketing_read on public.%I',t);
 end loop;
end $$;
create policy marketing_read on public.marketing_reviewers for select to authenticated using(user_id=(select auth.uid()) or (select public.marketing_can_review()));
create policy marketing_read on public.marketing_organizations for select to authenticated using((select public.has_page_access('marketing')));
create policy marketing_read on public.marketing_contacts for select to authenticated using((select public.has_page_access('marketing')));
create policy marketing_read on public.marketing_import_batches for select to authenticated using((select public.marketing_can_review()));
create policy marketing_read on public.marketing_source_rows for select to authenticated using((select public.has_page_access('marketing')));
create policy marketing_read on public.marketing_submissions for select to authenticated using((select public.has_page_access('marketing')) and (submitted_by=(select auth.uid()) or (select public.marketing_can_review())));
create policy marketing_read on public.marketing_review_events for select to authenticated using((select public.has_page_access('marketing')) and ((select public.marketing_can_review()) or exists(select 1 from public.marketing_submissions s where s.id=submission_id and s.submitted_by=(select auth.uid()))));

-- Caller identity/division are resolved inside the DB, never accepted from the browser.
create or replace function public.marketing_identity() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',coalesce(p.display_name,p.email),'division',coalesce(d.division,d.dept_name,'소속 미확인'))
 from public.user_profiles p left join public.company_directory d on lower(d.email)=lower(p.email) and d.active where p.user_id=auth.uid();
$$;
-- Recommendations are untrusted metadata; normalize their shape even for direct RPC callers.
create or replace function public.marketing_safe_validation(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb; k text; a jsonb; begin
 v:=jsonb_build_object('kind',case when p->>'kind' in ('신규 등록','기존 정보 업데이트','중복 의심','확인 필요') then p->>'kind' else '확인 필요' end,
 'ruleVersion',coalesce(p->>'ruleVersion','직접 제출 · 검수 시 재검증'),'targetId',p->>'targetId','targetVersion',case when jsonb_typeof(p->'targetVersion')='number' then p->'targetVersion' else 'null'::jsonb end);
 foreach k in array array['errors','reasons','candidates','organizationIds'] loop
  a:='[]';
  if jsonb_typeof(p->k)='array' then select coalesce(jsonb_agg(value),'[]') into a from jsonb_array_elements(p->k) where jsonb_typeof(value)='string'; end if;
  v:=v||jsonb_build_object(k,a);
 end loop;
 v:=v||jsonb_build_object('ai',jsonb_build_object('status',case when p->'ai'->>'status' in ('not_needed','unavailable','success','failed') then p->'ai'->>'status' else 'unavailable' end,
 'reason',coalesce(p->'ai'->>'reason','검수 시 다시 확인해 주세요.'),'category',p->'ai'->>'category','organizationId',p->'ai'->>'organizationId','model',p->'ai'->>'model'));
 return v;
end $$;
create or replace function public.marketing_submit(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; ident jsonb; result jsonb:='[]'; sid uuid; prior public.marketing_submissions; normalized jsonb; k text;
begin
 if not public.has_page_access('marketing') then raise exception '접근 권한이 없습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 then raise exception '한 번에 1~200건을 제출할 수 있습니다.' using errcode='22023'; end if;
 ident:=public.marketing_identity();
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r->'data')<>'object' or length((r->'data')::text)>40000 then raise exception '잘못된 입력입니다.' using errcode='22023'; end if;
  normalized:='{}';
  foreach k in array array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes'] loop
   if r->'data' ? k and (jsonb_typeof(r->'data'->k)<>'string' or length(r->'data'->>k)>2000) then raise exception 'Contact 필드는 2,000자 이하 문자열이어야 합니다.' using errcode='22023'; end if;
   normalized:=normalized||jsonb_build_object(k,btrim(coalesce(r->'data'->>k,'')));
  end loop;
  insert into public.marketing_submissions(request_key,submitted_by,submitter,division,data,target_id,clear_fields,validation,source)
   values((r->>'requestKey')::uuid,auth.uid(),ident->>'name',ident->>'division',normalized,nullif(r->>'targetId','')::uuid,
   array(select jsonb_array_elements_text(coalesce(r->'clearFields','[]'))),public.marketing_safe_validation(r->'validation'),coalesce(r->'source','{}'))
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
create or replace function public.marketing_review(p_id uuid,p_version integer,p_action text,p_final jsonb,p_target uuid,p_target_version integer,p_org uuid,p_org_version integer,p_category text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.marketing_submissions; c public.marketing_contacts; o public.marketing_organizations; ident jsonb;
 cid uuid; oid uuid; before_value jsonb; final_value jsonb; k text; duplicate_count integer;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_action is null or p_action not in ('approve','reject') or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '검수 사유를 입력해 주세요.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into s from public.marketing_submissions where id=p_id for update;
 if not found then raise exception '제출을 찾을 수 없습니다.' using errcode='P0002'; end if;
 if s.status='approved' and p_action='approve' then return s.result_contact_id; end if;
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
 jsonb_build_object('contact',(select to_jsonb(mc) from public.marketing_contacts mc where id=cid),'organization',(select to_jsonb(mo) from public.marketing_organizations mo where id=oid),'submissionSource',s.source));
 return cid;
end $$;

create or replace function public.marketing_update_organization(p_id uuid,p_version integer,p_name text,p_category text,p_aliases text[],p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare old public.marketing_organizations; ident jsonb;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if length(btrim(coalesce(p_name,''))) not between 1 and 2000 or not public.marketing_category_valid(p_category) or length(btrim(coalesce(p_reason,'')))<2 or coalesce(array_length(p_aliases,1),0)>50 then raise exception '회사명·분류·변경 사유를 확인해 주세요.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 select * into old from public.marketing_organizations where id=p_id for update;
 if not found or old.version is distinct from p_version then raise exception '회사 정보가 변경되었습니다.' using errcode='40001'; end if;
 update public.marketing_organizations set name=btrim(p_name),category=p_category,aliases=p_aliases,version=version+1 where id=p_id;
 -- Invalidates open contact reviews when the company-wide classification/name changes.
 update public.marketing_contacts set version=version+1,updated_at=now() where organization_id=p_id;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,before_data,after_data) values(auth.uid(),ident->>'name','회사·기관 기준 변경',p_reason,to_jsonb(old),(select to_jsonb(o) from public.marketing_organizations o where id=p_id));
end $$;

create or replace function public.marketing_import_master(p_hash text,p_filename text,p_rows jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare r jsonb; batch uuid; cid uuid; oid uuid; n integer:=0; import_category text; ident jsonb;
begin
 if not public.has_page_access('marketing') or not exists(select 1 from public.user_profiles where user_id=auth.uid() and role='admin') then raise exception '관리자만 최초 이관할 수 있습니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 or p_hash !~ '^[a-f0-9]{64}$' then raise exception '이관 파일이 올바르지 않습니다.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260914,1);
 if exists(select 1 from public.marketing_import_batches where file_hash=p_hash) then raise exception '이미 이관된 파일입니다.' using errcode='23505'; end if;
 if exists(select 1 from public.marketing_contacts) then raise exception '최초 이관은 비어 있는 Master에서만 가능합니다.' using errcode='22023'; end if;
 insert into public.marketing_import_batches(file_hash,filename,row_count,imported_by) values(p_hash,p_filename,jsonb_array_length(p_rows),auth.uid()) returning id into batch;
 for r in select value from jsonb_array_elements(p_rows) loop
  oid:=null; import_category:=r->>'category';
  if coalesce(r->>'dbId','')='' or not public.marketing_category_valid(import_category) or jsonb_typeof(r->'data')<>'object' then raise exception 'DB ID 또는 분류가 올바르지 않습니다.' using errcode='22023'; end if;
  if btrim(coalesce(r->'data'->>'company',''))<>'' then
   select id into oid from public.marketing_organizations where lower(btrim(name))=lower(btrim(r->'data'->>'company')) and marketing_organizations.category=import_category limit 1;
   if oid is null then insert into public.marketing_organizations(name,category) values(btrim(r->'data'->>'company'),import_category) returning id into oid; end if;
  end if;
  insert into public.marketing_contacts(db_id,organization_id,data) values(r->>'dbId',oid,r->'data') returning id into cid;
  insert into public.marketing_source_rows(batch_id,contact_id,sheet,row_number,raw) values(batch,cid,r->>'sheet',(r->>'row')::integer,r->'raw');
  n:=n+1;
 end loop;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,after_data) values(auth.uid(),ident->>'name','최초 Master 이관',p_filename,jsonb_build_object('batchId',batch,'rows',n,'hash',p_hash));
 return n;
end $$;

create or replace function public.marketing_set_reviewer(p_user uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare ident jsonb; begin
 if not exists(select 1 from public.user_profiles where user_id=auth.uid() and role='admin') then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
 if not exists(select 1 from public.user_profiles where user_id=p_user and role in ('user','admin')) then raise exception '등록된 사용자 계정이 필요합니다.' using errcode='22023'; end if;
 if p_enabled then insert into public.marketing_reviewers(user_id) values(p_user) on conflict do nothing; else delete from public.marketing_reviewers where user_id=p_user; end if;
 ident:=public.marketing_identity();
 insert into public.marketing_review_events(actor,actor_name,action,reason,after_data) values(auth.uid(),ident->>'name','검수 권한 변경',case when p_enabled then '검수자 지정' else '검수자 해제' end,jsonb_build_object('userId',p_user,'enabled',p_enabled));
end $$;

create or replace function public.marketing_revalidate(p_id uuid,p_version integer,p_validation jsonb) returns public.marketing_submissions
language plpgsql security definer set search_path='' as $$
declare result public.marketing_submissions; begin
 if not public.marketing_can_review() then raise exception '검수 권한이 필요합니다.' using errcode='42501'; end if;
 update public.marketing_submissions set validation=public.marketing_safe_validation(p_validation),version=version+1 where id=p_id and version=p_version and status='pending' returning * into result;
 if not found then raise exception '제출 상태가 변경되었습니다. 새로고침해 주세요.' using errcode='40001'; end if;
 return result;
end $$;

create or replace function public.marketing_stats() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('total',(select count(*) from public.marketing_contacts),
 'missingCompany',(select count(*) from public.marketing_contacts where btrim(coalesce(data->>'company',''))=''),
 'missingName',(select count(*) from public.marketing_contacts where btrim(coalesce(data->>'name',''))=''),
 'unclassified',(select count(*) from public.marketing_contacts c left join public.marketing_organizations o on o.id=c.organization_id where o.id is null or o.category='확인 필요'),
 'pending',(select count(*) from public.marketing_submissions where status='pending'));
$$;
create or replace function public.marketing_org_counts(p_ids uuid[]) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_object_agg(organization_id,n),'{}') from (select organization_id,count(*) n from public.marketing_contacts where organization_id=any(p_ids) group by organization_id) t;
$$;
create or replace function public.marketing_pending_duplicate(p_data jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_page_access('marketing') and exists(select 1 from public.marketing_submissions where status='pending' and
 (nullif(lower(btrim(data->>'email')),'')=nullif(lower(btrim(p_data->>'email')),'') or
 (nullif(lower(btrim(data->>'company')),'')=nullif(lower(btrim(p_data->>'company')),'') and nullif(lower(btrim(data->>'name')),'')=nullif(lower(btrim(p_data->>'name')),''))));
$$;
create or replace function public.marketing_search_contacts(p_q text,p_category text,p_issues boolean,p_offset integer)
returns jsonb language sql stable set search_path='' as $$
 with matched as (select c.*,to_jsonb(o) as organization from public.marketing_contacts c left join public.marketing_organizations o on o.id=c.organization_id
 where (coalesce(p_q,'')='' or position(lower(p_q) in lower(concat_ws(' ',c.db_id,c.data->>'name',c.data->>'email',c.data->>'company',o.name)))>0)
 and (coalesce(p_category,'')='' or o.category=p_category)
 and (not coalesce(p_issues,false) or c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))=''))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from matched order by db_id offset greatest(0,p_offset) limit 25) t),'[]'), 'total',(select count(*) from matched),'pageSize',25);
$$;

-- No browser may write tables directly, including source/audit records.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'marketing_%' loop
  execute format('revoke all on function %s from public, anon',f.signature);
  execute format('grant execute on function %s to authenticated, service_role',f.signature);
 end loop;
end $$;
commit;
