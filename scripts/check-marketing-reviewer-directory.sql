-- LOCAL disposable database only; everything rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
create function pg_temp.expect_error(statement text,code text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlstate=code then return; else raise; end if; end; raise exception 'Expected SQLSTATE %',code;
end $$;
insert into auth.users values('46a2400a-f04f-4b78-bd20-e3f75507b154'),('a4e1906d-b915-4e00-9b4e-657beeb396ae'),('00000000-0000-4000-8000-000000000099');
insert into public.user_profiles values('46a2400a-f04f-4b78-bd20-e3f75507b154','admin','admin@example.com','관리자'),('a4e1906d-b915-4e00-9b4e-657beeb396ae','user','reviewer@example.com','담당자'),('00000000-0000-4000-8000-000000000099','admin','outside@example.com','비허용 관리자');
insert into public.marketing_reviewers values('46a2400a-f04f-4b78-bd20-e3f75507b154'),('a4e1906d-b915-4e00-9b4e-657beeb396ae');
select pg_temp.assert_true(public.marketing_reviewer_details('46a2400a-f04f-4b78-bd20-e3f75507b154')->>'grantedAt' is null,'no invented date for missing legacy audit');
insert into public.marketing_review_events(actor,actor_name,action,reason,after_data,created_at)
 select '46a2400a-f04f-4b78-bd20-e3f75507b154','과거 처리자','검수 권한 변경','검수자 지정',jsonb_build_object('userId',user_id,'enabled',true),'2026-09-14T01:23:00Z' from marketing_reviewers;
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select pg_temp.assert_true((marketing_reviewer_directory()->>'canManage')::boolean,'admin can manage');
select pg_temp.assert_true(jsonb_array_length(marketing_reviewer_directory()->'rows')=2,'only pilot accounts are candidates');
select pg_temp.assert_true((select bool_and(x->>'grantedBy'='과거 처리자' and (x->>'grantedAt')::timestamptz='2026-09-14T01:23:00Z') from jsonb_array_elements(marketing_reviewer_directory()->'rows') x),'legacy actor and time preserved');
select set_config('test.reviewer_admin_version',(select x->>'version' from jsonb_array_elements(marketing_reviewer_directory()->'rows') x where x->>'role'='admin'),true);
select set_config('test.reviewer_version',(select x->>'version' from jsonb_array_elements(marketing_reviewer_directory()->'rows') x where x->>'role'='user'),true);
select marketing_update_reviewer('46a2400a-f04f-4b78-bd20-e3f75507b154',false,current_setting('test.reviewer_admin_version'));
select pg_temp.assert_true(marketing_can_review(),'removing explicit admin assignment retains effective review');
select marketing_update_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',false,current_setting('test.reviewer_version'));
select pg_temp.expect_error(format('select marketing_update_reviewer(%L,true,%L)','a4e1906d-b915-4e00-9b4e-657beeb396ae',current_setting('test.reviewer_version')),'40001');
select pg_temp.assert_true((marketing_reviewer_directory()->>'total')::integer=4,'two changes appended exactly once');
select marketing_set_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',false);
select pg_temp.assert_true((marketing_reviewer_directory()->>'total')::integer=4,'legacy no-op does not fabricate a new grant time');
select pg_temp.expect_error($q$select marketing_set_reviewer('00000000-0000-4000-8000-000000000099',true)$q$,'42501');
select pg_temp.expect_error($q$select marketing_change_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',true,null)$q$,'42501');
select pg_temp.expect_error($q$select marketing_reviewer_details('a4e1906d-b915-4e00-9b4e-657beeb396ae')$q$,'42501');
select pg_temp.expect_error($q$insert into marketing_reviewers values('00000000-0000-4000-8000-000000000099')$q$,'42501');
select set_config('request.jwt.claim.sub','a4e1906d-b915-4e00-9b4e-657beeb396ae',true);
select pg_temp.assert_true(not marketing_can_review(),'non-admin loses review after revoke');
select pg_temp.assert_true(not (marketing_reviewer_directory()->>'canManage')::boolean and jsonb_array_length(marketing_reviewer_directory()->'rows')=2,'submitter can see reviewers but cannot manage');
select pg_temp.expect_error($q$select marketing_set_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',true)$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select pg_temp.expect_error('select marketing_reviewer_directory()','42501');
select pg_temp.expect_error($q$select marketing_set_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',true)$q$,'42501');
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select set_config('test.reviewer_version',(select x->>'version' from jsonb_array_elements(marketing_reviewer_directory()->'rows') x where x->>'role'='user'),true);
select set_config('test.reviewer_result',marketing_update_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',true,current_setting('test.reviewer_version'))::text,true);
select pg_temp.assert_true((current_setting('test.reviewer_result')::jsonb->'row'->>'canReview')::boolean and current_setting('test.reviewer_result')::jsonb->'row'->>'grantedBy'='관리자','grant response reflects current state and actor');
select pg_temp.assert_true((current_setting('test.reviewer_result')::jsonb->'row'->>'grantedAt')::timestamptz>='2026-09-15T00:00:00Z','new grant timestamp recorded');
reset role;
-- Audit persistence failure must roll back the privilege mutation.
create function pg_temp.reject_reviewer_event() returns trigger language plpgsql as $$ begin raise exception 'simulated audit failure' using errcode='P0001'; end $$;
create trigger test_reject_reviewer_event before insert on marketing_review_events for each row execute function pg_temp.reject_reviewer_event();
set local role authenticated;
select pg_temp.expect_error($q$select marketing_set_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',false)$q$,'P0001');
select pg_temp.assert_true((select exists(select 1 from marketing_reviewers where user_id='a4e1906d-b915-4e00-9b4e-657beeb396ae')),'audit failure leaves grant unchanged');
reset role;
drop trigger test_reject_reviewer_event on marketing_review_events;
insert into marketing_review_events(actor_name,action,reason,after_data,created_at)
 select '과거 처리자','검수 권한 변경','과거 이력',jsonb_build_object('userId','a4e1906d-b915-4e00-9b4e-657beeb396ae','enabled',true),now()-interval '10 days'+i*interval '1 second' from generate_series(1,20) i;
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(marketing_reviewer_directory()->'history')=20 and jsonb_array_length(marketing_reviewer_directory(2)->'history')=5,'complete history pagination');
select pg_temp.assert_true((marketing_reviewer_directory()->'history'->0->>'enabled')::boolean,'newest history ordered first');
rollback;
