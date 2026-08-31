-- Claude Code 사용자 프롬프트 내용 (user_prompt 이벤트 본문)
-- 전제: 관리형 설정에 OTEL_LOG_USER_PROMPTS=1 을 추가하고 구성원에게 "프롬프트 내용 수집"을 재공지한 뒤 사용한다.
-- 실행: Supabase SQL Editor. 재실행 안전. 실행 전에는 수집이 조용히 건너뛴다(과거 소급 없음).

create table if not exists public.claude_code_prompts (
  id            bigint generated always as identity primary key,
  ts            timestamptz not null,
  org_id        text not null,
  user_email    text not null,
  account_uuid  text,
  session_id    text,
  prompt_length int,
  prompt        text not null              -- 파서가 4000자에서 자른다(대형 붙여넣기 방지)
);
create index if not exists claude_code_prompts_ts_idx on public.claude_code_prompts (ts desc);
create index if not exists claude_code_prompts_email_idx on public.claude_code_prompts (user_email, ts desc);

do $$
begin
  execute 'alter table public.claude_code_prompts enable row level security';
  execute 'drop policy if exists claude_code_prompts_admin_read on public.claude_code_prompts';
  execute 'create policy claude_code_prompts_admin_read on public.claude_code_prompts for select to authenticated using (exists (select 1 from public.user_profiles up where up.user_id = auth.uid() and up.role = ''admin''))';
end $$;

-- 보존 정책(수동): 필요 시 오래된 내용 삭제
-- delete from claude_code_prompts where ts < now() - interval '90 days';
