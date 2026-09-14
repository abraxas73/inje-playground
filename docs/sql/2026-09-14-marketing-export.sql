-- Extend the existing RLS-protected search; null limit exports the entire snapshot.
begin;
drop function if exists public.marketing_search_contacts(text,text,boolean,integer,text);
create or replace function public.marketing_search_contacts(p_q text,p_category text,p_issues boolean,p_offset integer,p_department text default '',p_limit integer default 25)
returns jsonb language sql stable security invoker set search_path='' as $$
 with matched as (select c.*,to_jsonb(o) as organization, (c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))='') as needs_maintenance from public.marketing_contacts c left join public.marketing_organizations o on o.id=c.organization_id
 where (coalesce(p_q,'')='' or position(lower(p_q) in lower(concat_ws(' ',c.db_id,c.data->>'name',c.data->>'email',c.data->>'company',o.name)))>0)
 and (coalesce(p_department,'')='' or position(lower(p_department) in lower(coalesce(c.data->>'ownerDepartment','')))>0)
 and (coalesce(p_category,'')='' or o.category=p_category)
 and (not coalesce(p_issues,false) or c.organization_id is null or o.category='확인 필요' or btrim(coalesce(c.data->>'name',''))='' or btrim(coalesce(c.data->>'company',''))=''))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from matched order by db_id offset greatest(0,p_offset) limit case when p_limit is null then null else greatest(1,least(1000,p_limit)) end) t),'[]'), 'total',(select count(*) from matched),'pageSize',p_limit);
$$;
revoke all on function public.marketing_search_contacts(text,text,boolean,integer,text,integer) from public,anon;
grant execute on function public.marketing_search_contacts(text,text,boolean,integer,text,integer) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
