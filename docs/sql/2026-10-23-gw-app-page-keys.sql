-- 2026-10-23: 아마란스 앱 기능 7개를 관리자 페이지 권한으로 끄고 켤 수 있게 키 추가
-- gw_approvals(미결 결재)·gw_attendance(출퇴근)·gw_today(일정)·gw_board(게시판)·gw_messenger(메신저)·gw_notes(쪽지)·gw_attend(오늘 근태)
-- 앱 mobile/lib/more/catalog.dart appPages와 같은 키, 웹 lib/page-access.ts PAGES(group "gw", 메뉴 숨김)와 같은 목록.
-- 두 함수는 2026-10-20-proposal-general.sql 정의 그대로에 키만 더했다(기존 키를 빼면 운영 저장값이 Invalid permissions) — 드리프트 테스트는 이제 이 파일을 읽는다.
begin;
create or replace function public.valid_page_permissions(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p)<>'object' then false else not exists
 (select 1 from jsonb_each(p) e where e.key not in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','marketing','guide','mcp','gw_mail','gw_approvals','gw_attendance','gw_today','gw_board','gw_messenger','gw_notes','gw_attend','dooray','assistant','proposal') or jsonb_typeof(e.value)<>'boolean') end;
$$;
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select case
      when p_page = 'marketing' then
        public.marketing_access_account(p.user_id)
        or (p.role in ('user', 'admin') and coalesce((a.permissions->>'marketing')::boolean, false))
      else p.role = 'admin' or (
        p_page in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','guide','mcp','gw_mail','gw_approvals','gw_attendance','gw_today','gw_board','gw_messenger','gw_notes','gw_attend','dooray','assistant','proposal')
        and (p.role = 'user' or (p.role = 'guest' and p_page in ('food','ladder','team','survey')))
        and coalesce((a.permissions->>p_page)::boolean, true))
    end
    from public.user_profiles p left join public.user_page_access a on a.user_id = p.user_id
    where p.user_id = auth.uid()), false);
$$;
commit;
