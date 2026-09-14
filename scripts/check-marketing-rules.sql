-- Disposable LOCAL database only. Every fixture is rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
create function pg_temp.expect_error(statement text,code text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlstate=code then return; else raise; end if; end;
 raise exception 'Expected SQLSTATE % for %',code,statement;
end $$;
insert into auth.users values('46a2400a-f04f-4b78-bd20-e3f75507b154'),('a4e1906d-b915-4e00-9b4e-657beeb396ae'),('00000000-0000-4000-8000-000000000099');
insert into public.user_profiles values('46a2400a-f04f-4b78-bd20-e3f75507b154','admin','pilot@example.com','허용 관리자'),('a4e1906d-b915-4e00-9b4e-657beeb396ae','user','submitter@example.com','담당 검수자'),('00000000-0000-4000-8000-000000000099','admin','other@example.com','차단 관리자');
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select public.marketing_set_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',true);
select pg_temp.assert_true((select count(*)=16 from public.marketing_rules),'16 seeded rules');
select pg_temp.expect_error($q$update public.marketing_rules set enabled=false$q$,'42501');
select pg_temp.expect_error($q$delete from public.marketing_rule_history$q$,'42501');
select pg_temp.expect_error($q$select public.marketing_save_rule((select id from public.marketing_rules where code='EXCEL-03'),1,'해제','','{"operator":"required","field":"company"}','error',false,'해제 시도')$q$,'42501');
select pg_temp.expect_error($q$select public.marketing_save_rule(null,null,'오류','','{"operator":"sql","field":"company"}','error',true,'설정 검사')$q$,'22023');
select pg_temp.expect_error($q$select public.marketing_save_rule(null,null,'오류','','{"operator":"one_of","field":"phone","values":null}','error',true,'설정 검사')$q$,'22023');
select pg_temp.expect_error($q$select public.marketing_save_rule(null,null,'오류','','{"operator":"required","field":"notAField"}','error',true,'설정 검사')$q$,'22023');
select set_config('request.jwt.claim.sub','a4e1906d-b915-4e00-9b4e-657beeb396ae',true);
do $$ declare rule public.marketing_rules; sid uuid; checked jsonb; changed jsonb; final jsonb:='{"company":"한빛","name":"김담당","email":"valid@example.test","eco":"Y"}'; cid uuid; begin
 rule:=public.marketing_save_rule(null,null,'Eco ID 필수','Eco 대상의 ID를 확인하세요.','{"operator":"required","field":"ecoId","whenField":"eco","whenValue":"Y"}','error',true,'Eco 자료 품질 보완');
 checked:=public.marketing_validate_rules(final);
 perform pg_temp.assert_true(exists(select 1 from jsonb_array_elements(checked->'violations') v where v->>'id'=rule.id::text and v->>'severity'='error'),'conditional custom rule executes');
 perform pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(public.marketing_validate_rules(final||'{"eco":"N"}')->'violations') v where v->>'id'=rule.id::text),'condition excludes other values');
 perform pg_temp.assert_true(exists(select 1 from jsonb_array_elements(checked->'violations') v where v->>'code'='EXCEL-04' and (v->>'manual')::boolean),'deliverability remains manual');
 perform public.marketing_submit(jsonb_build_array(jsonb_build_object('requestKey','10000000-0000-4000-8000-000000000020','data',final,'validation',jsonb_build_object('kind','확인 필요','ruleCheck',checked))));
 select id into sid from public.marketing_submissions;
 perform pg_temp.assert_true((select result->'ruleCheck'->>'version'=checked->>'version' from public.marketing_validations order by created_at desc limit 1),'validation records preserve ruleset');
 perform pg_temp.expect_error(format('select public.marketing_review(%L,1,''approve'',%L,null,null,null,null,''IT기업'',''확인'',null)',sid,final),'22023');
 perform pg_temp.assert_true((select count(*)=0 from public.marketing_contacts),'blocked approval leaves Master untouched');
 final:=final||'{"ecoId":"E001"}';
 -- Match the core approval's complete normalized final Contact payload.
 select jsonb_object_agg(k,coalesce(final->>k,'')) into final from unnest(array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes']) k;
 checked:=public.marketing_review_check(sid,final,null,null);
 perform pg_temp.assert_true(jsonb_array_length(checked->'blockingErrors')=0,'corrected final passes automatic rules');
 perform pg_temp.expect_error(format('select public.marketing_review(%L,1,''approve'',%L,null,null,null,null,''IT기업'',''확인'',null)',sid,final),'40001');
 rule:=public.marketing_save_rule(rule.id,1,'Eco ID 필수','확정 자료의 ID를 확인하세요.',rule.config,'error',true,'기준 안내 개선');
 changed:=public.marketing_review_check(sid,final,null,null);
 perform pg_temp.assert_true(checked->>'token'<>changed->>'token','rule change invalidates old review token even when values pass');
 perform pg_temp.expect_error(format('select public.marketing_review(%L,1,''approve'',%L,null,null,null,null,''IT기업'',''확인'',%L)',sid,final,jsonb_build_object('token',checked->>'token','reason','확인 근거')),'40001');
 cid:=public.marketing_review(sid,1,'approve',final,null,null,null,null,'IT기업','발송 정제 자료와 소속·Eco 확정 자료 확인',jsonb_build_object('token',changed->>'token','reason','모든 관리 기준 증빙 확인'));
 perform pg_temp.assert_true((select after_data->'reviewCheck'->'ruleCheck'->>'version'=changed->'ruleCheck'->>'version' from public.marketing_review_events where submission_id=sid),'approval audit preserves final applied rules');
 perform pg_temp.assert_true((select count(*)=2 from public.marketing_rule_history where rule_id=rule.id),'rule versions audited');
 perform pg_temp.expect_error(format('select public.marketing_save_rule(%L,1,''오래된 저장'','''',%L,''error'',false,''검증'')',rule.id,rule.config),'40001');
 rule:=public.marketing_save_rule(rule.id,2,rule.title,rule.description,rule.config,'error',false,'추가 규칙 비활성 확인');
 perform pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(public.marketing_validate_rules(final||'{"ecoId":""}')->'violations') v where v->>'id'=rule.id::text),'disabled rules no longer execute');
end $$;
-- Other safe operators and calendar boundaries.
select pg_temp.assert_true(exists(select 1 from jsonb_array_elements(public.marketing_validate_rules('{"confirmedAt":"2026-02-30"}')->'violations') v where v->>'code'='EXCEL-14'),'invalid calendar date');
select public.marketing_save_rule(null,null,'허용 부서','','{"operator":"one_of","field":"ownerDepartment","values":["마케팅실","사업실"]}','error',true,'목록 검사');
select public.marketing_save_rule(null,null,'금지 Eco','','{"operator":"forbidden_values","field":"eco","values":["미확정"]}','error',true,'금지값 검사');
select public.marketing_save_rule(null,null,'직책 길이','','{"operator":"max_length","field":"position","max":3}','warning',true,'길이 검사');
select pg_temp.assert_true((select count(*)=3 from jsonb_array_elements(public.marketing_validate_rules('{"company":"한빛","name":"김담당","email":"valid@example.test","ownerDepartment":"기타","eco":"미확정","position":"1234"}')->'violations') v where v->>'code' like 'CUSTOM-%'),'all safe operators execute');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select pg_temp.assert_true((select count(*)=0 from public.marketing_rules),'blocked administrator cannot read rules');
select pg_temp.expect_error($q$select public.marketing_validate_rules('{}')$q$,'42501');
select pg_temp.expect_error($q$select public.marketing_save_rule(null,null,'무단 추가','','{"operator":"required","field":"phone"}','error',true,'권한 검사')$q$,'42501');
rollback;
