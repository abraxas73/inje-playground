-- Apply after marketing-master.sql. Restricted pilot: 강승억, 김하연.
-- Stable account IDs prevent display-name changes or duplicate names granting access.
begin;
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select case when p_page='marketing' then p.role in ('user','admin') and p.user_id in ('46a2400a-f04f-4b78-bd20-e3f75507b154'::uuid,'a4e1906d-b915-4e00-9b4e-657beeb396ae'::uuid) else p.role='admin' or (p_page in ('food','ladder','team','survey','usage_code','usage_chat','usage_perf','rfp','people_news','guide','marketing')
 and (p.role='user' or (p.role='guest' and p_page in ('food','ladder','team','survey')))
 and coalesce((a.permissions->>p_page)::boolean,true)) end from public.user_profiles p left join public.user_page_access a on a.user_id=p.user_id where p.user_id=auth.uid()),false);
$$;

commit;
