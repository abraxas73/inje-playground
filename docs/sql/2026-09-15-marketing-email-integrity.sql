-- Apply after marketing-rule-management-v2. No Contact rows are modified.
begin;
create table public.marketing_email_profiles (
 organization_id uuid primary key references public.marketing_organizations(id),
 version integer not null default 1, website text not null default '', domains text[] not null default '{}',
 reason text not null, actor uuid not null references auth.users(id), actor_name text not null, updated_at timestamptz not null default now()
);
create table public.marketing_email_profile_history (
 id bigint generated always as identity primary key, organization_id uuid not null references public.marketing_organizations(id),
 version integer not null, before_data jsonb, after_data jsonb not null, actor uuid not null, actor_name text not null, reason text not null, created_at timestamptz not null default now(), unique(organization_id,version)
);
create table public.marketing_email_runs (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique, request jsonb not null,
 actor uuid not null references auth.users(id), actor_name text not null, scope text not null check(scope in ('all','filtered','selected')), filters jsonb not null,
 status text not null default 'queued' check(status in ('queued','running','completed','cancelled')),
 total integer not null default 0, processed integer not null default 0, created_at timestamptz not null default now(), finished_at timestamptz
);
create index on public.marketing_email_runs(created_at desc);
create table public.marketing_email_targets (
 run_id uuid not null references public.marketing_email_runs(id), contact_id uuid not null references public.marketing_contacts(id),
 ordinal integer not null, snapshot jsonb not null, processed boolean not null default false,
 lease uuid, lease_until timestamptz, result jsonb, checked_at timestamptz, primary key(run_id,contact_id)
);
create index on public.marketing_email_targets(run_id,ordinal);
create index on public.marketing_email_targets(run_id,lease_until) where not processed;
create table public.marketing_email_results (
 id uuid primary key, run_id uuid not null, contact_id uuid not null, result jsonb not null, created_at timestamptz not null default now(),
 foreign key(run_id,contact_id) references public.marketing_email_targets(run_id,contact_id)
);
create index on public.marketing_email_results(run_id,contact_id,created_at desc);
create table public.marketing_email_probe_cache (
 run_id uuid not null references public.marketing_email_runs(id), key text not null, result jsonb not null, created_at timestamptz not null default now(), primary key(run_id,key)
);
-- No direct client writes, including fabricated network results.
do $$ declare t text; begin
 foreach t in array array['marketing_email_profiles','marketing_email_profile_history','marketing_email_runs','marketing_email_targets','marketing_email_results'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy marketing_email_read on public.%I for select to authenticated using ((select public.has_page_access(''marketing'')))',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
alter table public.marketing_email_probe_cache enable row level security;
revoke all on public.marketing_email_probe_cache from anon,authenticated;
grant all on public.marketing_email_probe_cache to service_role;

create function public.marketing_email_profile_save(p_id uuid,p_version integer,p_org_version integer,p_website text,p_domains text[],p_reason text)
returns public.marketing_email_profiles language plpgsql security definer set search_path='' as $$
declare old public.marketing_email_profiles; saved public.marketing_email_profiles; ident jsonb; org public.marketing_organizations; d text;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 select * into org from public.marketing_organizations where id=p_id for update;
 if not found or org.version is distinct from p_org_version then raise exception '회사 기준이 변경되었습니다. 다시 조회하세요.' using errcode='40001'; end if;
 select * into old from public.marketing_email_profiles where organization_id=p_id;
 if coalesce(old.version,0) is distinct from p_version then raise exception '홈페이지·도메인 기준이 변경되었습니다. 다시 조회하세요.' using errcode='40001'; end if;
 if p_website is null or length(p_website)>500 or (p_website<>'' and p_website !~ '^https?://[a-z0-9.-]+(/[^?#]*)?$') or p_domains is null or cardinality(p_domains)>20 or length(btrim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '주소·도메인·확인 근거를 확인하세요.' using errcode='22023'; end if;
 foreach d in array p_domains loop if d is null or length(d)>253 or d !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' then raise exception '이메일 도메인 형식을 확인하세요.' using errcode='22023'; end if; end loop;
 ident:=public.marketing_identity();
 insert into public.marketing_email_profiles(organization_id,website,domains,reason,actor,actor_name)
 values(p_id,p_website,p_domains,btrim(p_reason),auth.uid(),ident->>'name')
 on conflict(organization_id) do update set website=excluded.website,domains=excluded.domains,reason=excluded.reason,actor=excluded.actor,actor_name=excluded.actor_name,version=marketing_email_profiles.version+1,updated_at=now() returning * into saved;
 insert into public.marketing_email_profile_history(organization_id,version,before_data,after_data,actor,actor_name,reason) values(p_id,saved.version,case when old.organization_id is null then null else to_jsonb(old) end,to_jsonb(saved),auth.uid(),ident->>'name',p_reason);
 return saved;
end $$;

create function public.marketing_email_create(p_key uuid,p_scope text,p_filters jsonb,p_ids uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid:=gen_random_uuid(); old public.marketing_email_runs; request jsonb; n integer;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_key is null or p_scope is null or p_scope not in ('all','filtered','selected') or jsonb_typeof(p_filters) is distinct from 'object' or (p_scope='selected' and coalesce(cardinality(p_ids),0) not between 1 and 10000) then raise exception '검사 범위를 확인하세요.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(20260915,1);
 request:=jsonb_build_object('scope',p_scope,'filters',p_filters,'ids',p_ids);
 select * into old from public.marketing_email_runs where request_key=p_key;
 if found then
  if old.actor<>auth.uid() or old.request<>request then raise exception '요청 키의 검사 범위가 다릅니다.' using errcode='22023'; end if;
  return old.id;
 end if;
 if (select count(*) from public.marketing_email_runs where status in ('queued','running'))>=3 then raise exception '실행 중인 검사가 3개입니다. 완료 후 다시 실행하세요.' using errcode='22023'; end if;
 with selected as materialized (
  select c.*,o.name as company,o.version as organization_version,to_jsonb(p) as profile
  from public.marketing_contacts c left join public.marketing_organizations o on o.id=c.organization_id left join public.marketing_email_profiles p on p.organization_id=o.id
  where p_scope='all' or (p_scope='selected' and c.id=any(p_ids)) or (p_scope='filtered'
   and (coalesce(p_filters->>'q','')='' or position(lower(p_filters->>'q') in lower(concat_ws(' ',c.db_id,c.data->>'name',c.data->>'email',c.data->>'company',o.name)))>0)
   and (coalesce(p_filters->>'category','')='' or o.category=p_filters->>'category')
   and (coalesce(p_filters->>'department','')='' or position(lower(p_filters->>'department') in lower(coalesce(c.data->>'ownerDepartment','')))>0)
   and (coalesce(p_filters->>'issues','false')<>'true' or c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))=''))
 ), job as (
  insert into public.marketing_email_runs(id,request_key,request,actor,actor_name,scope,filters,total)
  select rid,p_key,request,auth.uid(),public.marketing_identity()->>'name',p_scope,p_filters,count(*) from selected returning id
 ), targets as (
  insert into public.marketing_email_targets(run_id,contact_id,ordinal,snapshot)
  select rid,s.id,row_number() over(order by s.db_id,s.id),jsonb_build_object('id',s.id,'db_id',s.db_id,'version',s.version,'organization_id',s.organization_id,'organization_version',s.organization_version,'company',coalesce(s.company,s.data->>'company',''),'name',coalesce(s.data->>'name',''),'email',coalesce(s.data->>'email',''),'profile',s.profile)
  from selected s cross join job returning contact_id
 ) select count(*) into n from targets;
 if n=0 then raise exception '검사 대상이 없습니다.' using errcode='22023'; end if;
 if n>100000 then raise exception '한 번에 100,000건까지 검사할 수 있습니다.' using errcode='22023'; end if;
 if p_scope='selected' and n<>(select count(distinct x) from unnest(p_ids) x) then raise exception '선택한 Contact가 변경되었습니다.' using errcode='40001'; end if;
 return rid;
end $$;

-- Service-only network worker. Expiring leases fence late writers after retries.
create function public.marketing_email_claim(p_run uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.marketing_email_runs; targets jsonb;
begin
 select * into job from public.marketing_email_runs r where (p_run is null or r.id=p_run) and r.status in ('queued','running')
 and exists(select 1 from public.marketing_email_targets t where t.run_id=r.id and not t.processed and (t.lease_until is null or t.lease_until<now()))
 order by r.created_at for update skip locked limit 1;
 if not found then return '[]'; end if;
 update public.marketing_email_runs set status='running' where id=job.id;
 with chosen as (select contact_id from public.marketing_email_targets where run_id=job.id and not processed and (lease_until is null or lease_until<now()) order by ordinal for update skip locked limit 20),
 claimed as (update public.marketing_email_targets t set lease=gen_random_uuid(),lease_until=now()+interval '120 seconds' from chosen c where t.run_id=job.id and t.contact_id=c.contact_id returning t.run_id,t.contact_id,t.lease,t.snapshot)
 select coalesce(jsonb_agg(to_jsonb(c)),'[]') into targets from claimed c;
 return targets;
end $$;
create function public.marketing_email_finish(p_run uuid,p_contact uuid,p_lease uuid,p_result jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare job public.marketing_email_runs;
begin
 select * into job from public.marketing_email_runs where id=p_run for update;
 if job.status not in ('queued','running') or job.id is null then return false; end if;
 if coalesce(p_result->>'state','') not in ('pass','review','fail','error') or length(p_result::text)>40000 then raise exception 'Invalid result'; end if;
 update public.marketing_email_targets set processed=true,result=p_result,checked_at=now(),lease=null,lease_until=null
 where run_id=p_run and contact_id=p_contact and lease=p_lease and lease_until>=now() and not processed;
 if not found then return false; end if;
 insert into public.marketing_email_results(id,run_id,contact_id,result) values(p_lease,p_run,p_contact,p_result);
 update public.marketing_email_runs set processed=processed+1,status=case when processed+1=total then 'completed' else 'running' end,finished_at=case when processed+1=total then now() else null end where id=p_run;
 return true;
end $$;
create function public.marketing_email_action(p_id uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare job public.marketing_email_runs; n integer;
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 select * into job from public.marketing_email_runs where id=p_id for update;
 if not found then raise exception '검사 실행을 찾을 수 없습니다.' using errcode='22023'; end if;
 if p_action='cancel' then
  update public.marketing_email_runs set status='cancelled',finished_at=now() where id=p_id and status in ('queued','running');
 elsif p_action='retry' then
  if job.status in ('queued','running') then return; end if;
  update public.marketing_email_targets set processed=false,lease=null,lease_until=null,result=null,checked_at=null where run_id=p_id and (not processed or result->>'state'='error');
  select count(*) into n from public.marketing_email_targets where run_id=p_id and processed;
  update public.marketing_email_runs set processed=n,status=case when n=total then 'completed' else 'queued' end,finished_at=case when n=total then finished_at else null end where id=p_id;
 else raise exception '지원하지 않는 작업입니다.' using errcode='22023'; end if;
end $$;
create function public.marketing_email_rerun(p_id uuid,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.marketing_email_runs; ids uuid[];
begin
 if not public.marketing_can_review() then raise exception '검수 담당자 권한이 필요합니다.' using errcode='42501'; end if;
 select * into old from public.marketing_email_runs where id=p_id;
 if not found then raise exception '검사 실행을 찾을 수 없습니다.' using errcode='22023'; end if;
 select array_agg(contact_id order by ordinal) into ids from public.marketing_email_targets where run_id=p_id and old.scope='selected';
 return public.marketing_email_create(p_key,old.scope,old.filters,coalesce(ids,'{}'));
end $$;
revoke all on function public.marketing_email_rerun(uuid,uuid) from public,anon;
grant execute on function public.marketing_email_rerun(uuid,uuid) to authenticated;
create function public.marketing_email_report(p_id uuid,p_page integer default 1,p_state text default '',p_q text default '',p_limit integer default 25) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('run',to_jsonb(r)-'request'-'request_key'-'actor','counts',(select jsonb_object_agg(s.state,s.n) from (select coalesce(t.result->>'state','pending') state,count(*) n from public.marketing_email_targets t where t.run_id=p_id group by 1) s),
 'total',(select count(*) from public.marketing_email_targets t where t.run_id=p_id and (p_state='' or coalesce(t.result->>'state','pending')=p_state) and (p_q='' or position(lower(p_q) in lower(concat_ws(' ',t.snapshot->>'db_id',t.snapshot->>'company',t.snapshot->>'name',t.snapshot->>'email')))>0)),
 'token',md5(concat_ws('|',r.status,r.processed,(select coalesce(max(updated_at)::text,'') from public.marketing_email_profiles),(select coalesce(max(updated_at)::text,'') from public.marketing_contacts),(select concat_ws(':',count(*),sum(version)) from public.marketing_organizations))),
 'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.ordinal) from (
  select t.contact_id,t.ordinal,t.snapshot,t.result,to_jsonb(p) profile,
   (c.version is distinct from (t.snapshot->>'version')::integer or o.version is distinct from (t.snapshot->>'organization_version')::integer or coalesce(p.version,0)<>coalesce((t.snapshot->'profile'->>'version')::integer,0) or coalesce(t.checked_at<now()-interval '30 days',false)) stale
  from public.marketing_email_targets t left join public.marketing_contacts c on c.id=t.contact_id left join public.marketing_organizations o on o.id=c.organization_id left join public.marketing_email_profiles p on p.organization_id=c.organization_id
  where t.run_id=p_id and (p_state='' or coalesce(t.result->>'state','pending')=p_state) and (p_q='' or position(lower(p_q) in lower(concat_ws(' ',t.snapshot->>'db_id',t.snapshot->>'company',t.snapshot->>'name',t.snapshot->>'email')))>0)
  order by t.ordinal limit greatest(1,least(p_limit,500)) offset (greatest(1,p_page)-1)*greatest(1,least(p_limit,500))
 ) x),'[]')) into result from public.marketing_email_runs r where r.id=p_id;
 return result;
end $$;
revoke all on function public.marketing_email_profile_save(uuid,integer,integer,text,text[],text),public.marketing_email_create(uuid,text,jsonb,uuid[]),public.marketing_email_action(uuid,text),public.marketing_email_report(uuid,integer,text,text,integer) from public,anon;
grant execute on function public.marketing_email_profile_save(uuid,integer,integer,text,text[],text),public.marketing_email_create(uuid,text,jsonb,uuid[]),public.marketing_email_action(uuid,text),public.marketing_email_report(uuid,integer,text,text,integer) to authenticated;
revoke all on function public.marketing_email_claim(uuid),public.marketing_email_finish(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_email_claim(uuid),public.marketing_email_finish(uuid,uuid,uuid,jsonb) to service_role;
commit;
