-- Disposable LOCAL database only. Every fixture is rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERT: %',msg; end if; end $$;
insert into auth.users values('46a2400a-f04f-4b78-bd20-e3f75507b154'),('00000000-0000-4000-8000-000000000099');
insert into public.user_profiles values('46a2400a-f04f-4b78-bd20-e3f75507b154','admin','pilot@example.com','허용 관리자'),('00000000-0000-4000-8000-000000000099','admin','other@example.com','차단 관리자');
set local role authenticated;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
select public.marketing_import_master(repeat('d',64),'sort-fixture.xlsx',(select jsonb_agg(jsonb_build_object('dbId','SORT-'||lpad(i::text,3,'0'),'category',case when i<=30 then 'IT기업' else '공공기관' end,'sheet','01_Master_DB','row',i+3,'data',
 (select jsonb_object_agg(k,case when i=45 then '' when k='email' then lpad((46-i)::text,3,'0')||'@example.test' when k='confirmedAt' then ('2026-07-01'::date+(46-i))::text else 'V-'||lpad((46-i)::text,3,'0') end) from unnest(array['company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes']) k),'raw','{}'::jsonb)) from generate_series(1,45) i));
do $$ declare field text; direction text; exported jsonb; joined jsonb; first_id text; begin
 foreach field in array array['category','db_id','company','name','department','position','email','phone','source','sourceSheet','ownerDepartment','eco','ecoId','ecoType','ecoMiddle','ecoSmall','confirmedAt','notes'] loop
  foreach direction in array array['asc','desc'] loop
   exported:=public.marketing_search_contacts('','',false,0,'',null,field,direction);
   joined:=(public.marketing_search_contacts('','',false,0,'',25,field,direction)->'rows')||(public.marketing_search_contacts('','',false,25,'',25,field,direction)->'rows');
   perform pg_temp.assert_true(jsonb_array_length(exported->'rows')=45 and exported->'rows'=joined,field||' '||direction||' global paging equals export');
   first_id:=exported->'rows'->0->>'db_id';
   if field='db_id' then perform pg_temp.assert_true(first_id=case when direction='asc' then 'SORT-001' else 'SORT-045' end,'DB ID order');
   elsif field='category' then
    perform pg_temp.assert_true(first_id=case when direction='asc' then 'SORT-001' else 'SORT-045' end,'category uses displayed organization classification');
   else
    perform pg_temp.assert_true(first_id=case when direction='asc' then 'SORT-044' else 'SORT-001' end,field||' direction');
    perform pg_temp.assert_true(exported->'rows'->44->>'db_id'='SORT-045',field||' blanks last in either direction');
   end if;
   perform pg_temp.assert_true(not (exported->'rows'->0 ? 'sort_value'),'internal sort key not exposed');
  end loop;
 end loop;
 exported:=public.marketing_search_contacts('V-','IT기업',false,0,'V-',null,'name','asc');
 perform pg_temp.assert_true((exported->>'total')::integer=30 and exported->'rows'->0->>'db_id'='SORT-030','filter and sort combined');
 exported:=public.marketing_search_contacts('','',false,0,'',null,'company; drop table marketing_contacts','bogus');
 perform pg_temp.assert_true(exported->'rows'->0->>'db_id'='SORT-001','invalid sort inputs safely default');
end $$;
-- Sort current canonical company name, even when imported Contact spelling differs.
reset role;
update public.marketing_organizations set name='A Canonical' where id=(select organization_id from public.marketing_contacts where db_id='SORT-001');
set local role authenticated;
select pg_temp.assert_true(public.marketing_search_contacts('','',false,0,'',null,'company','asc')->'rows'->0->>'db_id'='SORT-001','canonical company sort');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select pg_temp.assert_true((public.marketing_search_contacts('','',false,0,'',null,'email','desc')->>'total')::integer=0,'RLS still blocks other administrators');
rollback;
