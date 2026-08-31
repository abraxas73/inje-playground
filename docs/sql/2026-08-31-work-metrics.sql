-- Claude 활용 성과 측정 — 업무 시스템 일 집계 테이블 (Jira/Confluence/GitLab)
-- 설계: docs/superpowers/specs/2026-08-31-claude-roi-integrations-design.md
-- 실행: Supabase SQL Editor. 재실행 안전. 수집 크론(/api/cron/work-metrics)이 upsert한다.

-- Jira 이슈 일 집계 (사용자×프로젝트×일)
create table if not exists public.jira_issue_daily (
  day             date not null,                 -- KST 기준
  user_email      text not null,                 -- 소문자 회사 이메일 (미확인 시 aid:<accountId>)
  project_key     text not null,
  issues_created  int  not null default 0,
  issues_resolved int  not null default 0,
  lead_hours_sum  numeric not null default 0,    -- 생성→해결 리드타임 합(해결 건)
  cycle_hours_sum numeric not null default 0,    -- 진행 시작→해결 사이클타임 합(changelog 기반)
  cycle_count     int  not null default 0,
  story_points    numeric not null default 0,
  primary key (day, user_email, project_key)
);
create index if not exists jira_issue_daily_email_idx on public.jira_issue_daily (user_email, day desc);

-- Atlassian accountId ↔ 이메일 매핑 (GDPR 모드로 이메일이 가려진 사용자 보정)
create table if not exists public.atlassian_account_map (
  account_id text primary key,
  email      text not null,
  updated_at timestamptz not null default now()
);

-- Confluence 문서 일 집계
create table if not exists public.confluence_daily (
  day           date not null,
  user_email    text not null,
  space_key     text not null,
  pages_created int  not null default 0,
  pages_updated int  not null default 0,
  primary key (day, user_email, space_key)
);
create index if not exists confluence_daily_email_idx on public.confluence_daily (user_email, day desc);

-- GitLab 커밋·MR 일 집계 (Claude 경유 비중의 분모)
create table if not exists public.gitlab_daily (
  day                date not null,
  user_email         text not null,
  project_path       text not null,
  commits            int  not null default 0,
  mrs_opened         int  not null default 0,
  mrs_merged         int  not null default 0,
  mr_lead_hours_sum  numeric not null default 0, -- MR 생성→머지 리드타임 합(머지 건)
  primary key (day, user_email, project_path)
);
create index if not exists gitlab_daily_email_idx on public.gitlab_daily (user_email, day desc);

-- 수집 이력(진단용): 소스별 마지막 수집·행수·오류
create table if not exists public.work_metrics_sync (
  id         bigint generated always as identity primary key,
  source     text not null,                      -- jira | confluence | gitlab
  range_from date not null,
  range_to   date not null,
  rows       int  not null default 0,
  ok         boolean not null default true,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists work_metrics_sync_source_idx on public.work_metrics_sync (source, created_at desc);

-- RLS: 서버(service_role)만 쓰기, 관리자 세션 읽기 허용(진단용).
-- 개인/팀장 조회는 API가 service_role로 범위를 계산해 내려주므로 사용자 정책은 두지 않는다.
do $$
declare t text;
begin
  foreach t in array array['jira_issue_daily','atlassian_account_map','confluence_daily','gitlab_daily','work_metrics_sync'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_admin_read on public.%I', t, t);
    execute format('create policy %I_admin_read on public.%I for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))', t, t);
  end loop;
end $$;
