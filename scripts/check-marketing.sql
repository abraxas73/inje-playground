-- Run ONLY against a disposable local PostgreSQL database with the marketing migration applied.
-- All fixtures and mutations are rolled back. See docs/marketing-master-db.md.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
create or replace function pg_temp.expect_error(statement text,code text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlstate=code then return; else raise; end if; end;
 raise exception 'Expected SQLSTATE % for %',code,statement;
end $$;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
insert into public.user_profiles(user_id,role,email,display_name) values
 ('00000000-0000-4000-8000-000000000001','admin','admin@example.com','관리자'),
 ('00000000-0000-4000-8000-000000000002','user','submitter@example.com','제출자'),
 ('00000000-0000-4000-8000-000000000003','user','other@example.com','다른 제출자');
insert into public.company_directory(email,division,dept_name,active) values('submitter@example.com','사업부문','사업팀',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(public.marketing_can_review(),'admin reviewer');
select public.marketing_import_master(repeat('a',64),'fixture.xlsx','[{"dbId":"DB001","category":"IT기업","sheet":"01_Master_DB","row":4,"data":{"company":"한빛","name":"김서연","email":"first@example.com","position":"대리"},"raw":{"원본출처":"기존 뉴스레터"}},{"dbId":"DB002","category":"IT기업","sheet":"01_Master_DB","row":5,"data":{"company":"한빛","name":"박지민","email":"second@example.com"},"raw":{"성명":"박지민"}},{"dbId":"DB003","category":"확인 필요","sheet":"01_Master_DB","row":6,"data":{"company":"","name":"미확인","email":"legacy@example.com"},"raw":{"회사명":""}}]');
select pg_temp.assert_true((select count(*)=3 from public.marketing_contacts),'import contacts');
select pg_temp.assert_true((select count(*)=1 from public.marketing_organizations),'exact company reuse');
select pg_temp.assert_true((select count(*)=3 from public.marketing_source_rows),'preserve all original rows');
select pg_temp.expect_error($q$select public.marketing_import_master(repeat('a',64),'fixture.xlsx','[]')$q$,'22023');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(not public.marketing_can_review(),'submitter not reviewer');
select public.marketing_submit('[{"requestKey":"10000000-0000-4000-8000-000000000001","data":{"company":"한빛","name":"신규","email":"new@example.com"},"validation":{"kind":"신규 등록"},"source":{"row":2}}]') as submission_ids \gset
select pg_temp.assert_true((select division='사업부문' from public.marketing_submissions limit 1),'server directory department');
select pg_temp.assert_true((select jsonb_typeof(validation->'errors')='array' and jsonb_typeof(validation->'ai')='object' and data->>'phone'='' from public.marketing_submissions limit 1),'direct RPC metadata normalized');
select pg_temp.expect_error($q$select public.marketing_submit('[{"requestKey":"10000000-0000-4000-8000-000000000099","data":{"name":123}}]')$q$,'22023');
select pg_temp.assert_true((select count(*)=3 from public.marketing_contacts),'submit never modifies Master');
select pg_temp.expect_error($q$update public.marketing_contacts set data='{}'$q$,'42501');
select pg_temp.expect_error($q$delete from public.marketing_source_rows$q$,'42501');
select pg_temp.expect_error($q$select public.marketing_review((select id from public.marketing_submissions limit 1),1,'approve','{}',null,null,null,null,'IT기업','확인')$q$,'42501');
select public.marketing_submit('[{"requestKey":"10000000-0000-4000-8000-000000000001","data":{"company":"한빛","name":"신규","email":"new@example.com"},"validation":{}}]');
select pg_temp.assert_true((select count(*)=1 from public.marketing_submissions),'idempotent submission');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.marketing_submissions),'other submitter cannot read queue');
select pg_temp.assert_true(public.marketing_pending_duplicate('{"email":"new@example.com"}'),'detect duplicate without exposing another submission');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare sid uuid; oid uuid; cid uuid; result uuid; begin
 select id into sid from public.marketing_submissions limit 1;
 perform public.marketing_revalidate(sid,1,'{"kind":"확인 필요","ai":{"status":"failed"}}');
 perform pg_temp.assert_true((select version=2 and validation->'ai'->>'status'='failed' from public.marketing_submissions where id=sid),'persist retry outcome and version');
 -- Restore another validation revision and use its version in the subsequent approval tests.
 perform public.marketing_revalidate(sid,2,'{"kind":"신규 등록"}');
 select id into oid from public.marketing_organizations limit 1;
 perform pg_temp.expect_error(format('select public.marketing_review(%L,3,''approve'',''{}'',null,null,%L,1,''IT기업'',''확인'')',sid,oid),'22023');
 perform pg_temp.expect_error(format('select public.marketing_review(%L,1,null,''{}'',null,null,%L,1,''IT기업'',''확인'')',sid,oid),'22023');
 result:=public.marketing_review(sid,3,'approve','{"company":"한빛","name":"신규","email":"new@example.com"}',null,null,oid,1,'IT기업','신규 인물과 회사 확인');
 perform pg_temp.assert_true(result is not null,'approved result');
 perform pg_temp.assert_true((select count(*)=4 from public.marketing_contacts),'approved adds one Contact');
 perform pg_temp.assert_true(public.marketing_review(sid,1,'approve','{}',null,null,oid,1,'IT기업','재시도')=result,'idempotent approval');
 perform pg_temp.assert_true((select count(*)=4 from public.marketing_contacts),'retry does not duplicate');
 perform pg_temp.assert_true((select count(*)=1 from public.marketing_review_events where submission_id=sid),'approval and audit atomic');
 -- Stale update and email collision both leave the submission pending.
 perform public.marketing_submit('[{"requestKey":"10000000-0000-4000-8000-000000000002","data":{"name":"김서연","email":"first@example.com"},"validation":{}}]');
 select id into sid from public.marketing_submissions where request_key='10000000-0000-4000-8000-000000000002';
 select id into cid from public.marketing_contacts where db_id='DB001';
 perform pg_temp.expect_error(format('select public.marketing_review(%L,1,''approve'',''{"name":"김서연","email":"first@example.com"}'',%L,99,%L,1,''IT기업'',''수정 확인'')',sid,cid,oid),'40001');
 perform pg_temp.expect_error(format('select public.marketing_review(%L,1,''approve'',''{"name":"김서연","email":"second@example.com"}'',%L,1,%L,1,''IT기업'',''수정 확인'')',sid,cid,oid),'23505');
 perform pg_temp.assert_true((select status='pending' from public.marketing_submissions where id=sid),'failed approval rolls back');
 perform public.marketing_review(sid,1,'approve','{"name":"김서연","email":"first@example.com","position":"과장"}',cid,1,oid,1,'IT기업','승진 확인');
 perform pg_temp.assert_true((select db_id='DB001' and version=2 and data->>'position'='과장' from public.marketing_contacts where id=cid),'stable ID and version increment');
 perform public.marketing_update_organization(oid,1,'한빛클라우드','솔루션·제품사',array['한빛'],'회사명 변경 확인');
 perform pg_temp.assert_true((select version=3 from public.marketing_contacts where id=cid),'org change invalidates open reviews');
 perform pg_temp.assert_true((public.marketing_search_contacts('한빛클라우드','솔루션·제품사',false,0)->>'total')::integer=3,'canonical organization search and shared classification');
 perform pg_temp.expect_error(format('select public.marketing_update_organization(%L,1,''오래된 이름'',''IT기업'',array[]::text[],''확인'')',oid),'40001');
 perform public.marketing_submit('[{"requestKey":"10000000-0000-4000-8000-000000000003","data":{"name":"반려 대상"},"validation":{}}]');
 select id into sid from public.marketing_submissions where request_key='10000000-0000-4000-8000-000000000003';
 perform public.marketing_review(sid,1,'reject','{}',null,null,null,null,'확인 필요','정보 보완 요청');
 perform pg_temp.assert_true((select count(*)=4 from public.marketing_contacts),'rejection never changes Master');
end $$;
select public.marketing_set_reviewer('00000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(public.marketing_can_review(),'assigned reviewer');
reset role;
insert into public.user_page_access(user_id,permissions) values('00000000-0000-4000-8000-000000000002','{"marketing":false}');
set local role authenticated;
select pg_temp.assert_true(not public.marketing_can_review(),'page denial also denies review');
select pg_temp.assert_true((select count(*)=0 from public.marketing_contacts),'RLS page denial');
select pg_temp.expect_error($q$select public.marketing_submit('[{"requestKey":"10000000-0000-4000-8000-000000000004","data":{}}]')$q$,'42501');
rollback;
\echo 'Marketing SQL checks passed; all fixtures rolled back.'
