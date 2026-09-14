-- Disposable LOCAL database only; all fixtures and changes roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
create function pg_temp.expect_error(statement text,code text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlstate=code then return; else raise; end if; end;
 raise exception 'Expected SQLSTATE % for %',code,statement;
end $$;
insert into auth.users values('46a2400a-f04f-4b78-bd20-e3f75507b154'),('a4e1906d-b915-4e00-9b4e-657beeb396ae'),('00000000-0000-4000-8000-000000000099');
insert into public.user_profiles values('46a2400a-f04f-4b78-bd20-e3f75507b154','admin','pilot@example.com','허용 관리자'),('a4e1906d-b915-4e00-9b4e-657beeb396ae','user','submitter@example.com','담당 검수자'),('00000000-0000-4000-8000-000000000099','admin','other@example.com','차단 관리자');
insert into marketing_organizations(id,name,category,review_status) values('10000000-0000-4000-8000-000000000001','한빛','IT기업','confirmed');
insert into marketing_contacts(db_id,organization_id,data)
 select 'TEST-'||lpad(i::text,4,'0'),'10000000-0000-4000-8000-000000000001',jsonb_build_object('company','한빛','name',case when i=31 then '담당1' else '담당'||i end,'email',i||'@example.test','eco',case when i%2=0 then 'Y' else 'N' end,'ecoId','') from generate_series(1,32) i;
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select public.marketing_set_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',true);
select pg_temp.assert_true((select count(*)=16 from marketing_rules where not protected),'all original rules editable');
select pg_temp.expect_error($q$update marketing_rules set enabled=false$q$,'42501');
select pg_temp.expect_error($q$delete from marketing_rule_versions$q$,'42501');
select pg_temp.expect_error($q$select marketing_process_validation_chunk(null,200)$q$,'42501');
select pg_temp.expect_error($q$select marketing_save_rule((select id from marketing_rules where code='EXCEL-03'),2,'해제','','{"operator":"required","field":"company"}','error',false,'해제 시도')$q$,'22023');
do $$ declare rule marketing_rules; d jsonb; run uuid; check_result jsonb; count_before integer; original_name marketing_rules; begin
 select * into original_name from marketing_rules where code='BASE-NAME';
 perform marketing_save_rule(original_name.id,original_name.version,original_name.title,'성명 확인은 경고로 관리',original_name.config,'warning',true,'기존 업무 기준 수정');
 perform pg_temp.assert_true(exists(select 1 from jsonb_array_elements(marketing_validate_rules('{}')->'violations') v where v->>'code'='BASE-NAME' and v->>'severity'='warning'),'original edit changes applied evaluator');
 perform pg_temp.assert_true((select count(*)=3 from marketing_rule_versions where rule_id=original_name.id),'original versions preserved');
 rule:=marketing_save_rule(null,null,'Eco ID 필수','확정 Eco ID 확인','{"operator":"required","field":"ecoId","whenField":"eco","whenValue":"Y"}','error',true,'추가 조건');
 d:=marketing_edit_rule('40000000-0000-4000-8000-000000000001',0,rule.id,rule.version,to_jsonb(rule)||jsonb_build_object('severity','warning'),'경고 전환 시험',false);
 perform pg_temp.assert_true((select severity='error' from marketing_rules where id=rule.id),'draft does not alter applied policy');
 run:=marketing_create_validation('20000000-0000-4000-8000-000000000001','filtered','{"category":"IT기업","sort":"db_id","direction":"desc"}','{}',jsonb_build_array(jsonb_build_object('id',rule.id,'version',rule.version)));
 perform pg_temp.assert_true(run=marketing_create_validation('20000000-0000-4000-8000-000000000001','filtered','{"category":"IT기업","sort":"db_id","direction":"desc"}','{}',jsonb_build_array(jsonb_build_object('id',rule.id,'version',rule.version))),'run creation idempotent');
 perform pg_temp.assert_true((select count(*)=32 from marketing_validation_targets where run_id=run),'all filtered targets beyond first page');
 perform pg_temp.assert_true((select snapshot->>'db_id'='TEST-0032' from marketing_validation_targets where run_id=run and ordinal=1),'frozen target sort');
 perform marketing_validation_action(run,'kick');
 check_result:=marketing_validation_report(run);
 perform pg_temp.assert_true(check_result->'run'->>'status'='completed','job completed');
 perform pg_temp.assert_true((check_result->'counts'->>'fail')::integer=16 and (check_result->'counts'->>'not_applicable')::integer=16,'conditional results counts');
 perform pg_temp.assert_true((check_result->>'total')::integer=32 and jsonb_array_length(check_result->'rows')=25,'report pagination');
 perform pg_temp.assert_true((select count(*)=32 from marketing_validation_results where run_id=run),'only selected rule executed');
 d:=marketing_edit_rule('40000000-0000-4000-8000-000000000001',1,rule.id,rule.version,to_jsonb(rule)||jsonb_build_object('severity','warning'),'경고 전환 시험',true);
 perform pg_temp.assert_true((marketing_validation_report(run)->>'rulesChanged')::boolean,'changed policy flagged');
 perform pg_temp.assert_true((select rules->0->>'severity'='error' from marketing_validation_runs where id=run),'old snapshot unchanged after rule edit');
 perform pg_temp.expect_error(format('select marketing_create_validation(gen_random_uuid(),''all'',''{}'',''{}'',%L)',jsonb_build_array(jsonb_build_object('id',rule.id,'version',rule.version))),'40001');
end $$;
-- Compare one target to a duplicate OUTSIDE the selected scope.
do $$ declare run uuid; rules jsonb; target uuid; report jsonb; begin
 select id into target from marketing_contacts where db_id='TEST-0001';
 select jsonb_build_array(jsonb_build_object('id',id,'version',version)) into rules from marketing_rules where code='EXCEL-05';
 run:=marketing_create_validation(gen_random_uuid(),'selected','{}',array[target],rules);
 perform marketing_validation_action(run,'kick');report:=marketing_validation_report(run);
 perform pg_temp.assert_true(report->'rows'->0->>'outcome'='review','outside-scope duplicate detected');
 perform pg_temp.assert_true(report->'rows'->0->'results'->0->'detail'->'related'->0->>'dbId'='TEST-0031','duplicate self excluded');
 perform pg_temp.assert_true((select count(*)=32 from marketing_contacts),'batch did not change Master');
 perform marketing_validation_followup(gen_random_uuid(),run,target,'confirmed','별도 인물로 확인',1,1);
 perform pg_temp.assert_true(marketing_validation_report(run)->'rows'->0->>'followup_status'='confirmed','human evidence retained');
end $$;
-- Cancellation preserves unprocessed scope; retries continue the frozen run.
do $$ declare run uuid; rules jsonb; begin
 select jsonb_build_array(jsonb_build_object('id',id,'version',version)) into rules from marketing_rules where code='EXCEL-14';
 run:=marketing_create_validation(gen_random_uuid(),'all','{}','{}',rules);
 perform marketing_validation_action(run,'cancel');
 perform pg_temp.assert_true((marketing_validation_report(run)->'run'->>'processed')::integer=0,'cancel does not fake completion');
 perform marketing_validation_action(run,'retry');perform marketing_validation_action(run,'kick');
 perform pg_temp.assert_true(marketing_validation_report(run)->'run'->>'status'='completed','retry processes cancelled targets');
end $$;
-- Applied field rules govern approval too; no hidden required-name/date checks remain.
do $$ declare r marketing_rules; s uuid; checked jsonb; final jsonb; target uuid; run uuid; request uuid; count_before integer; begin
 select * into r from marketing_rules where code='BASE-NAME';
 perform marketing_save_rule(r.id,r.version,r.title,r.description,r.config,'warning',false,'성명 필수 해제 검증');
 select * into r from marketing_rules where code='EXCEL-14';
 perform marketing_save_rule(r.id,r.version,r.title,r.description,r.config,r.severity,false,'날짜 규칙 해제 검증');
 select jsonb_object_agg(k,'') into final from unnest(array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes']) k;
 final:=final||'{"company":"신규회사","email":"approved@example.test","confirmedAt":"미확인"}';
 s:=(marketing_submit(jsonb_build_array(jsonb_build_object('requestKey',gen_random_uuid(),'data',final)))->>0)::uuid;
 checked:=marketing_review_check(s,final||'{"category":"IT기업"}',null,null);
 perform pg_temp.assert_true(jsonb_array_length(checked->'blockingErrors')=0,'disabled name/date rules not hardcoded at approval');
 perform marketing_review(s,1,'approve',final,null,null,null,null,'IT기업','확인 자료에 따른 승인',jsonb_build_object('token',checked->>'token','reason','전체 담당자 확인 항목 증빙 확인'));
 perform pg_temp.assert_true((select data->>'name'='' and data->>'confirmedAt'='미확인' from marketing_contacts where db_id like 'M-%'),'approval uses applied policy');
 -- New organization classification is also covered by configurable field rules.
 r:=marketing_save_rule(null,null,'분류 제한','','{"operator":"one_of","field":"category","values":["IT기업"]}','error',true,'승인 분류 검사');
 s:=(marketing_submit(jsonb_build_array(jsonb_build_object('requestKey',gen_random_uuid(),'data',final||'{"email":"next@example.test"}')))->>0)::uuid;
 checked:=marketing_review_check(s,final||'{"email":"next@example.test","category":"기타"}',null,null);
 perform pg_temp.assert_true(jsonb_array_length(checked->'blockingErrors')>0,'new company category checked before approval');
 -- An explicit change request links to this run exactly once in the submission transaction.
 select id into target from marketing_contacts where db_id='TEST-0002';
 run:=marketing_create_validation(gen_random_uuid(),'selected','{}',array[target],jsonb_build_array(jsonb_build_object('id',r.id,'version',r.version)));
 select submission_request_key into request from marketing_validation_targets where run_id=run and contact_id=target;
 s:=(marketing_submit(jsonb_build_array(jsonb_build_object('requestKey',request,'targetId',target,'data','{"phone":"01012345678"}'::jsonb,'source',jsonb_build_object('validationRunId',run,'validationContactId',target))))->>0)::uuid;
 perform marketing_submit(jsonb_build_array(jsonb_build_object('requestKey',request,'targetId',target,'data','{"phone":"01012345678"}'::jsonb,'source',jsonb_build_object('validationRunId',run,'validationContactId',target))));
 perform pg_temp.assert_true((select count(*)=1 from marketing_validation_followups where run_id=run and submission_id=s),'idempotent linked change submission');
end $$;
-- Calendar and manual results are produced by the shared evaluator.
select pg_temp.assert_true(marketing_evaluate_rule('{"title":"날짜","severity":"error","config":{"operator":"date","field":"confirmedAt"}}','{"confirmedAt":"2025-02-29"}')->>'outcome'='fail','invalid leap day');
select pg_temp.assert_true(marketing_evaluate_rule('{"title":"날짜","severity":"error","config":{"operator":"date","field":"confirmedAt"}}','{"confirmedAt":"2024-02-29"}')->>'outcome'='pass','valid leap day');
select pg_temp.assert_true(marketing_evaluate_rule('{"title":"확인","severity":"warning","config":{"operator":"review"}}','{}')->>'outcome'='review','manual cannot auto-pass');
-- Simulate per-rule execution errors; retries retain prior attempts and no duplicates.
reset role;
create function pg_temp.inject_validation_error() returns trigger language plpgsql as $$ begin
 if new.attempt=1 and exists(select 1 from public.marketing_validation_runs where id=new.run_id and request_key='30000000-0000-4000-8000-000000000001') then
  new.outcome:='error';new.severity:='error';new.detail:='{"message":"local simulated executor error"}';
 end if;return new;
end $$;
create trigger local_validation_error before insert on marketing_validation_results for each row execute function pg_temp.inject_validation_error();
set local role authenticated;
do $$ declare run uuid; selected uuid[]; rules jsonb; begin
 select array_agg(id) into selected from marketing_contacts where db_id in ('TEST-0001','TEST-0002');
 select jsonb_build_array(jsonb_build_object('id',id,'version',version)) into rules from marketing_rules where code='EXCEL-03';
 run:=marketing_create_validation('30000000-0000-4000-8000-000000000001','selected','{}',selected,rules);
 perform marketing_validation_action(run,'kick');
 perform pg_temp.assert_true(marketing_validation_report(run)->'run'->>'status'='completed_with_errors','executor errors visible');
 perform marketing_validation_action(run,'retry');perform marketing_validation_action(run,'kick');perform marketing_validation_action(run,'kick');
 perform pg_temp.assert_true(marketing_validation_report(run)->'run'->>'status'='completed','retry succeeds after executor recovery');
 perform pg_temp.assert_true((select count(*)=4 from marketing_validation_results where run_id=run),'old error attempts preserved without duplicate new results');
 perform pg_temp.assert_true((marketing_validation_report(run)->'counts'->>'pass')::integer=2,'summary uses latest successful attempts');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select pg_temp.assert_true((select count(*)=0 from marketing_validation_runs),'blocked admin cannot see jobs');
select pg_temp.assert_true((select count(*)=0 from marketing_validation_results),'blocked admin cannot see results');
select pg_temp.expect_error($q$select marketing_create_validation(gen_random_uuid(),'all','{}','{}','[]')$q$,'42501');
select pg_temp.expect_error($q$select marketing_validation_action(gen_random_uuid(),'kick')$q$,'42501');
rollback;
