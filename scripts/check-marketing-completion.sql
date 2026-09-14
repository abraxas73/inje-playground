-- Disposable LOCAL database only; run after base + completion + pilot access migrations.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
create function pg_temp.expect_error(statement text,code text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlstate=code then return; else raise; end if; end;
 raise exception 'Expected SQLSTATE % for %',code,statement;
end $$;
insert into auth.users values('46a2400a-f04f-4b78-bd20-e3f75507b154'),('a4e1906d-b915-4e00-9b4e-657beeb396ae'),('00000000-0000-4000-8000-000000000099');
insert into public.user_profiles values('46a2400a-f04f-4b78-bd20-e3f75507b154','admin','pilot@example.com','허용 관리자'),('a4e1906d-b915-4e00-9b4e-657beeb396ae','user','submitter@example.com','제출자'),('00000000-0000-4000-8000-000000000099','admin','other@example.com','차단 관리자');
insert into public.company_directory values('submitter@example.com','사업부문','사업팀',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select pg_temp.expect_error($q$select public.marketing_set_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',true)$q$,'42501');
select pg_temp.assert_true(not public.has_page_access('marketing'),'blocked administrator');
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select public.marketing_import_master(repeat('f',64),'local-fixture.xlsx','[{"dbId":"ORIG1","category":"IT기업","sheet":"01_Master_DB","row":4,"data":{"company":"한빛","name":"홍길동","email":"original@example.com","ownerDepartment":"사업실"},"raw":{"회사명":"한빛"}}]');
select pg_temp.assert_true((public.marketing_search_contacts('','',false,0,'사업실')->>'total')::integer=1,'department filter');
select pg_temp.assert_true((public.marketing_search_contacts('','',false,0,'없는부서')->>'total')::integer=0,'department exclusion');
select set_config('request.jwt.claim.sub','a4e1906d-b915-4e00-9b4e-657beeb396ae',true);
select public.marketing_submit('[{"requestKey":"10000000-0000-4000-8000-000000000010","data":{"company":"한빛","name":"홍길동","email":"other@example.com"},"processing":true,"validation":{"kind":"중복 의심"},"source":{"file":"batch.xlsx","row":2}}]');
select pg_temp.assert_true((select status='validating' from public.marketing_submissions),'durable validating status');
select public.marketing_finish_validation((select id from public.marketing_submissions),' {"kind":"중복 의심","ruleVersion":"test"}');
select pg_temp.assert_true((select status='pending' from public.marketing_submissions),'validation finishes into queue');
select pg_temp.assert_true((select count(*)=2 from public.marketing_validations),'all validation generations retained');
select pg_temp.expect_error($q$delete from public.marketing_validations$q$,'42501');
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
do $$ declare sid uuid; oid uuid; cid uuid; checked jsonb; latest jsonb; final jsonb; outid uuid; ver integer; begin
 select id,organization_id into cid,oid from public.marketing_contacts where db_id='ORIG1';
 select id into sid from public.marketing_submissions limit 1;
 final:='{"company":"한빛","name":"홍길동","email":"other@example.com"}';
 -- Checks use the exact normalized final fields, as the API does.
 select jsonb_object_agg(k,coalesce(final->>k,'')) into final from unnest(array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes']) k;
 checked:=public.marketing_review_check(sid,final,null,oid);
 perform pg_temp.assert_true(jsonb_array_length(checked->'conflicts')=1,'same company/name candidate flagged');
 perform pg_temp.expect_error(format('select public.marketing_review(%L,2,''approve'',%L,null,null,%L,1,''IT기업'',''확인'')',sid,final,oid),'40001');
 -- A new pending duplicate arriving after check invalidates its token.
 perform public.marketing_submit('[{"requestKey":"10000000-0000-4000-8000-000000000011","data":{"company":"한빛","name":"홍길동","email":"third@example.com"},"validation":{}}]');
 perform pg_temp.expect_error(format('select public.marketing_review(%L,2,''approve'',%L,null,null,%L,1,''IT기업'',''확인'',%L)',sid,final,oid,jsonb_build_object('token',checked->>'token','reason','동명이인 확인')),'40001');
 latest:=public.marketing_review_check(sid,final,null,oid);
 perform pg_temp.assert_true(jsonb_array_length(latest->'conflicts')=2,'new pending duplicate rechecked');
 outid:=public.marketing_review(sid,2,'approve',final,null,null,oid,1,'IT기업','신규 인물 확인',jsonb_build_object('token',latest->>'token','reason','동명이인 확인, 다른 대기 건은 별도 검수'));
 perform pg_temp.assert_true((select count(*)=2 from public.marketing_contacts),'resolved conflict approval');
 perform pg_temp.assert_true((select submitter='제출자' and division='사업부문' and source->>'file'='batch.xlsx' and validation_snapshot->>'ruleVersion'='test' and contact_id=outid from public.marketing_review_events where submission_id=sid),'audit joins source, identity, validation and Contact');
 perform pg_temp.assert_true((select after_data->'resolution'->>'reason' is not null from public.marketing_review_events where submission_id=sid),'resolution preserved');
 -- Reject remaining duplicate, then close identical data without touching Master.
 select id into sid from public.marketing_submissions where status='pending';
 perform public.marketing_review(sid,1,'reject','{}',null,null,null,null,'확인 필요','추가 확인 요청');
 perform public.marketing_submit(jsonb_build_array(jsonb_build_object('requestKey','10000000-0000-4000-8000-000000000012','targetId',cid,'data',(select data from public.marketing_contacts where id=cid),'validation',jsonb_build_object('kind','기존 정보 업데이트'))));
 select id into sid from public.marketing_submissions where status='pending';
 select jsonb_object_agg(k,coalesce(c.data->>k,'')) into final from public.marketing_contacts c cross join unnest(array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes']) k where c.id=cid;
 latest:=public.marketing_review_check(sid,final,cid,oid);
 select version into ver from public.marketing_contacts where id=cid;
 perform public.marketing_review(sid,1,'unchanged',final,cid,ver,oid,1,'IT기업','동일 정보 확인',jsonb_build_object('token',latest->>'token','reason','별도 인물 확인'));
 perform pg_temp.assert_true((select status='unchanged' from public.marketing_submissions where id=sid),'unchanged terminal state');
 perform pg_temp.assert_true((select version=ver from public.marketing_contacts where id=cid),'unchanged leaves Contact version untouched');
 perform pg_temp.assert_true(public.marketing_review(sid,1,'unchanged',final,cid,ver,oid,1,'IT기업','재전송')=cid,'unchanged idempotency');
 -- Company status distinct from classification and conflict group detection.
 perform public.marketing_update_organization(oid,1,'한빛','IT기업',array['(주)한빛'],'회사 및 업종 확인','confirmed');
 perform pg_temp.assert_true((select review_status='confirmed' from public.marketing_organizations where id=oid),'company review status');
 perform pg_temp.expect_error(format('select public.marketing_update_organization(%L,2,''한빛'',''확인 필요'',array[]::text[],''확인'',''confirmed'')',oid),'22023');
end $$;
reset role;
insert into public.marketing_organizations(name,category) values('한빛','공공기관');
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(public.marketing_organization_conflicts())=1,'company classification conflict list');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select pg_temp.assert_true((select count(*)=0 from public.marketing_contacts),'blocked admin sees no contacts');
select pg_temp.assert_true((select count(*)=0 from public.marketing_validations),'blocked admin sees no validation history');
select pg_temp.assert_true((select count(*)=0 from public.marketing_review_events),'blocked admin sees no audit history');
rollback;
\echo 'Marketing completion SQL checks passed; fixtures rolled back.'
