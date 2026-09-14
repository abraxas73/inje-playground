-- Disposable LOCAL database only. Rolls back every fixture.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
insert into auth.users values('46a2400a-f04f-4b78-bd20-e3f75507b154'),('a4e1906d-b915-4e00-9b4e-657beeb396ae'),('00000000-0000-4000-8000-000000000099');
insert into public.user_profiles values('46a2400a-f04f-4b78-bd20-e3f75507b154','admin','pilot@example.com','허용 관리자'),('a4e1906d-b915-4e00-9b4e-657beeb396ae','user','submitter@example.com','허용 사용자'),('00000000-0000-4000-8000-000000000099','admin','other@example.com','차단 관리자');
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select public.marketing_import_master(repeat('e',64),'export-fixture.xlsx',(select jsonb_agg(jsonb_build_object('dbId','EXPORT-'||lpad(i::text,3,'0'),'category',case when i<=37 then 'IT기업' else '공공기관' end,'sheet','01_Master_DB','row',i+3,'data',jsonb_build_object('company',case when i<=37 then '한빛' else '공공기관' end,'name',case when i=1 then '' else '담당자' end,'email',i||'@example.test','ownerDepartment',case when i<=37 then '마케팅실' else '사업실' end),'raw','{}'::jsonb)) from generate_series(1,45) i));
do $$ declare page jsonb; exported jsonb; joined jsonb; begin
 page:=public.marketing_search_contacts('한빛','IT기업',false,0,'마케팅');
 exported:=public.marketing_search_contacts('한빛','IT기업',false,0,'마케팅',null);
 perform pg_temp.assert_true(jsonb_array_length(page->'rows')=25 and (page->>'total')::integer=37,'page remains 25 rows');
 perform pg_temp.assert_true(jsonb_array_length(exported->'rows')=37,'exports all matched rows');
 joined:=(page->'rows')||(public.marketing_search_contacts('한빛','IT기업',false,25,'마케팅')->'rows');
 perform pg_temp.assert_true(joined=exported->'rows','export equals every list page in the same order');
 perform pg_temp.assert_true((public.marketing_search_contacts('한빛','IT기업',true,0,'마케팅',null)->>'total')::integer=1,'maintenance filter');
 perform pg_temp.assert_true((public.marketing_search_contacts('한빛','IT기업',false,0,'사업',null)->>'total')::integer=0,'department exclusion');
 perform pg_temp.assert_true((public.marketing_search_contacts('EXPORT-045','공공기관',false,0,'사업',null)->>'total')::integer=1,'ID search and category intersection');
end $$;
select set_config('request.jwt.claim.sub','a4e1906d-b915-4e00-9b4e-657beeb396ae',true);
select pg_temp.assert_true((public.marketing_search_contacts('','',false,0,'',null)->>'total')::integer=45,'second allowed user can export');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select pg_temp.assert_true((public.marketing_search_contacts('','',false,0,'',null)->>'total')::integer=0,'other administrator gets no rows');
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.marketing_search_contacts(text,text,boolean,integer,text,integer,text,text)','EXECUTE'),'anonymous RPC denied');
rollback;
