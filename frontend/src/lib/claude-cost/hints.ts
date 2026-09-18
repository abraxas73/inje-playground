/** 비용 관리 화면 지표 설명(헤더 툴팁). 숫자가 왜 그렇게 보이는지 한 곳에 모아 둔다 */
export const BILLED_HINT = "등록한 Anthropic(Stripe) 인보이스의 총액(VAT 포함) 합입니다. 월은 인보이스 발행일 기준이라 서비스 기간(예: 8/23~9/23)과 다를 수 있습니다.";
export const SEATS_HINT = "그 달에 발행된 인보이스 중 좌석이 적힌 마지막 장의 좌석 수(조직 합). 좌석 변경이 있으면 프로레이션 라인 중 양수(+) 라인의 수량입니다.";
export const API_COST_HINT = "Anthropic Admin API cost_report로 받은 Claude Console API 사용분(RFP 매핑·마케팅 AI 등)입니다. 대조용이며 청구 합계에는 더하지 않습니다. 값은 30일 동안 사후 보정될 수 있습니다.";
export const EST_COST_HINT = "Claude Code OTel이 보고한 API 환산 추정 비용(cost_usd)의 월합입니다. 좌석제라 실제 청구와 무관한 참고값입니다.";
export const ACTIVE_USERS_HINT = "그 달에 Claude Code 세션·프롬프트·비용이 한 번이라도 기록된 사용자 수(OTel, Team 조직). 채팅만 쓴 사용자는 포함되지 않습니다.";
export const CSV_ACTIVE_HINT = "그 달에 끝나는 멤버 활동 CSV(30일 롤링, 조직별 최신 회차)에서 채팅·Claude Code·Cowork 중 하나라도 있는 멤버 수입니다. CSV가 없는 달은 비어 있습니다.";
export const PER_SEAT_HINT = "청구 총액 ÷ 좌석 수. 좌석이 없는 달은 비어 있습니다.";
export const PER_USER_HINT = "청구 총액 ÷ Claude Code 활성 사용자. 활성 사용자가 0이면 비어 있습니다.";
