/**
 * user_prompt 이벤트를 사람이 친 프롬프트와 자동화(플러그인·스크립트가 보낸) 프롬프트로 나눈다.
 * 내용(OTEL_LOG_USER_PROMPTS=1)이 있을 때만 판별 가능하고, 없으면 "human"으로 둔다(사람 프롬프트 수는 상한).
 * 패턴은 docs/sql/2026-09-03-claude-code-prompt-kind.sql 의 소급 분류와 같게 유지할 것.
 *
 * - claude-mem 플러그인: 주 세션의 도구 호출마다 관찰자(memory agent) 세션에 <observed_from_primary_session> 프롬프트를,
 *   요청 종료 시 "--- MODE SWITCH: PROGRESS SUMMARY ---", 관찰자 (재)시작 시 "You are a Claude-Mem…"/"Hello memory agent…"를 보낸다.
 * - "reply with: ok": 주기 실행 헬스체크 류.
 */
export type PromptKind = "human" | "automation";

export const AUTOMATION_PROMPT_PATTERNS: ReadonlyArray<{ source: string; test: (t: string) => boolean }> = [
  { source: "claude-mem observer", test: (t) => t.startsWith("<observed_from_primary_session>") },
  { source: "claude-mem system", test: (t) => t.startsWith("You are a Claude-Mem") },
  { source: "claude-mem resume", test: (t) => t.startsWith("Hello memory agent") },
  { source: "claude-mem summary", test: (t) => t.startsWith("--- MODE SWITCH") },
  { source: "heartbeat", test: (t) => t.trim().toLowerCase() === "reply with: ok" },
];

export function classifyPrompt(text: string | null | undefined): PromptKind {
  if (!text) return "human";
  const t = text.trimStart();
  return AUTOMATION_PROMPT_PATTERNS.some((p) => p.test(t)) ? "automation" : "human";
}
