-- User-authorized operational setup: 김하연 gets marketing review permission only.
-- Run after marketing-completion.sql; keep the two-account page allowlist unchanged.
begin;
do $$ begin
 if not exists(select 1 from public.user_profiles where user_id='a4e1906d-b915-4e00-9b4e-657beeb396ae' and email='hyk@innogrid.com' and display_name='김하연' and role='user') then
  raise exception 'Reviewer account does not match the approved identity';
 end if;
 if not exists(select 1 from public.user_profiles where user_id='46a2400a-f04f-4b78-bd20-e3f75507b154' and email='seunguk.kang@innogrid.com' and role='admin') then
  raise exception 'Requesting administrator identity mismatch';
 end if;
end $$;
select set_config('request.jwt.claim.sub','46a2400a-f04f-4b78-bd20-e3f75507b154',true);
do $$ begin
 if not exists(select 1 from public.marketing_reviewers where user_id='a4e1906d-b915-4e00-9b4e-657beeb396ae') then
  perform public.marketing_set_reviewer('a4e1906d-b915-4e00-9b4e-657beeb396ae',true);
 end if;
end $$;
commit;
