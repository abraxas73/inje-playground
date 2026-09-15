# 마케팅 Master DB 운영 및 검증

> 최신 기능: [등록된 회사·기관 검색·선택 및 선등록](marketing-registered-organizations.md). [검수자 목록·실제 권한·지정 이력](marketing-reviewer-management.md). [이메일 정합성 관리](marketing-email-integrity.md). [관리 규칙 수정·전체/일부 Master 검증](marketing-rule-management-v2.md)도 운영 중이다. 기존 접수·승인과 AI 유보 범위는 [AI 제외 1차 보완 구현](marketing-master-db-completion.md)을 참조한다. 아래 초기 배포 기록은 당시 기준이다.

## 구현 내용

`/marketing`에 Master 검색·상세, 부문별 단건/Excel Contact 제출, 검수 큐, 회사·기관 기준, 변경 이력을 추가했다. 기존 홈과 업무·소식 메뉴, 페이지별 접근 권한에 연결했다.

- 단건 및 `Contact 제출` Excel 시트(최대 50건): 원문·제출자·사내 부문·파일/시트/행 추적.
- 이메일/회사·성명/명시 DB ID/미처리 제출 중복, 필수정보·형식 검사. 회사의 승인 별칭과 유사 표기를 구분.
- AI 추천은 회사명·이메일 도메인·회사 후보만 사용하며 Contact 이름·연락처나 원본 전체를 전송하지 않는다.
- 담당자가 반영 대상·회사·최종 필드를 선택하고 확인 근거를 기록한 뒤 승인/반려.
- 승인은 단일 PostgreSQL 트랜잭션. 권한, 현재 제출 상태, Contact/회사 버전, 이메일 충돌을 재검사한다. 동일 승인 재요청은 중복 생성하지 않는다.
- 업데이트의 빈 입력은 기존값 유지. 삭제 요청만 명시적 필드 삭제. 검수의 최종값 편집은 화면에 표시된 전체 반영값이다.
- 회사 표준명·분류는 회사 테이블에서 관리. 소속 Contact 검색/조회에 동일하게 적용하며 변경 시 열린 검수의 기준 버전을 무효화한다.
- 기존 Excel 최초 이관은 관리자 전용이며 비어 있는 Master에만 허용한다. 기존 DB ID, 18개 원본 필드, 출처, 빈 필드를 보존한다.
- Stibee·Eco Partner 외부 동기화 및 월간 보고는 구현 범위에서 제외했다. 기존 Eco 5개 필드는 보존·검수할 수 있다.

## 배포 준비

2026-09-14 운영 Supabase 마이그레이션 적용, 원본 7,294건 이관, Vercel Production 배포를 완료했다. 운영 URL: https://inje-playground.vercel.app/marketing. 원본 Excel은 수정하지 않았다.

배포 ID: `dpl_Ait7nMHenHEHebcbVLtAmZsedqgT`. 이관 파일 SHA-256: `cde4f7eecf13d4f520445e7ecbe619f760c0bd08b33fa64634319596a108ec28`. 운영에서 Contact 7,294건, 원본 행 7,294건, 회사명 기준 2,826개 및 누락/분류 지표를 대조했다. 관리 API의 요청 크기 제한으로 접근이 차단된 임시 테이블에 나눠 적재한 후 하나의 트랜잭션에서 이관했고, 임시 테이블은 제거했다.

현재 운영 `ANTHROPIC_API_KEY`와 `MARKETING_AI_MODEL`은 미설정이다. 규칙 검증과 담당자 검수는 사용 가능하며, 실제 AI 추천 활성화는 키 설정 후 진행한다.

1. 기존 환경의 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 설정한다. 이 기능은 사용자 세션 RPC를 사용하므로 서비스 역할 키가 필요하지 않다.
2. 기존 `docs/sql/2026-09-11-page-access.sql`이 적용된 DB에 `docs/sql/2026-09-14-marketing-master.sql`을 적용한다. `user_profiles`와 `company_directory`는 기존 앱 테이블이다. 이어서 `docs/sql/2026-09-14-marketing-pilot-access.sql`과 `docs/sql/2026-09-14-marketing-completion.sql`을 순서대로 반드시 적용한다. 이 후속 정책은 강승억·김하연의 고정 계정 ID만 허용하며 다른 관리자와 신규 계정도 차단한다. 최초 SQL을 다시 적용했다면 후속 정책도 다시 적용해야 한다.
3. AI는 후속 단계다. 활성화하기로 결정한 뒤 `MARKETING_AI_ENABLED=true`, `ANTHROPIC_API_KEY`, `MARKETING_AI_MODEL`을 설정한다. 모델명은 계정에서 사용 가능한 모델 ID를 지정한다. 둘 중 하나라도 없으면 ‘AI 연결 미설정’으로 표시하고 규칙 검증 및 수동 검수를 계속 제공한다. 실제 모델 호출은 이번 로컬 검증에서 실행하지 않았다.
4. 프런트엔드 빌드·배포 후 허용된 관리자로 `/marketing` → 관리 → 담당자 계정 이메일로 검수자 지정. 접근이 허용된 관리자는 기본 승인 가능하다. 페이지가 차단된 사용자는 검수자로 지정해도 승인할 수 없다.
5. 관리 → 기존 Master Excel 최초 이관 → 원본 파일 선택 → 시트/행수/미리보기 확인 → 이관 확정. 첨부 파일 기준 Contact **7,294건**, 회사명 누락 **732건**, 성명 누락 **434건**, 분류 확인 필요 **913건**을 대조한다.

