# Claude 비용 관리 런북

`/admin/claude-cost` — 월별 실제 청구(Anthropic 인보이스) + Admin API cost_report + 사용량(OTel·CSV). 설계 `docs/superpowers/specs/2026-09-18-claude-cost-design.md`, 계획 `docs/superpowers/plans/2026-09-18-claude-cost.md`.

## 1. 최초 설정 (1회)
1. SQL `docs/sql/2026-09-18-claude-cost.sql` 실행 — 테이블 `claude_invoices`·`claude_invoice_lines`·`claude_api_cost_daily`, Storage 버킷 `claude-invoices`(비공개 2MB).
2. (선택) Claude Console > Settings > Admin keys에서 Admin API 키(`sk-ant-admin01-…`) 발급 → Vercel env `CLAUDE_ADMIN_API_KEY`. 없으면 "API 비용" 탭이 보이지 않는다. Admin API는 Console 조직의 **API 사용분**만 준다 — claude.ai Team 좌석 구독료는 어떤 API에도 없다(인보이스로만).
3. `vercel.json` cron `/api/cron/claude-cost`(23:00 UTC = 08:00 KST)은 배포와 함께 등록된다. `CRON_SECRET`은 기존 값을 쓴다.

## 2. 매달 인보이스 등록 (조직 7개, 1분)
1. 결제 메일(Anthropic, PBC / Stripe)의 "View invoice" 링크 7개를 복사한다 — `https://invoice.stripe.com/i/acct_…/live_…?s=ap`. 서버는 이 링크를 `https://pay.stripe.com/invoice/…/pdf`로 바꿔 PDF를 인증 없이 받는다.
2. 비용 관리 > 인보이스 등록 탭 textarea에 한 줄씩 붙여 넣고 "링크로 등록".
3. 건별 결과 확인: `등록` / `이미 등록됨`(같은 번호) / `실패`(원인 문구). 실패하면 Stripe 페이지에서 "Download invoice"로 받은 PDF를 업로드한다.
4. "조직 미배정"이 뜨면(Bill to가 `claude_orgs.name`과 다를 때) 표의 조직 드롭다운으로 배정한다. 조직 이름은 `/admin/directory` 조직·설정 탭에서 Bill to(예 `Innogrid-ax`)와 맞춰 두면 다음 달부터 자동 매칭된다(대소문자·하이픈·공백 무시).

## 3. 숫자 읽는 법
- **월 기준 토글**(개요 탭, 브라우저에 기억): `발행일 기준`(기본) = 인보이스 발행 월에 전액 — 카드 청구서와 같은 숫자. `서비스 기간 일할` = 총액을 서비스 기간 `[period_start, period_end)`이 겹치는 일수 비례로 달마다 배분(연간 인보이스가 12개월로 펴짐, 반올림 잔여는 마지막 달, VAT = 총액 − 세전). 기간이 없는 장은 어느 기준에서도 발행 월 전액. 조직별 상세에 "총액 중 배분액 (겹친 일수/전체 일수)"가 보인다.
- **누락 배지**는 기준과 무관하게 "그 달 말까지 시작한(첫 인보이스의 서비스 기간 시작이 그 달 이전인) 조직 중 서비스 기간이 그 달을 덮는 인보이스가 없는 조직"이다. 8월에 시작한 ax·S1·S2는 그 전 달에 누락으로 보이지 않는다. 연간 플랜 조직(자율행동체·AI반도체·AIMS)은 기간 안이면 누락이 아니고, 월 갱신 조직은 다음 인보이스를 등록하기 전 달부터 누락으로 보인다 — 매달 링크를 넣으라는 신호.
- 청구 총액 = 인보이스 총액(VAT 포함) 합. API 비용은 대조용이며 합계에 없다(Console 인보이스를 함께 올렸을 때 이중 계산을 막기 위해).
- 좌석 = 그 달에 기여한 인보이스(발행일 기준: 그 달 발행 / 기간 기준: 그 달을 덮는) 중 좌석이 적힌 마지막 장의 좌석. 프로레이션(Remaining/Unused) 인보이스는 + 라인의 수량, 갱신·연간 인보이스는 수량(Qty) 열.
- **티어별**(Team plan - Premium / Standard): 좌석·좌석당 비용은 티어별로 따로 보인다(좌석 칸 아래 작은 글씨, 좌석당 칸은 티어별 값 + 평균, 카드 "좌석당 월 비용 (티어별)"). 금액은 인보이스 헤더 티어로, 좌석은 조직 대표 장의 티어로 묶는다. Standard(≈$25)와 Premium(≈$125)을 섞은 평균은 참고용. CSV에 `seats_by_tier`·`total_by_tier_usd`·`per_seat_by_tier_usd` 열.
- 활성 사용자(OTel)는 Claude Code 사용자만. 채팅 포함 활성은 "활성 멤버(CSV)" 열(그 달에 끝나는 CSV 회차가 있을 때).
- 금액은 USD. 원화 카드 청구액(은행 환율)은 범위 밖.

