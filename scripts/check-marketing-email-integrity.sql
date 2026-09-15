-- LOCAL disposable DB only. Fixtures and mutations roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
create function pg_temp.expect_error(statement text,code text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlstate=code then return; else raise; end if; end; raise exception 'Expected SQLSTATE %',code;
end $$;
insert into auth.users values('46a2400a-f04f-4b78-bd20-e3f75507b154'),('a4e1906d-b915-4e00-9b4e-657beeb396ae'),('00000000-0000-4000-8000-000000000099');
insert into public.user_profiles values('46a2400a-f04f-4b78-bd20-e3f75507b154','admin','pilot@example.com','허용 관리자'),('a4e1906d-b915-4e00-9b4e-657beeb396ae','user','reviewer@example.com','검수자'),('00000000-0000-4000-8000-000000000099','admin','other@example.com','비허용 관리자');
insert into marketing_organizations(id,name,category,review_status) values('10000000-0000-4000-8000-000000000001','검사 회사','IT기업','confirmed');
insert into marketing_contacts(db_id,organization_id,data) select 'EMAIL-'||lpad(i::text,3,'0'),'10000000-0000-4000-8000-000000000001',jsonb_build_object('company','검사 회사','name','담당'||i,'email',i||'@innogrid.com') from generate_series(1,32) i;
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select marketing_email_profile_save('10000000-0000-4000-8000-000000000001',0,1,'https://innogrid.com/',array['innogrid.com'],'공식 연락처 확인');
select pg_temp.assert_true((select count(*)=1 from marketing_email_profile_history),'profile history');
select pg_temp.expect_error($q$select marketing_email_profile_save('10000000-0000-4000-8000-000000000001',0,1,'https://innogrid.com/',array['innogrid.com'],'이전 버전')$q$,'40001');
select set_config('test.email_run',marketing_email_create('20000000-0000-4000-8000-000000000001','filtered','{"category":"IT기업"}','{}')::text,true);
select pg_temp.assert_true(current_setting('test.email_run')=marketing_email_create('20000000-0000-4000-8000-000000000001','filtered','{"category":"IT기업"}','{}')::text,'idempotent creation');
select pg_temp.assert_true((marketing_email_report(current_setting('test.email_run')::uuid)->>'total')::integer=32,'filter targets beyond first page');
select pg_temp.assert_true(jsonb_array_length(marketing_email_report(current_setting('test.email_run')::uuid)->'rows')=25,'report pagination');
select pg_temp.expect_error($q$select marketing_email_claim(null)$q$,'42501');
select pg_temp.expect_error($q$update marketing_email_targets set result='{"state":"pass"}'$q$,'42501');
select pg_temp.expect_error($q$update marketing_email_profiles set domains='{}'$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select pg_temp.assert_true((select count(*)=0 from marketing_email_runs),'non-allowlisted admin cannot read');
select pg_temp.expect_error($q$select marketing_email_create(gen_random_uuid(),'all','{}','{}')$q$,'42501');
reset role;
select set_config('test.email_claim',marketing_email_claim(current_setting('test.email_run')::uuid)::text,true);
select pg_temp.assert_true(jsonb_array_length(current_setting('test.email_claim')::jsonb)=20,'bounded service claim');
-- Force an expired lease, then verify an old worker cannot overwrite the new attempt.
update marketing_email_targets set lease_until=now()-interval '1 second' where contact_id=(current_setting('test.email_claim')::jsonb->0->>'contact_id')::uuid;
select set_config('test.email_reclaim',marketing_email_claim(current_setting('test.email_run')::uuid)::text,true);
select pg_temp.assert_true(not marketing_email_finish(current_setting('test.email_run')::uuid,(current_setting('test.email_claim')::jsonb->0->>'contact_id')::uuid,(current_setting('test.email_claim')::jsonb->0->>'lease')::uuid,'{"state":"pass"}'),'stale lease fenced');
do $$ declare x jsonb; begin
 for x in select value from jsonb_array_elements(current_setting('test.email_claim')::jsonb||current_setting('test.email_reclaim')::jsonb) loop perform marketing_email_finish((x->>'run_id')::uuid,(x->>'contact_id')::uuid,(x->>'lease')::uuid,jsonb_build_object('state',case when x->'snapshot'->>'db_id'='EMAIL-032' then 'error' else 'pass' end)); end loop;
end $$;
select pg_temp.assert_true((select processed=32 and status='completed' from marketing_email_runs where id=current_setting('test.email_run')::uuid),'all targets completed');
select pg_temp.assert_true((select count(*)=32 from marketing_email_results),'fenced worker adds no duplicate result');
select pg_temp.assert_true((select count(*)=32 from marketing_review_events where email_result_id is not null),'accepted results atomically append Master history, stale leases do not');
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select marketing_email_action(current_setting('test.email_run')::uuid,'retry');
select pg_temp.assert_true((select processed=31 and status='queued' from marketing_email_runs where id=current_setting('test.email_run')::uuid),'retry only execution errors');
reset role;
do $$ declare x jsonb; begin for x in select value from jsonb_array_elements(marketing_email_claim(current_setting('test.email_run')::uuid)) loop perform marketing_email_finish((x->>'run_id')::uuid,(x->>'contact_id')::uuid,(x->>'lease')::uuid,'{"state":"review"}'); end loop; end $$;
select pg_temp.assert_true((select count(*)=33 from marketing_email_results),'old error attempt retained');
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select marketing_email_profile_save('10000000-0000-4000-8000-000000000001',1,1,'https://www.innogrid.com/',array['innogrid.com'],'홈페이지 변경 확인');
select pg_temp.assert_true((marketing_email_report(current_setting('test.email_run')::uuid)->'rows'->0->>'stale')::boolean,'profile version marks old evidence stale');
select pg_temp.assert_true((marketing_email_report(current_setting('test.email_run')::uuid)->'rows'->0->'snapshot'->'profile'->>'version')::integer=1,'snapshot retains original approved profile');
select set_config('test.email_selected',marketing_email_create(gen_random_uuid(),'selected','{}',array[(select id from marketing_contacts where db_id='EMAIL-001')])::text,true);
select marketing_email_action(current_setting('test.email_selected')::uuid,'cancel');
select set_config('test.email_rerun',marketing_email_rerun(current_setting('test.email_selected')::uuid,gen_random_uuid())::text,true);
select pg_temp.assert_true((select total=1 from marketing_email_runs where id=current_setting('test.email_rerun')::uuid),'rerun preserves selected scope');
select pg_temp.assert_true((select count(*)=32 from marketing_contacts),'Master unchanged');
-- Master history: retry attempts, snapshot evidence, original dates, backfill, and isolation.
select pg_temp.assert_true((select count(*)=33 from marketing_review_events where email_result_id is not null),'retry appends history without replacing the error');
select pg_temp.assert_true((marketing_email_contact_history((select id from marketing_contacts where db_id='EMAIL-032'))->>'total')::integer=2,'only this Contact attempts, not coworkers');
select pg_temp.assert_true((marketing_email_contact_history((select id from marketing_contacts where db_id='EMAIL-032'))->'rows'->0->>'stale')::boolean,'updated profile marks history stale');
select pg_temp.assert_true((select bool_and(e.created_at=r.created_at and e.validation_snapshot=r.result and e.actor=j.actor and e.actor_name=j.actor_name and e.organization_id is null and e.after_data->'contact'=t.snapshot)
 from marketing_review_events e join marketing_email_results r on r.id=e.email_result_id join marketing_email_runs j on j.id=r.run_id join marketing_email_targets t on t.run_id=r.run_id and t.contact_id=r.contact_id),'actor/time/evidence/snapshot preserved');
select pg_temp.expect_error($q$select marketing_email_record_history(null)$q$,'42501');
select pg_temp.expect_error($q$update marketing_review_events set validation_snapshot='{}' where email_result_id is not null$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select pg_temp.expect_error($q$select marketing_email_contact_history((select id from marketing_contacts limit 1))$q$,'42501');
select pg_temp.assert_true((select count(*)=0 from marketing_review_events),'history hidden from non-allowlisted admin');
reset role;
-- Simulate historical attempts that predate the audit migration, with >1 page per Contact.
insert into marketing_email_results(id,run_id,contact_id,result,created_at)
 select gen_random_uuid(),run_id,contact_id,jsonb_build_object('state','review','message','old attempt '||i),now()-interval '40 days'+i*interval '1 second'
 from marketing_email_targets cross join generate_series(1,23) i where run_id=current_setting('test.email_run')::uuid and snapshot->>'db_id'='EMAIL-001';
delete from marketing_review_events where email_result_id is not null;
select marketing_email_record_history(null);
select marketing_email_record_history(null);
select pg_temp.assert_true((select count(*)=56 from marketing_review_events where email_result_id is not null),'backfill is complete and idempotent');
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select set_config('test.history_contact',(select id::text from marketing_contacts where db_id='EMAIL-001'),true);
select pg_temp.assert_true((marketing_email_contact_history(current_setting('test.history_contact')::uuid)->>'total')::integer=24,'all historical checks counted');
select pg_temp.assert_true(jsonb_array_length(marketing_email_contact_history(current_setting('test.history_contact')::uuid)->'rows')=20 and jsonb_array_length(marketing_email_contact_history(current_setting('test.history_contact')::uuid,2)->'rows')=4,'history page 2 accessible');
select pg_temp.assert_true((marketing_email_contact_history(current_setting('test.history_contact')::uuid)->'rows'->0->>'created_at')::timestamptz=now(),'latest attempt ordered first');
select pg_temp.assert_true(marketing_email_contact_history(gen_random_uuid()) is null,'missing Contact');
reset role;
-- If audit persistence fails, the result and target completion must roll back too.
create function pg_temp.reject_email_audit() returns trigger language plpgsql as $$ begin raise exception 'simulated audit failure' using errcode='P0001'; end $$;
create trigger test_reject_email_audit before insert on marketing_review_events for each row execute function pg_temp.reject_email_audit();
select set_config('test.atomic_claim',marketing_email_claim(current_setting('test.email_rerun')::uuid)::text,true);
select pg_temp.expect_error(format('select marketing_email_finish(%L,%L,%L,%L)',current_setting('test.email_rerun'),current_setting('test.atomic_claim')::jsonb->0->>'contact_id',current_setting('test.atomic_claim')::jsonb->0->>'lease','{"state":"pass"}'),'P0001');
select pg_temp.assert_true((select not processed from marketing_email_targets where run_id=current_setting('test.email_rerun')::uuid),'audit failure rolls back target completion');
select pg_temp.assert_true((select count(*)=0 from marketing_email_results where run_id=current_setting('test.email_rerun')::uuid),'audit failure rolls back result insertion');
rollback;
