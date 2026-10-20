-- 2026-10-20: 제안도우미-일반현황(스펙 docs/superpowers/specs/2026-10-20-proposal-general-design.md)
-- ① 페이지 권한 키 proposal 추가(이전 목록은 2026-10-15-chat-portal.sql — 드리프트 테스트는 이제 이 파일을 읽는다)
-- ② 일반현황 PPT 버전 proposal_profiles, 생성 이력 proposal_jobs. 읽기·쓰기는 서버 API(service role)만 — RLS 켜고 정책 없음.
begin;
create or replace function public.valid_page_permissions(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p)<>'object' then false else not exists
 (select 1 from jsonb_each(p) e where e.key not in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','marketing','guide','mcp','gw_mail','dooray','assistant','proposal') or jsonb_typeof(e.value)<>'boolean') end;
$$;
create or replace function public.has_page_access(p_page text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select case
      when p_page = 'marketing' then
        public.marketing_access_account(p.user_id)
        or (p.role in ('user', 'admin') and coalesce((a.permissions->>'marketing')::boolean, false))
      else p.role = 'admin' or (
        p_page in ('food','ladder','team','survey','apps','usage_code','usage_chat','usage_perf','teams_chat','jira','confluence','sharepoint','rfp','ppt','people_news','guide','mcp','gw_mail','dooray','assistant','proposal')
        and (p.role = 'user' or (p.role = 'guest' and p_page in ('food','ladder','team','survey')))
        and coalesce((a.permissions->>p_page)::boolean, true))
    end
    from public.user_profiles p left join public.user_page_access a on a.user_id = p.user_id
    where p.user_id = auth.uid()), false);
$$;

create table if not exists public.proposal_profiles (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 100),
  as_of date,
  storage_path text not null,
  file_name text not null,
  slide_count integer not null check (slide_count between 1 and 80),
  uploaded_by uuid not null references auth.users(id),
  uploader_name text,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists proposal_profiles_latest_idx on public.proposal_profiles (hidden, created_at desc);
comment on table public.proposal_profiles is '회사 일반현황 PPT 버전 — 숨기기만(옛 결과가 참조), 최신 = 숨기지 않은 것 중 created_at 최댓값';

create table if not exists public.proposal_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_name text,
  project_name text not null check (length(btrim(project_name)) between 1 and 100),
  profile_id uuid not null references public.proposal_profiles(id),
  template_path text not null,
  template_name text not null,
  mode text not null check (mode in ('restyle', 'reflow')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  result_path text,
  slide_count integer,
  error text,
  share_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists proposal_jobs_owner_idx on public.proposal_jobs (owner_id, created_at desc);
create index if not exists proposal_jobs_shared_idx on public.proposal_jobs (created_at desc) where share_enabled;
comment on table public.proposal_jobs is '제안도우미-일반현황 생성 이력. share_enabled면 메뉴 권한 있는 누구나 목록·상세·다운로드';

alter table public.proposal_profiles enable row level security;
alter table public.proposal_jobs enable row level security;
revoke all on public.proposal_profiles, public.proposal_jobs from anon, authenticated;
commit;