이관 전 회사명·성명 누락은 기존 상태 그대로 보존되며, 신규 등록/변경을 승인하려면 최종 회사명·성명·이메일이 필요하다. ‘확인 필요’ 분류는 담당자가 명시적으로 보류할 수 있다. 승인된 회사 별칭만 후속 표준명 추천에 사용하며 유사표기만으로 법인을 병합하지 않는다.

사내 부문은 로그인 이메일에 일치하는 활성 `company_directory` 레코드에서 서버가 결정한다. 매핑이 없으면 ‘소속 미확인’으로 기록하며 제출자가 부문을 사칭해 덮어쓸 수 없다.

## 주요 파일

- `frontend/src/components/marketing/`: 관리 화면 및 입력/검수 UI.
- `frontend/src/lib/marketing/`: 공유 타입, 규칙 검증, AI 보조, XLSX 처리, 서버 권한.
- `frontend/src/app/api/marketing/`: 목록·제출·검수·회사·검수자·Excel API.
- `docs/sql/2026-09-14-marketing-master.sql`: 테이블/RLS/함수/인덱스 및 페이지 접근 키.
- `scripts/check-marketing.sql`: 로컬 전용 SQL 검증. 모든 데이터 변경은 롤백.

## 검증

개발 검증 환경: Next.js 16.1.6, 별도 PostgreSQL 14 로컬 인스턴스, Vitest, Chromium. 개발용 변경 테스트는 운영 DB에서 실행하지 않았다. 이후 운영 이관·조회·권한 확인은 별도로 수행했다.

```sh
cd frontend
npm ci
npx tsc --noEmit
npx eslint src/lib/marketing src/components/marketing src/app/marketing src/app/api/marketing
npx vitest run src/lib/__tests__/marketing-validation.test.ts src/lib/__tests__/marketing-excel.test.ts src/lib/__tests__/marketing-review-ui.test.tsx src/lib/__tests__/page-access.test.ts src/lib/__tests__/page-access-middleware.test.ts
npm run build
```

실제 첨부 파일 대조 테스트는 `MARKETING_TEST_XLSX`에 파일 경로를 지정하면 실행한다. 기본 실행에서는 개인정보가 포함된 원본이 없어도 나머지 테스트를 실행할 수 있도록 해당 사례만 건너뛴다. 원본 데이터는 저장소에 넣지 않는다.

SQL 검증은 별도 로컬 DB에서 Supabase 테스트 역할(`anon`, `authenticated`, `service_role`), `auth.users`, `auth.uid()`, 기존 `user_profiles`·`company_directory`의 최소 테스트 스키마를 만든 뒤 기존 페이지 권한 SQL → 마케팅 SQL → `scripts/check-marketing.sql` 순서로 실행한다. 운영 DB에서 테스트용 스키마를 만들거나 이 검증 스크립트를 실행하지 않는다.

확인한 동작:

- 규칙·Excel·UI 승인 조건·기존 페이지 권한 테스트 44개 통과(원본 파일 사례 포함).
- 원본 7,294건 전체의 실제 파싱과 로컬 DB 이관, 원본 행 7,294건 및 회사명 기준 2,826개·지표 대조. 검증 트랜잭션 롤백.
- SQL 직접 쓰기 차단, 사용자 간 제출 격리, 비검수자 승인 거부, 페이지 차단의 RLS 적용.
- 승인·감사 기록 원자성, 원본 ID 유지, 중복 이메일 방지, 오래된 버전 거부, 반려 시 Master 보존.
- 서로 다른 DB 연결의 동시 승인 경쟁: 한 요청만 성공하고 다른 요청은 버전 충돌로 거절.
- 실제 React 컴포넌트의 Chromium 렌더링(테스트 API 응답 사용): 승인 확인 조건, 승인 콜백, Contact 입력 모달, 1440px/390px 화면. 브라우저 오류 및 페이지 가로 넘침 없음. 운영 배포 후 실제 로그인 세션으로 Master 7,294건 조회, IT기업 필터 2,149건, Contact 입력 모달을 확인했다. 비로그인 API 요청은 HTTP 401로 차단됐다. 운영에서 테스트 Contact를 만들거나 승인하지 않았다.

## 운영 참고

이메일 검사는 형식과 중복을 확인하며 수신동의·발송 가능성을 보증하지 않는다. 관련 원본 관리기준은 유지하고 Stibee 연계 단계에서 별도로 연결한다.

