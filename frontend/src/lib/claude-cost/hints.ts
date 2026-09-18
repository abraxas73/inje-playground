/** 비용 관리 화면 지표 설명(헤더 툴팁). 숫자가 왜 그렇게 보이는지 한 곳에 모아 둔다 */
export const BILLED_HINT = "등록한 Anthropic(Stripe) 인보이스의 총액(VAT 포함) 합입니다. \"발행일 기준\"은 인보이스 발행 월에 전액(카드 청구와 같음), \"서비스 기간 일할\"은 서비스 기간(예: 8/23~9/23, 연간은 12개월)을 겹치는 일수 비례로 달마다 나눕니다.";
export const BASIS_ISSUED_HINT = "발행일 기준 — 인보이스 발행 월에 전액. 재무팀이 보는 카드 청구와 같은 숫자.";
export const BASIS_PERIOD_HINT = "서비스 기간 일할 — 인보이스 총액을 서비스 기간이 겹치는 일수 비례로 달마다 나눕니다. 연간 인보이스가 12개월로 펴져 월별 비교가 됩니다. 반올림 잔여는 마지막 달에.";
export const MISSING_HINT = "서비스 기간이 그 달을 덮는 인보이스가 하나도 없는 Team 조직입니다(기간이 없는 장은 발행 월). 연간 플랜 조직은 기간 안이면 누락이 아니고, 월 갱신 조직은 다음 인보이스를 등록하기 전 달부터 누락으로 보입니다.";
export const SEATS_HINT = "그 달에 기여한 인보이스(발행일 기준: 그 달 발행 / 기간 기준: 그 달을 덮는) 중 좌석이 적힌 마지막 장의 좌석 수(조직 합). 좌석 변경이 있으면 프로레이션 라인 중 양수(+) 라인의 수량입니다.";
export const API_COST_HINT = "Anthropic Admin API cost_report로 받은 Claude Console API 사용분(RFP 매핑·마케팅 AI 등)입니다. 대조용이며 청구 합계에는 더하지 않습니다. 값은 30일 동안 사후 보정될 수 있습니다.";
export const EST_COST_HINT = "Claude Code OTel이 보고한 API 환산 추정 비용(cost_usd)의 월합입니다. 좌석제라 실제 청구와 무관한 참고값입니다.";
export const ACTIVE_USERS_HINT = "그 달에 Claude Code 세션·프롬프트·비용이 한 번이라도 기록된 사용자 수(OTel, Team 조직). 채팅만 쓴 사용자는 포함되지 않습니다.";
export const CSV_ACTIVE_HINT = "그 달에 끝나는 멤버 활동 CSV(30일 롤링, 조직별 최신 회차)에서 채팅·Claude Code·Cowork 중 하나라도 있는 멤버 수입니다. CSV가 없는 달은 비어 있습니다.";
export const PER_SEAT_HINT = "청구 총액 ÷ 좌석 수. 좌석이 없는 달은 비어 있습니다.";
export const PER_USER_HINT = "청구 총액 ÷ Claude Code 활성 사용자. 활성 사용자가 0이면 비어 있습니다.";