## 4. 파서가 아는 인보이스 모양 (2026-09 실물)
- `Invoice number X` / `Date of issue Month D, YYYY` / 왼쪽 발행자 주소·오른쪽 `Bill to` 열 / `Description Qty Unit price Tax Amount` 표 / `Subtotal` · `VAT - South Korea (10% on $…)` · `Total` · `Amount due $… USD`.
- 라인은 "설명 수량 [단가] [세율] 금액" 한 줄 + 다음 줄 기간 `Aug 23–Sep 23, 2026`. 프로레이션은 `Remaining time on 97 × Team plan - Premium after 24 Aug 2026`(+) / `Unused time on 40 × …`(−).
- **pdf.js 글리프 손실**: 이 PDF 폰트는 하이픈·대시·괄호·마이너스 글리프에 ToUnicode가 없어 unpdf가 NUL로 돌려주고 공백이 된다(`RB6YCIF0 0003`, `Aug 23 Sep 23, 2026`, `$4,978.24`에서 마이너스 사라짐). 파서는 이 문자에 의존하지 않는다 — 번호는 공백→하이픈, 기간은 공백 구분자 허용, 크레딧은 `Unused time on` 설명으로 판정. pdftotext(poppler)는 글리프 이름으로 복원하므로 CLI로는 정상으로 보인다.
- 합계 검증: Σ라인 = 소계, 소계+세액 = 총액. 어긋나면 저장 거절.

## 5. 장애 대응
- `Anthropic 인보이스가 아닙니다` / `라인 아이템 표를 찾을 수 없습니다`: Stripe가 PDF 레이아웃을 바꿨을 수 있다. `frontend/src/lib/claude-cost/stripe-invoice.ts`의 정규식과 테스트 픽스처를 새 레이아웃으로 맞춘다. 저장된 `raw_text`(service role로만 조회)나 실물 PDF로 줄 모양을 확인한다 — `extractInvoiceLines` 결과를 찍어 보면 된다.
- `라인 합이 소계와 다릅니다`: 라인 한 줄이 정규식에 안 걸렸거나 크레딧 판정이 빠진 것. 위와 같이 처리.
- `PDF를 받지 못했습니다`: 링크 만료. `pay.stripe.com/…/pdf`는 302로 S3 프리사인 URL(`stripe-upload-api.s3.us-west-1.amazonaws.com`)을 돌려주며 서버는 Stripe·그 버킷으로의 리디렉션만 최대 2홉 따른다 — 다른 호스트로 넘어가면 `허용되지 않은 주소` 오류. PDF 업로드로 대체.
- `관리자 키가 거부되었습니다`: 키가 회수됐거나 워크스페이스 키를 넣은 것. Admin 키(`sk-ant-admin01-`)여야 한다.
- cost_report 값은 30일간 사후 보정된다 — cron이 매일 최근 3일을 다시 받는다. 더 과거는 "지금 수집"으로 기간을 지정한다(최대 93일).

## 6. 테스트
`cd frontend && npx vitest run src/lib/__tests__/claude-cost-*.test.ts` — 금액·날짜(10), 인보이스 파서(17, 글리프 손실 모양 포함), PDF fetch 가드(4), cost_report 파서·페이지네이션(6), 월별 집계(6).
실물 PDF·링크·금액은 저장소에 넣지 않는다(픽스처는 가공값).
