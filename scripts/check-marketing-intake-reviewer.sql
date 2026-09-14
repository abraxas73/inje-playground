-- Disposable local PostgreSQL only. All fixtures and grants are rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
insert into auth.users values('46a2400a-f04f-4b78-bd20-e3f75507b154'),('a4e1906d-b915-4e00-9b4e-657beeb396ae');
insert into public.user_profiles values('46a2400a-f04f-4b78-bd20-e3f75507b154','admin','admin@test.example','관리자'),('a4e1906d-b915-4e00-9b4e-657beeb396ae','user','reviewer@test.example','검수 담당자');
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select public.marketing_set_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',true);
select set_config('request.jwt.claim.sub','a4e1906d-b915-4e00-9b4e-657beeb396ae',true);
select pg_temp.assert_true(public.marketing_can_review(),'designated user can review without admin role');
select public.marketing_submit('[{"requestKey":"30000000-0000-4000-8000-000000000001","processing":true,"data":{"company":"테스트","email":"bad"},"source":{"file":"fixture.xlsx","row":2,"raw":{"성명":"","이메일":"bad"}},"validation":{"kind":"확인 필요","errors":["성명 누락","이메일 형식 오류"]}}]');
do $$ declare sid uuid; cid uuid; begin
 select id into sid from public.marketing_submissions limit 1;
 perform public.marketing_finish_validation(sid,'{"kind":"확인 필요","errors":["성명 누락","이메일 형식 오류"]}');
 perform pg_temp.assert_true((select status='pending' and validation->>'kind'='확인 필요' and source->'raw'->>'이메일'='bad' from public.marketing_submissions where id=sid),'invalid Contact and original source retained in review queue');
 begin
  perform public.marketing_review(sid,2,'approve','{"company":"테스트","email":"bad"}',null,null,null,null,'IT기업','확인 완료');
  raise exception 'Invalid final data approved';
 exception when invalid_parameter_value then null;
 end;
 perform pg_temp.assert_true((select count(*)=0 from public.marketing_contacts),'invalid final values do not reach Master');
 perform pg_temp.assert_true((select status='pending' from public.marketing_submissions where id=sid),'failed approval remains pending');
 cid:=public.marketing_review(sid,2,'approve','{"company":"테스트","name":"담당자","email":"valid@example.test"}',null,null,null,null,'IT기업','누락 정보 및 이메일 확인');
 perform pg_temp.assert_true((select count(*)=1 from public.marketing_contacts),'corrected submission can be approved by designated reviewer');
 perform pg_temp.assert_true((select source->'raw'->>'이메일'='bad' and actor=auth.uid() and contact_id=cid from public.marketing_review_events where submission_id=sid),'reviewer identity and original invalid email remain auditable');
end $$;
rollback;
\echo 'Intake/reviewer SQL checks passed; fixtures rolled back.'
