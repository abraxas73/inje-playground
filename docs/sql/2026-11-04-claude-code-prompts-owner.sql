-- Claude Code 프롬프트 내용은 운영 담당자 한 명만 읽는다(관리자 전체 → seunguk.kang).
-- 앱 코드 lib/claude-usage/prompts-owner.ts PROMPTS_OWNER_EMAIL과 같은 값. 쓰기는 service role(수집)만.
drop policy if exists claude_code_prompts_admin_read on public.claude_code_prompts;
drop policy if exists claude_code_prompts_owner_read on public.claude_code_prompts;
create policy claude_code_prompts_owner_read on public.claude_code_prompts for select to authenticated
  using (lower(auth.jwt() ->> 'email') = 'seunguk.kang@innogrid.com');
