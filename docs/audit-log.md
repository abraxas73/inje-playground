# Audit 로그 (로그인·액션 이력)

관리자 화면 `/admin/audit`에서 **로그인 이력**과 **액션 이력**을 한 표로 조회한다(검색·기간·구분·카테고리 필터, 페이지 CSV 내려받기).

## 무엇이 남는가

| 구분 | 출처 | 남기는 시점 |
| --- | --- | --- |
| 로그인 | `login_history` | OAuth 콜백(`/auth/callback`)과 `POST /api/users/login-history` — `lib/audit.ts` `logLogin`이 이력 + `user_profiles.last_login_at`을 함께 갱신 |
| 액션 | `action_history` (`source='app'`) | 화면의 `logAction()`(사다리·팀·뭐먹지·로그인 시도)과 서버 라우트의 `logAudit()` — 뜻이 있는 행위에 사람이 읽는 이름을 붙인다 |
| API 호출 | `action_history` (`source='api'`) | proxy(`lib/supabase-middleware.ts` → `lib/audit-proxy.ts`)가 로그인 사용자의 **변경 요청**(POST·PUT·PATCH·DELETE)을 자동으로 남긴다 |

서버에서 이름을 붙여 남기는 행위(2026-09-07 기준): 로그인, 전역 설정 변경, 사용자 권한 변경, 사용자 삭제(무엇이 몇 건 지워졌는지 포함), 솔루션 매핑 실행(스코프·엔진·상한), 카탈로그 가져오기 실행, SharePoint 업로드(파일명·알림 여부).

## 남기지 않는 것

- **익명 설문 응답**(`/api/surveys/…`): 설문은 익명 보장이라 시각·IP를 남기면 응답자를 좁힐 수 있다.
- 수집·프록시 엔드포인트: `/api/otel/*`(하루 수천 건), `/api/cron/*`, `/api/food/payco`, `/api/dooray/members`.
- 자기 자신을 이미 기록하는 `/api/action-history`, `/api/users/login-history`.
- 비로그인 요청(행위자가 없고 라우트가 401로 막는다), 그리고 **비밀 값**(토큰·웹훅 URL·비밀번호는 detail에 넣지 않는다 — 설정 변경은 키 이름·길이만).

## 구조

- `lib/audit.ts` — `logAudit`(액션 1건, IP·UA·source 포함) / `logLogin`(로그인 이력 + last_login_at). **어떤 실패도 던지지 않는다**(감사 기록이 본래 요청을 깨뜨리지 않는다). detail은 값 500자·전체 4000자로 자른다.
- `lib/audit-proxy.ts` — `shouldAuditRequest(method, path)`(제외 목록), `auditCategoryFor(path)`(경로 → 카테고리). proxy에서 `after()`로 응답 뒤에 기록하고, 그 블록은 try/catch로 격리해 로그인·권한 검사에 영향을 주지 않는다.
- `lib/audit-query.ts` — 조회 조건 해석(`parseAuditQuery`·`sanitizeSearch`·`kstRange`·`searchOrFilter`·`pageRange`). 검색어의 `,()%_*`는 제거해 PostgREST `or=()`·ilike를 깨지 않는다.
- DB 뷰 `audit_log` — `login_history` ∪ `action_history`를 `kind|at|user_email|user_name|category|action|detail|detail_text|ip_address|user_agent`로 통일. `security_invoker=true` + anon·authenticated 권한 회수라 **service_role(관리자 API)만 읽는다**. SQL `docs/sql/2026-09-07-audit-log.sql`(운영 적용 완료).
- API `GET /api/admin/audit?kind=all|login|action|api&category=&q=&from=&to=&page=&pageSize=` → `{rows, total, page, pageSize, categories}`. admin 전용, 기간은 KST 날짜.

## 운영 팁

- 검색은 사용자 이름·이메일·액션·경로·IP·detail 내용을 함께 훑는다(예: 프로젝트 id로 그 프로젝트에 일어난 일 모두).
- "API 호출"이 많아 눈에 걸리면 구분을 "액션"·"로그인"으로 좁힌다.
- 보존 정책은 아직 없다(무기한). 행이 많아지면 `action_history`를 기간으로 지우는 배치를 검토한다 — 인덱스 `action_history_created_at_idx`가 있다.
