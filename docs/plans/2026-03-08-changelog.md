# 2026-03-08 구현 변경 사항

## 1. 사용자 매뉴얼 (`/manual`)

- **페이지**: `frontend/src/app/manual/page.tsx`
- **스크린샷**: `frontend/public/manual/` (12장, Playwright로 캡처)
- 8개 섹션: 로그인, 메인, 프로필, 설정, 오늘 뭐 먹지, 가이드 Q&A, 사다리, 커피 타임
- 각 섹션별 번호 매긴 사용 단계, 활용 설명, 스크린샷 포함
- 프로필 드롭다운 메뉴에 "사용자 매뉴얼" 링크 추가 (`Navigation.tsx`)
- 스크린샷 내 이메일/프로젝트 ID는 가우시안 블러로 가림 처리
- VPN/Chrome Extension 필수 경고 (설정, 사다리, 커피타임)
- 오늘 뭐 먹지: "너로 정했어" 메시지 전송은 일반 인터넷에서도 가능하다는 활용 팁

## 2. PAYCO 식권 가맹점 검색

- **API 프록시**: `frontend/src/app/api/food/payco/route.ts`
  - `bizplus.payco.com/ajax/merchant/map/myMerchants.json` POST 프록시
  - 요청: `{ address, distance }` → 응답: `{ result: [{ name, address, categoryName, distance, ... }] }`
- **UI**: 랜덤 추천 버튼 옆에 PAYCO 버튼 (flex 비율 4:1)
- 주소에서 "건물명 (주소)" 형태일 경우 괄호 안 순수 주소만 추출하여 전송
- 좌표만 있는 경우 "주소 변경" 안내
- 결과 0건 시 "반경을 넓혀보세요" 메시지
- 비공식 API 경고: "공식 API가 아니므로 결과가 부정확할 수 있습니다"
- 결과 표시: 가맹점명, 카테고리(식권/카페/제과 등), 거리(m), 주소, 전화번호

## 3. Dooray 가져오기 개선

- **타임아웃**: Chrome 확장 브릿지 30초 → 10초로 단축 (`dooray-client.ts`)
- **취소 기능**: AbortController 지원, 전체 호출 체인에 전파
  - `DoorayImportButton`: 로딩 중 X 취소 버튼
  - `DoorayProjectSelect`: 프로젝트 불러오기 중 취소 버튼
- 취소 시 에러가 아닌 "취소되었습니다" 안내 메시지

## 4. 모바일 반응형 개선

- **참여자 입력 UI** (사다리/커피타임): `flex-wrap`으로 좁은 화면 줄바꿈
  - `sm` 미만: "내 구성원" → 아이콘 + (숫자)만 표시
  - `sm` 미만: "Dooray에서 가져오기" → 아이콘만 표시
- **사다리 게임**: 결과 최소 조건 2개 → 1개로 완화 (부족분 "꽝" 자동 채움)
- **오늘 뭐 먹지**: 주소 긴 경우 `truncate` + `title` 툴팁으로 현위치 버튼 가림 방지

## 5. 기타

- **가이드 Q&A 참고자료**: 빈값/5자 미만/중복 필터링 (`ChatPanel.tsx`)
- **소스 파일 다운로드**: Supabase Storage signed URL 기반 다운로드 엔드포인트 (`sources/download/route.ts`)
- **현위치 버튼**: Promise 기반 async/await로 리팩터링, 에러 메시지 상세화
- **배포 스크립트**: 소요시간/완료 시각 표시 (`deploy-frontend.sh`)

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/app/manual/page.tsx` | 신규 — 사용자 매뉴얼 페이지 |
| `frontend/public/manual/*.png` | 신규 — 스크린샷 12장 |
| `frontend/src/app/api/food/payco/route.ts` | 신규 — PAYCO 가맹점 검색 프록시 |
| `frontend/src/app/food/page.tsx` | PAYCO 버튼, 주소 truncate, 현위치 에러 개선 |
| `frontend/src/lib/dooray-client.ts` | 타임아웃 10초, AbortSignal 지원 |
| `frontend/src/components/shared/DoorayImportButton.tsx` | 취소 버튼, 모바일 아이콘 |
| `frontend/src/components/shared/DoorayProjectSelect.tsx` | 취소 버튼 |
| `frontend/src/components/layout/Navigation.tsx` | 매뉴얼 메뉴 항목 |
| `frontend/src/app/ladder/page.tsx` | 모바일 반응형, 결과 1개 허용 |
| `frontend/src/app/team/page.tsx` | 모바일 반응형 |
| `frontend/src/components/ladder/LadderCanvas.tsx` | 최소 결과 1개 |
| `frontend/src/components/guide/ChatPanel.tsx` | 참고자료 필터링 |
| `frontend/src/app/api/guide/notebooks/[id]/sources/route.ts` | storage_path 지원 |
| `frontend/src/app/api/guide/notebooks/[id]/sources/download/route.ts` | 신규 — 다운로드 |
| `frontend/src/components/guide/SourceManager.tsx` | 다운로드 버튼 |
| `frontend/scripts/deploy-frontend.sh` | 소요시간 표시 |