검수 승인 RPC의 짧은 기능 전용 잠금으로 Master 쓰기를 직렬화한다. AI 네트워크 호출은 잠금 밖에서 실행하며 20초 시간 제한과 최대 5개 동시 호출을 사용한다. 제출은 최대 50건, 최초 이관은 최대 10,000건·파일 10MB로 제한했다. 첨부 XLSX는 수식 실행을 하지 않으며 제출 데이터 내 수식 셀은 값으로 변환하도록 안내한다.

문제가 생기면 새 제출·승인을 중지하고 원인과 DB 이력을 확인한다. 프런트엔드만 이전 버전으로 복원할 수 있으며, 원본·Master·감사 테이블을 삭제하는 롤백은 제공하지 않는다.

### 2026-09-14 후속 수정

- 탭/검색 조건에 맞는 응답만 렌더링하도록 수정. 이전 탭 데이터를 다른 타입으로 읽던 오류와 취소된 요청의 뒤늦은 반영을 방지한다.
- 마케팅은 강승억·김하연만 접근하는 제한 운영으로 변경. 메뉴·홈 카드, 페이지·API, DB RLS/RPC 모두 동일 정책을 적용하며 일반 페이지 권한 설정으로 확대할 수 없다.
- 운영 계정 71개 전수 검사: 허용 2개, 그 외 관리자 3개 포함 모두 차단. 탭 전환/응답 역전, 권한/미들웨어 등 관련 테스트 44개와 TypeScript 검사 통과.
- 후속 배포: `https://innogrid-playground-cqotjk84k-seunguk-kangs-projects.vercel.app` (Production 별칭 반영). 운영 브라우저에서 Master → 회사·기관 → 검수 대기 → 변경 이력 → Master 전환 정상, 배포 후 새 브라우저 오류 없음. 차단된 관리자 컨텍스트의 RLS 검사에서 Contact/회사/원본 행 조회 모두 0건.

## AI 제외 보완 배포

2026-09-14 `dpl_HEvdvndT6dXzbCYtSRSMrboEKzw7` 운영 반영 완료. [최신 구현·사용 방법·검증 결과](marketing-master-db-completion.md)를 기준으로 운영한다. AI는 명시적으로 비활성 상태다.

## 최초 요구사항의 마지막 두 보완

오류 Contact 확인 필요 접수와 김하연 검수자 지정을 운영에 반영했다. 최신 정책·권한·검증 결과는 [오류 Contact 접수 및 담당 검수자 지정](marketing-master-db-intake-reviewer.md)을 참조한다.

## Master DB 기본 화면 및 전체 컬럼

필터 결과 전체 Excel 다운로드와 DB 관리 규칙의 사용법·원본 관리기준 대조·검증 결과는 [관리 규칙 및 다운로드](marketing-master-db-rules.md)를 참조한다.

`/marketing`에 진입하거나 새로고침하면 Master DB 탭이 기본으로 열린다. Master 표는 원본 Excel `01_Master_DB`의 A:R 18개 컬럼을 같은 순서로 표시한다.

분류 → DB ID → 회사명 → 성명 → 소속부서 → 직책 → 이메일 → 연락처 → 원본출처 → 원본시트 → 내부 관리부서(기존) → Eco 여부 → Eco ID → Eco 구분 → Eco 중분류 → Eco 소분류 → 최종확인일 → 비고.

헤더는 Excel처럼 2줄로 표시한다. 상단은 회사·기관 분류(A), 기본정보(B:H), 원본정보(I:K), Eco Partner 연계(L:P), 관리정보(Q:R)의 5개 그룹이며 하단은 18개 개별 컬럼이다. 최종확인일은 셀 안에서도 ‘최종 / 확인일’로 줄바꿈한다.

표 영역 안에서 가로·세로 스크롤할 수 있고, 두 줄 헤더 모두 세로 스크롤 시 상단에 고정된다. 컬럼별 고정 너비와 좌우 8px 여백으로 간격을 줄였으며 긴 데이터는 생략하지 않고 셀 안에서 줄바꿈한다. DB ID를 누르면 기존 상세·원본·변경 이력을 확인할 수 있다. 회사명과 분류는 현재 회사·기관 표준값을 표시하며 원본은 상세 화면에 보존된다. TypeScript·ESLint 검사 및 기본 탭/18개 컬럼·5개 그룹 범위/탭 응답 역전 회귀 테스트 2개를 통과했다.

2026-09-14 운영 배포 후 `/marketing` 새로고침에서 Master DB 기본 선택, 상위 5개 그룹·하위 18개 컬럼과 25개 행 표시, 마지막 비고 컬럼까지 가로 이동, 두 줄 헤더의 세로 스크롤 고정을 확인했다. 전체 표 너비는 3,374px에서 2,100px로 약 38% 줄였다. 표시 영역 1,438px에서 표만 가로 스크롤되며 페이지 자체의 가로 넘침은 없다.

이메일 검증 이력은 Master의 DB ID 상세에서 검사 당시 이메일·판정·근거·요청자·시각과 함께 조회한다. 재검사와 오류 재시도, 기존 검사도 보존하며 세부 구현은 [이메일 정합성 관리](marketing-email-integrity.md#master-레코드의-이메일-검증-이력)를 참고한다.
