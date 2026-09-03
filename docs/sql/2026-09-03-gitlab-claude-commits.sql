-- GitLab 커밋 집계 보강 (2026-09-03) — Supabase SQL Editor에서 실행(멱등)
-- 1) claude_commits: 커밋 메시지에 "Co-Authored-By: Claude" 트레일러가 있는 커밋 수.
--    gitlab_daily.commits의 부분집합이므로 "Claude 경유 비중 = claude_commits / commits"가 항상 0~100%.
--    트레일러를 끈 사용자(includeCoAuthoredBy=false)는 잡히지 않아 하한값이다.
alter table public.gitlab_daily add column if not exists claude_commits int not null default 0;

-- 2) 커미터 이메일 수동 매핑(raw author_email → 회사 이메일).
--    규칙(오타 도메인·로컬파트 일치, lib/work-metrics/email-resolve.ts)으로 못 잡는 개인 이메일용.
--    예) insert into gitlab_email_map values ('someone@gmail.com', 'someone.kim@innogrid.com', '본인 확인');
--    반영은 다음 수집(로컬 gitlab-metrics-sync.py 백필)부터.
create table if not exists public.gitlab_email_map (
  raw_email  text primary key,
  email      text not null,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.gitlab_email_map enable row level security;
drop policy if exists gitlab_email_map_admin_read on public.gitlab_email_map;
create policy gitlab_email_map_admin_read on public.gitlab_email_map for select to authenticated
  using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = 'admin'));
