-- 2026-10-11: 페이지 권한 키 목록을 웹 카탈로그(frontend/src/lib/page-access.ts PAGES)와 맞춘다.
-- 2026-09-14 이후 카탈로그에 추가된 apps·teams_chat·jira·confluence·sharepoint·ppt·mcp가 DB 함수에 없어
-- 관리자 "페이지 접근 권한" 저장이 'Invalid permissions'(22023)로 실패했다. 아마란스 메일(gw_mail) 키도 추가.
-- 규칙: PAGES에 키를 넣으면 이 두 함수의 목록도 같이 갱신한다(테스트 frontend/src/lib/__tests__/page-access-sql-sync.test.ts가 이 파일을 읽어 대조).
begin;
create or replace function public.valid_page_permissions(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p)<>'object' then false else not exists
 (select 1 from jsonb_each(p) e where e.key not in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','marketing','guide','mcp','gw_mail') or jsonb_typeof(e.value)<>'boolean') end;
$$;
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select case
      when p_page = 'marketing' then
        public.marketing_access_account(p.user_id)
        or (p.role in ('user', 'admin') and coalesce((a.permissions->>'marketing')::boolean, false))
      else p.role = 'admin' or (
        p_page in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','guide','mcp','gw_mail')
        and (p.role = 'user' or (p.role = 'guest' and p_page in ('food','ladder','team','survey')))
        and coalesce((a.permissions->>p_page)::boolean, true))
    end
    from public.user_profiles p left join public.user_page_access a on a.user_id = p.user_id
    where p.user_id = auth.uid()), false);
$$;
commit;
