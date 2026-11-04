/**
 * Claude Code 프롬프트 내용(claude_code_prompts)은 민감해서 운영 담당자 한 명만 본다.
 * 페이지 권한 관리(page-access)로 바꿀 수 없게 코드에 고정 — 바꾸려면 이 값과 RLS(docs/sql/2026-11-04-claude-code-prompts-owner.sql)를 함께.
 */
export const PROMPTS_OWNER_EMAIL = "seunguk.kang@innogrid.com";

export const isPromptsOwner = (email: string | null | undefined) => email?.toLowerCase() === PROMPTS_OWNER_EMAIL;
