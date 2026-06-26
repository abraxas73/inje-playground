// Phase 1 범위: is_user 단일 정의만 제공한다.
// KPI 레지스트리/순수 산식(npsFromScores 등)은 분석 대시보드 Phase에서 이 파일에 append한다.
// 아래 isUserResponse는 단일 출처이며(중복 정의 금지) value-key 기준으로만 판정한다.

// S0Q3 '사용한 적 없음' = "never", S0Q4 '거의 사용 안 함' = "rarely" (시드 옵션 value 규약)
export function isUserResponse(args: {
  s0q3_value: string | null;
  s0q4_value: string | null;
}): boolean {
  if (args.s0q3_value === "never") return false;
  if (args.s0q4_value === "rarely") return false;
  return true;
}
