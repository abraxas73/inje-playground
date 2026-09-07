/**
 * Claude Code 사용량 지표 설명(화면 툴팁). 값이 0으로 보이는 이유를 화면에서 알 수 있게 한 곳에 모아 둔다.
 * 2026-09-07 점검: 라인·편집 수락 지표는 Edit·Write 도구가 파일을 실제로 고칠 때만 OTel로 오므로,
 * Bash(sed·heredoc)나 MCP 도구로 고치는 사용자, SDK·API 키 실행은 0으로 남는다(193명 중 70명).
 */
export const LOC_HINT =
  "Claude Code의 Edit·Write 도구가 실제로 적용한 추가/삭제 줄 수입니다. Bash(sed·heredoc·스크립트) 편집, MCP 도구 편집, SDK·API 키 실행, 읽기·질문만 한 사용은 집계되지 않아 0으로 보입니다.";
export const EDIT_ACCEPT_HINT =
  "Edit·Write 도구 제안을 사용자가 수락/거절한 횟수입니다. 라인 수와 같은 조건(편집 도구를 거친 변경)에서만 집계됩니다.";
