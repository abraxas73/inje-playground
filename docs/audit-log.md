# Audit 로그 (로그인·액션 이력)

관리자 화면 `/admin/audit`에서 **로그인 이력**과 **액션 이력**을 한 표로 조회한다(검색·기간·구분·카테고리 필터, 페이지 CSV 내려받기).

## 무엇이 남는가

| 구분(kind) | 출처 | 남기는 시점 |
| --- | --- | --- |
| 로그인 | `login_history` | OAuth 콜백(`/auth/callback`)과 `POST /api/users/login-history` — `lib/audit.ts` `logLogin`이 이력 + `user_profiles.last_login_at`을 함께 갱신 |
| 로그인 실패 | `action_history` (`detail.result` = `failure`·`blocked`) | 콜백의 세 갈래 실패(공급자 거절 `?error=`, 코드 교환 실패, 코드 없음)와 GW 로그인 실패·차단(사내 이메일 아님·GW 인증 실패·세션 무효·관리자 GW 금지·세션 발급 실패), 그리고 화면에서 `signInWithOAuth`가 오류를 낸 경우 |
| 로그인 시도 | `action_history` (`detail.result` = `attempt`) | 로그인 화면에서 Google·Microsoft 버튼을 눌러 리다이렉트하기 직전(`keepalive` fetch) |
| 액션 | `action_history` (`source='app'`) | 화면의 `logAction()`(사다리·팀·뭐먹지)과 서버 라우트의 `logAudit()` — 뜻이 있는 행위에 사람이 읽는 이름을 붙인다 |
| API 호출 | `action_history` (`source='api'`) | proxy(`lib/supabase-middleware.ts` → `lib/audit-proxy.ts`)가 로그인 사용자의 **변경 요청**(POST·PUT·PATCH·DELETE)을 자동으로 남긴다 |

로그인 시도·실패는 세션이 없어(익명) `login_history`에 남길 수 없다. 그래서 `action_history`에 category `auth`로 남기고, **무엇이었는지는 `detail.result`(attempt·failure·blocked)** 로 표시한다 — 뷰가 그 값으로 kind를 나누므로 화면 문구를 바꿔도 조회가 깨지지 않는다. 실패 사유는 `detail.reason`(200자), 공급자는 `detail.provider`(google·azure·gw·unknown)이고 아는 경우 이메일은 `user_email`에 넣어 검색된다.

**행위자 판단**: 이미 로그인된 세션에서 일어난 일이면(재인증 거절 등) 그 사용자를 붙인다 — `/api/auth/events`는 쿠키 세션을 확인해 `user_id`·이메일을 채우고, 본문의 `email`은 세션이 없을 때만 참고값으로 쓴다(위조 방지). 세션이 정말 없을 때만 화면에 "비로그인"으로 보인다. 이메일만 아는 행(GW 실패)도 뷰가 `user_profiles`를 이메일로 한 번 더 찾아 이름을 붙인다.

**로그인 실패가 아닌 것**: 이미 로그인된 사용자가 `/auth/callback`을 코드 없이 다시 열면(새로고침·뒤로가기) 실패로 남기지 않고 홈으로 보낸다. 세션이 없을 때만 "인증 코드 없음" 실패로 기록한다.

서버에서 이름을 붙여 남기는 행위(2026-09-07 기준): 로그인, 전역 설정 변경, 사용자 권한 변경, 사용자 삭제(무엇이 몇 건 지워졌는지 포함), 솔루션 매핑 실행(스코프·엔진·상한), 카탈로그 가져오기 실행, SharePoint 업로드(파일명·알림 여부).

## 남기지 않는 것

- **익명 설문 응답**(`/api/surveys/…`): 설문은 익명 보장이라 시각·IP를 남기면 응답자를 좁힐 수 있다.
- 수집·프록시 엔드포인트: `/api/otel/*`(하루 수천 건), `/api/cron/*`, `/api/food/payco`, `/api/dooray/members`.
- 자기 자신을 이미 기록하는 `/api/action-history`, `/api/auth/events`, `/api/users/login-history`.
- 비로그인 요청의 **변경 API 호출**(행위자가 없고 라우트가 401로 막는다). 단 로그인 시도·실패는 예외로 남긴다(아래 공개 엔드포인트).
- **비밀 값**: 토큰·비밀번호·웹훅 URL은 detail에 넣지 않는다(설정 변경은 키 이름·길이만, GW 실패는 사유 문구만).

## 구조

- `lib/audit.ts` — `logAudit`(액션 1건, IP·UA·source 포함) / `logLogin`(로그인 이력 + last_login_at). **어떤 실패도 던지지 않는다**(감사 기록이 본래 요청을 깨뜨리지 않는다). detail은 값 500자·전체 4000자로 자른다.
- `lib/audit-proxy.ts` — `shouldAuditRequest(method, path)`(제외 목록), `auditCategoryFor(path)`(경로 → 카테고리). proxy에서 `after()`로 응답 뒤에 기록하고, 그 블록은 try/catch로 격리해 로그인·권한 검사에 영향을 주지 않는다.
- `lib/audit-query.ts` — 조회 조건 해석(`parseAuditQuery`·`sanitizeSearch`·`kstRange`·`searchOrFilter`·`pageRange`). 검색어의 `,()%_*`는 제거해 PostgREST `or=()`·ilike를 깨지 않는다.
- DB 뷰 `audit_log` — `login_history` ∪ `action_history`를 `kind|at|user_email|user_name|category|action|detail|detail_text|ip_address|user_agent`로 통일. `security_invoker=true` + anon·authenticated 권한 회수라 **service_role(관리자 API)만 읽는다**. SQL `docs/sql/2026-09-07-audit-log.sql`(운영 적용 완료).
- API `GET /api/admin/audit?kind=all|login|login_failed|login_attempt|action|api&category=&q=&from=&to=&page=&pageSize=` → `{rows, total, page, pageSize, categories}`. admin 전용, 기간은 KST 날짜.
- `POST /api/auth/events {event, provider?, email?, reason?}` — **로그인 전(익명)에 부를 수 있는 유일한 기록 경로**. 공개라서 (1) `event`는 attempt·failure·blocked만, `provider`는 목록 밖이면 unknown으로 바꾸고, (2) 같은 IP에서 5분 안에 auth 행이 30건을 넘으면 더 남기지 않고(도배 방지) `{ok:true, skipped:"rate-limited"}`를 준다. 클라이언트 헬퍼는 `lib/action-log.ts` `logAuthEvent`(리다이렉트 중에도 끊기지 않게 `keepalive`).

## 운영 팁

- 검색은 사용자 이름·이메일·액션·경로·IP·detail 내용을 함께 훑는다(예: 프로젝트 id로 그 프로젝트에 일어난 일 모두).
- "API 호출"이 많아 눈에 걸리면 구분을 "액션"·"로그인"으로 좁힌다.
- 보존 정책은 아직 없다(무기한). 행이 많아지면 `action_history`를 기간으로 지우는 배치를 검토한다 — 인덱스 `action_history_created_at_idx`가 있다.
- 침입 흔적을 볼 때는 구분 "로그인 실패"로 좁히고 IP로 검색한다. "로그인 시도" 대비 "로그인"(성공)이 없는 IP·이메일이 눈에 걸리는 조합이다.
