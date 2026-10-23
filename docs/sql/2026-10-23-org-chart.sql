-- 2026-10-23: 조직도(/org, 페이지 키 org_chart) — 부서 트리 테이블 + 페이지 권한 키
-- 부서 트리는 GitHub Actions(.github/workflows/gw-directory-sync.yml)가 연동 계정으로 아마란스 gw102A01을 받아
-- POST /api/admin/directory/sync 의 departments로 보낸다. 사람은 기존 company_directory 그대로.
-- 읽기는 서버(service role)만 — GET /api/directory/org가 org_chart 권한을 확인한 뒤 내려준다(휴대폰 번호는 저장하지 않음).
-- 권한 함수는 2026-10-23-gw-app-page-keys.sql 정의 그대로에 org_chart만 더했다 — 드리프트 테스트는 이제 이 파일을 읽는다.

create table if not exists public.company_departments (
  id         text primary key,                 -- 아마란스 부서 id(gw102A01 treeList.id)
  parent_id  text,                             -- 상위 부서 id(회사 루트면 null)
  name       text not null,
  path       text,                             -- 원본 id 경로 "1000|20|"
  sort       int not null default 0,           -- 아마란스 트리 순서
  depth      int not null default 0,           -- 회사 루트 0
  active     boolean not null default true,    -- 최근 동기화에 없으면 false
  synced_at  timestamptz not null default now()
);
create index if not exists company_departments_parent_idx on public.company_departments (parent_id);
alter table public.company_departments enable row level security; -- 정책 없음: service role만

begin;
create or replace function public.valid_page_permissions(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p)<>'object' then false else not exists
 (select 1 from jsonb_each(p) e where e.key not in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','marketing','guide','mcp','gw_mail','gw_approvals','gw_attendance','gw_today','gw_board','gw_messenger','gw_notes','gw_attend','dooray','assistant','proposal','org_chart') or jsonb_typeof(e.value)<>'boolean') end;
$$;
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select case
      when p_page = 'marketing' then
        public.marketing_access_account(p.user_id)
        or (p.role in ('user', 'admin') and coalesce((a.permissions->>'marketing')::boolean, false))
      else p.role = 'admin' or (
        p_page in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','guide','mcp','gw_mail','gw_approvals','gw_attendance','gw_today','gw_board','gw_messenger','gw_notes','gw_attend','dooray','assistant','proposal','org_chart')
        and (p.role = 'user' or (p.role = 'guest' and p_page in ('food','ladder','team','survey')))
        and coalesce((a.permissions->>p_page)::boolean, true))
    end
    from public.user_profiles p left join public.user_page_access a on a.user_id = p.user_id
    where p.user_id = auth.uid()), false);
$$;
commit;
