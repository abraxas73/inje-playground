-- Disposable LOCAL database ONLY. Seed must be empty; synthetic contacts, no user data.
\set ON_ERROR_STOP on
\timing on
do $$ begin if exists(select 1 from marketing_contacts) then raise exception 'Benchmark requires an empty disposable database'; end if; end $$;
insert into auth.users values('46a2400a-f04f-4b78-bd20-e3f75507b154');
insert into user_profiles values('46a2400a-f04f-4b78-bd20-e3f75507b154','admin','test@example.com','성능 검사');
insert into marketing_organizations(id,name,category,review_status)
 select md5('org-'||i)::uuid,'검사회사'||i,case when i%4=0 then '확인 필요' else 'IT기업' end,case when i%4=0 then 'pending' else 'confirmed' end from generate_series(1,2826) i;
insert into marketing_contacts(db_id,organization_id,data)
 select 'BENCH-'||lpad(i::text,5,'0'),md5('org-'||((i-1)%2826+1))::uuid,jsonb_build_object('company','검사회사'||((i-1)%2826+1),'name',case when i%9=0 then '' else '담당'||i end,'email',i||'@example.test','eco','N','confirmedAt',case when i%20=0 then '2026-02-30' else '2026-09-14' end) from generate_series(1,7294) i;
set role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',false);
select marketing_create_validation('99999999-0000-4000-8000-000000000001','all','{}','{}',(select jsonb_agg(jsonb_build_object('id',id,'version',version)) from marketing_rules where enabled and config->>'operator'<>'builtin')) as run_id \gset
reset role;
call public.marketing_validation_worker();
select status,total,processed,round(extract(epoch from finished_at-created_at)::numeric,3) as elapsed_seconds from marketing_validation_runs where id=:'run_id';
select count(*) as result_rows from marketing_validation_results where run_id=:'run_id';
select round(pg_total_relation_size('marketing_validation_targets')/1048576.0,2) as targets_mb,round(pg_total_relation_size('marketing_validation_results')/1048576.0,2) as results_mb;
set role authenticated;
select (marketing_validation_report(:'run_id')->'counts') as contact_counts;
reset role;
