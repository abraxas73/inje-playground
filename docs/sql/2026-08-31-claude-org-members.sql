-- Claude 조직별 멤버·초대 상태 (claude.ai 관리자 설정 > 멤버 화면 스크랩)
-- status: active(활성 멤버) | pending(초대 후 수락 대기) — "노는 시트"(활성인데 사용량 0)와는 다른 축.
-- 실행: Supabase SQL Editor. 재실행 안전.

create table if not exists public.claude_org_members (
  org_id     text not null references public.claude_orgs(id),
  email      text not null,                -- 소문자 정규화
  name       text,                          -- claude.ai 표시 이름(대기 중이면 없을 수 있음)
  role       text,                          -- 주 소유자/소유자/사용자 등 화면 표기 그대로
  seat_tier  text,                          -- Premium/할당되지 않음 등
  status     text not null check (status in ('active', 'pending')),
  synced_at  timestamptz not null default now(),
  primary key (org_id, email)
);
create index if not exists claude_org_members_email_idx on public.claude_org_members (email);
create index if not exists claude_org_members_status_idx on public.claude_org_members (status);

-- RLS: 읽기는 admin만, 쓰기 정책 없음(service role)
do $$
begin
  execute 'alter table public.claude_org_members enable row level security';
  execute 'drop policy if exists claude_org_members_admin_read on public.claude_org_members';
  execute 'create policy claude_org_members_admin_read on public.claude_org_members for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))';
end $$;
