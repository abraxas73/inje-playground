# 매체·부서 관리 및 부고 매칭 알림 메일 설계

2026-09-15. 대외협력·커뮤니케이션 업무용 미디어 리스트(매체·부서)를 앱에서 관리하고, 연합뉴스 부고 수집 결과가 관리 매체·부서와 일치하면 알림을 신청한 사용자에게 사내 SMTP 릴레이로 메일을 보낸다.

## 1. 배경과 목표

- 원본: `미디어리스트_260909(매체 및 부서).xlsx` — `Sheet1` 274행, 컬럼 `매체`·`부서` 2개. 중복 제거 시 매체 73개, 매체+부서 조합 94개, 부서 빈칸 38행.
- 기존 자산: Supabase Edge Function `yonhap-notices`가 매일 07:00 KST와 "지금 가져오기" 요청에 연합뉴스 인사·부고 RSS를 `yonhap_notices`에 누적한다(`docs/yonhap-notices.md`). 부고 텍스트 형태는 제목 `[부고] 강광우(중앙일보 기자)씨 장인상`, 요약 `▲ … 강광우(중앙일보 머니랩부 기자)씨 장인상 = 14일, …`처럼 매체명이 괄호 안에 오고 부서는 요약에만 가끔 나온다.
- 목표: (1) 매체·부서를 중복 없이 DB로 관리하고 다른 기능에서 재사용할 수 있게 한다. (2) 새 부고가 관리 매체·부서와 일치하면 알림 신청자에게 메일을 보낸다. (3) 메일은 사내 릴레이 `wblock.innogrid.com`으로 보낸다.

## 2. 확정 결정

| 항목 | 결정 |
|---|---|
| 알림 수신자 | 앱 사용자 opt-in. `/people-news` 카드에서 본인이 켜고 끈다. 수신 주소는 로그인 이메일. Microsoft 연결 불필요 |
| 매칭 기준 | **매체 + 그 매체에 등록된 부서 중 하나가 함께 포함될 때만** 일치. 원본에서 부서가 빈칸인 매체는 "부서 무관"으로 적재해 매체만으로 일치 |
| 발송 단위 | 수집 1회(run)당 새 매칭 건을 모아 수신자별 1통. 같은 부고는 한 번만 알림 |
| 관리 화면 | `/media-directory`. 조회는 인사·부고 접근 사용자 전체, 편집(엑셀 재적재·추가·수정·비활성·별칭)은 admin |
| 발송 경로 | Edge Function에서 `wblock.innogrid.com:465` implicit TLS + `AUTH LOGIN`. 25·587은 Supabase 런타임 아웃바운드 차단으로 불가(스파이크 2026-09-15: 25/587 타임아웃, 465 배너·EHLO 성공, 인증서 `*.innogrid.com` DigiCert 유효) |
| 자격증명 | 운영자가 로컬 파일에 적어 경로만 전달 → `supabase secrets set --env-file`. 저장소·대화·로그에 남기지 않음 |
| 미결(구현 전 확인) | 실제 계정으로 465번 `AUTH LOGIN` 통과 여부. 테스트 메일 1통을 운영자에게만 발송해 확인한다 |

## 3. 범위

포함: 매체·부서 테이블과 RPC, 엑셀 업로드(미리보기·적용·재적재), 관리 화면, 매칭 함수, 수집 함수 확장(매칭·발송), SMTP 클라이언트, 알림 구독 카드, 부고 목록의 일치 배지, 발송 이력, 문서·테스트.

제외(후속): 자동 재발송, 매체·부서 변경 감사 이벤트 표, 매체별 담당자 지정, 인사(personnel) 기사 매칭, Resend 등 외부 메일 서비스, Slack/Teams 알림.

## 4. 데이터 모델 — `docs/sql/2026-09-15-media-directory.sql`

모든 테이블은 RLS를 켠다. 클라이언트 직접 쓰기는 없고 admin RPC(security definer) 또는 service role만 쓴다. 조회 정책은 기존 `has_page_access('people_news')`를 재사용하며 새 페이지 키는 만들지 않는다.

- `media_outlets` — `id uuid pk`, `name text`(2~100자), `name_norm text unique`, `aliases text[]`(각 2자 이상), `aliases_norm text[]`, `any_department boolean default false`(부서 무관), `active boolean default true`, `created_at`, `updated_at`, `updated_by uuid`.
- `media_departments` — `id uuid pk`, `outlet_id uuid fk media_outlets on delete cascade`, `name text`(2~100자), `name_norm text`, `active boolean`, `created_at`, `updated_at`, `updated_by`. `unique (outlet_id, name_norm)`.
- `media_obituary_matches` — `id bigint identity pk`, `source_id text fk yonhap_notices on delete cascade`, `outlet_id uuid fk`, `department_id uuid fk null`, `matched_text text`(일치 근거, 예: `중앙일보 / 머니랩부`), `sync_run_id bigint fk yonhap_notice_sync_runs null`, `created_at`, `notified_at timestamptz null`. `unique (source_id, outlet_id, department_id) nulls not distinct`.
- `media_alert_subscriptions` — `user_id uuid pk fk auth.users on delete cascade`, `enabled boolean default false`, `updated_at`.
- `media_alert_deliveries` — `id uuid pk`, `sync_run_id bigint fk`, `recipient_user_id uuid fk`, `recipient_email text`, `match_count integer`, `status text check in ('sent','failed')`, `error_message text`(이메일 주소 제거, 200자), `created_at`. `unique (sync_run_id, recipient_user_id)`.

정책:
- `media_outlets`, `media_departments`, `media_obituary_matches`: `select` to authenticated using `has_page_access('people_news')`.
- `media_alert_subscriptions`: `select` own row. `media_alert_deliveries`: `select` own row 또는 admin.
- 나머지 권한은 service_role만.

함수:
- `media_norm(text) returns text` immutable — 소문자, 모든 공백 제거, `㈜`·`(주)`·`주식회사`·`㈔` 제거, 구두점(`·.,()/-'"“”‘’[]`) 제거. 예: `㈜헤럴드` → `헤럴드`, `IT산업부 팩플팀` → `it산업부팩플팀`.
- `media_directory_import(p_rows jsonb) returns jsonb` — admin 전용. 입력 `[{outlet, department|null}]`(최대 2,000행). 매체는 `name_norm` 기준 upsert(기존 표기 유지), 부서 null이면 `any_department=true`, 아니면 부서 upsert. 비활성이던 항목은 다시 활성화한다. 반환 `{outletsAdded, outletsExisting, departmentsAdded, departmentsExisting, anyDepartmentSet, skipped}`. 트랜잭션 1개.
- `media_outlet_save(p_id uuid, p_name text, p_aliases text[], p_any_department boolean, p_active boolean) returns media_outlets` — admin. `p_id` null이면 생성. `name_norm`/`aliases_norm` 충돌은 23505로 거절(다른 매체와 같은 이름·별칭 금지).
- `media_department_save(p_id uuid, p_outlet_id uuid, p_name text, p_active boolean) returns media_departments` — admin.
- `set_media_alert_subscription(p_enabled boolean) returns media_alert_subscriptions` — `has_page_access('people_news')` 필수, 켤 때 `auth.users.email_confirmed_at` 필요.
- `media_match_notices(p_source_ids text[], p_run_id bigint) returns jsonb` — service_role 전용. 5절 규칙으로 일치 행을 `media_obituary_matches`에 `on conflict do nothing`으로 넣고 **이번에 새로 생긴 행만** 매체명·부서명·기사 제목·요약·URL·송고 시각과 함께 반환.
- `media_alert_recipients() returns table(user_id uuid, email text)` — service_role 전용. `enabled` 구독 중 `user_profiles.role in ('user','admin')`, 이메일 인증 완료, `user_page_access.permissions->>'people_news'`가 false가 아닌 사용자.

## 5. 정규화·매칭 규칙

- 대상: `category='obituary'`이고 이번 수집에서 **처음 저장된** `source_id`만. 기존 기사 재수집은 매칭하지 않는다.
- 텍스트 `t = media_norm(title || ' ' || summary)`.
- 활성 매체 `o`에 대해 `name_norm` 또는 `aliases_norm` 중 하나가 `t`에 포함되면 매체 후보.
- 매체 후보 `o`가 `any_department`이면 일치(`department_id null`, `matched_text = 매체명`).
- 그렇지 않으면 `o`의 활성 부서 `d` 중 `d.name_norm`이 `t`에 포함되는 것마다 일치(`department_id = d.id`, `matched_text = 매체명 / 부서명`). 부서가 하나도 안 잡히면 알림 없음.
- 별칭·부서명 최소 2자, 매체명과 별칭은 매체 간 유일. 짧은 문자열 오탐은 관리자가 별칭 편집으로 조정한다.
- 실제 예: `강광우(중앙일보 머니랩부 기자)`는 중앙일보에 `머니랩부`가 등록된 경우에만 일치. `이해람(파이낸셜뉴스 기자)`는 파이낸셜뉴스가 부서 무관일 때만 일치.

## 6. 수집 함수 확장 — `supabase/functions/yonhap-notices/`

`handler.ts` 흐름 변경:
1. 저장 전에 수집한 `source_id`들 중 이미 있는 것을 조회해 `newIds`를 계산한다.
2. 기존처럼 `yonhap_notices` upsert → `yonhap_notice_sync_runs` success 기록.
3. `runMediaAlerts({ admin, runId, sourceIds: newIds(부고만), smtp, appUrl })`를 try/catch로 호출한다. 실패는 수집 결과에 영향을 주지 않고 `console.error`(수신자·자격증명·기사 본문 없이)와 `media_alert_deliveries.failed`로만 남는다.
4. 응답에 `alerts: { matches, recipients, sent, failed, skipped }`를 추가한다.

`alerts.ts`(`runMediaAlerts`):
- `newIds`가 비면 즉시 종료. `media_match_notices` 호출 → 새 매칭 없으면 종료.
- SMTP secrets가 없으면 `skipped: 'smtp-unconfigured'`로 경고만 남기고 종료(매칭 행은 남고 `notified_at`은 null).
- `media_alert_recipients` 호출 → 없으면 종료.
- 다이제스트 1개를 만들고 SMTP 세션 1회로 발송(`RCPT TO` 수신자마다, `DATA` 1회). 수신자별 250/25x는 sent, 그 외는 failed로 `media_alert_deliveries`에 기록. 연결·인증 실패는 전원 failed.
- 1명 이상 sent이면 이번 매칭 행 전체 `notified_at = now()`. 자동 재발송은 하지 않는다.

`smtp.ts`(`sendMail`):
- `Deno.connectTls({ hostname, port })` → `220` → `EHLO` → `AUTH LOGIN`(base64 사용자, 비밀번호) `235` → `MAIL FROM` → `RCPT TO`×N → `DATA` `354` → 본문 → `250` → `QUIT`.
- 본문: CRLF, 점 스터핑, `Subject`는 RFC 2047 `=?UTF-8?B?…?=`, `From`은 표시 이름 `인사·부고 알림` + 계정 주소, `To`는 수신자 전체, `Date`, `Message-ID`, `MIME-Version`, `multipart/alternative`(text/plain, text/html 모두 UTF-8 base64). 8BITMIME는 쓰지 않는다.
- 단계별 타임아웃 20초, 전체 60초. 응답 코드가 기대와 다르면 단계명과 코드만 담은 오류를 던진다(응답 문구에서 이메일 패턴 제거).
- 전송 연결은 주입 가능(`connect` 인자)해서 테스트는 메모리 상의 가짜 서버로 프로토콜을 검증한다.

Secrets(Edge Function, `supabase secrets set`): `MEDIA_SMTP_HOST=wblock.innogrid.com`, `MEDIA_SMTP_PORT=465`, `MEDIA_SMTP_USER`, `MEDIA_SMTP_PASS`, 선택 `MEDIA_ALERT_FROM`(기본 = USER), `MEDIA_APP_URL`(기본 `https://inje-playground.vercel.app`).

## 7. 메일 내용

- 제목: `[부고 알림] 관리 매체·부서 일치 N건 · M월 D일` (KST).
- 본문(HTML + 텍스트): 매칭마다 `매체 · 부서(또는 부서 무관)`, 기사 제목, 요약(600자 이내 원문 요약 그대로), 원문 링크, 송고 시각. 하단에 `/people-news` 링크, "관리 매체·부서 목록"(`/media-directory`) 링크, "알림 해제는 인사·부고 화면에서" 안내.
- 기존 개인 다이제스트(`lib/people-news/digest.ts`)와 양식을 맞추되 Deno 쪽에서 독립 구현한다(런타임이 다름).

## 8. 화면·API

권한 매핑(`lib/page-access.ts`): `pagesForPath`에 `/media-directory`, `/api/media-directory` → `people_news` 추가. 편집 API는 서버에서 `user_profiles.role='admin'`을 추가 확인하고 RPC도 admin을 강제한다.

`/media-directory`(`app/media-directory/page.tsx`, `components/media-directory/`):
- 표: 매체(별칭·부서 무관 표시) → 부서 목록, 검색(매체·부서·별칭), 활성/비활성 구분, 총계.
- admin 전용: **엑셀 업로드**(xlsx, 첫 시트, `매체`·`부서` 헤더 자동 인식 → 미리보기: 신규 매체/부서·이미 있음·부서 무관 처리·빈 행 건수 → 적용), 매체 추가/수정(이름·별칭·부서 무관·활성), 부서 추가/수정/비활성, 최근 알림 발송 이력 50건(run·시각·수신자 수·성공/실패·오류).
- `/people-news` 헤더에 "관리 매체·부서" 링크 버튼.

`/people-news` 추가:
- `MediaAlertCard`: "관리 매체·부서 부고 알림 받기" 스위치(로그인 이메일 표시, 저장, 최근 발송 상태). Microsoft 연결 없이 켤 수 있다.
- 부고 항목에 일치 배지(`중앙일보 · 테크부`, 부서 무관이면 `파이낸셜뉴스`). 목록 API가 페이지 내 `source_id`의 매칭을 함께 돌려준다.

API:
- `GET /api/media-directory?q=` — 매체·부서 트리(조회 권한).
- `POST /api/media-directory/outlets`, `POST /api/media-directory/departments` — 저장(admin). 본문 `{id?, …}`.
- `POST /api/media-directory/import/preview` — multipart xlsx(≤2MB) → 행·건수(admin). 서버에서 exceljs로 파싱, 수식 미실행.
- `POST /api/media-directory/import` — `{rows}` → `media_directory_import`(admin).
- `GET /api/media-directory/deliveries` — 최근 발송 이력(admin).
- `GET·PUT /api/people-news/media-alerts` — 구독 조회/변경.
- 기존 `GET /api/people-news`에 `matches: Record<source_id, {outlet, department|null}[]>` 추가.

## 9. 초기 적재

운영 배포 후 admin이 `/media-directory` 업로드로 원본 엑셀을 적재한다(운영자 Chrome 세션으로 진행). 기대치: 매체 73 신규, 부서 무관 38행 → 해당 매체 플래그, 부서 조합 94−(부서 무관 행 수) 신규, 중복 행 약 180. 재적재는 같은 결과로 수렴한다(멱등).

## 10. 보안·개인정보

- 매체·부서 목록은 개인정보가 아니다. 부고 기사는 공개 RSS 제목·요약만 쓴다.
- 수신자 이메일은 `media_alert_deliveries`에만 남고 본인·admin만 읽는다. SMTP 자격증명은 Edge Function secrets에만 있고 코드·로그·응답에 쓰지 않는다.
- SMTP 오류 메시지는 단계·응답 코드 중심으로 200자 이내, 이메일 패턴 제거 후 저장.
- 릴레이는 인증된 계정으로만 보내며 발신 주소는 그 계정으로 고정한다. 수신자는 앱 사용자(사내 계정)로 한정된다.
- 업로드 xlsx는 exceljs로 값만 읽고 2MB·2,000행 제한.

## 11. 테스트·검증

- Deno(`supabase/functions/yonhap-notices`, `deno task test`): `smtp_test.ts`(가짜 서버 — AUTH base64, RCPT 일부 거절, 점 스터핑, UTF-8 제목 인코딩, 타임아웃, 응답의 이메일 제거), `alerts_test.ts`(새 매칭 없음/secrets 없음/수신자 없음/일부 실패 시 기록·`notified_at`), `handler_test.ts` 추가(신규 ID 계산, 알림 실패가 수집 성공을 깨지 않음, 응답 `alerts`).
- Vitest(`frontend`): 업로드 파싱·중복 집계, 관리 화면(admin 컨트롤 노출, 미리보기→적용, 편집 저장), 알림 카드(켜기/끄기·오류), 목록 배지, API 권한(비로그인 401, 일반 사용자 편집 403, 파일 크기 초과 413).
- SQL(`scripts/check-media-directory.sql`, 로컬 DB 전용·롤백): 정규화 사례, 부서 필수/부서 무관 매칭, 중복 유니크, 새 행만 반환, 재적재 멱등, 비허용 사용자 RLS, 구독 RPC 권한, 수신자 함수 필터.
- 운영 검증: 테스트 메일 1통(운영자), 엑셀 적재 건수 대조, 수동 "지금 가져오기" 후 매칭·배지·발송 이력 확인, 07:00 자동 수집 다음 날 확인.

## 12. 배포 순서

1. `docs/sql/2026-09-15-media-directory.sql` 운영 적용(`supabase db query --linked` 또는 Management API).
2. SMTP secrets 설정(운영자 로컬 파일 → `supabase secrets set --project-ref avooqcxehfeurjhqqgui --env-file <파일>`).
3. `supabase functions deploy yonhap-notices --project-ref avooqcxehfeurjhqqgui --use-api`.
4. 운영자 1명에게 테스트 발송으로 465 AUTH 확인(구현 초반에 먼저 수행).
5. `frontend` 빌드 → `cd frontend && NODE_OPTIONS= vercel --prod --yes --scope seunguk-kangs-projects` → alias 확인.
6. `/media-directory`에서 엑셀 적재 → 건수 대조 → `/people-news`에서 알림 켜기 → "지금 가져오기".
7. 런북 `docs/media-directory.md` 작성, `CLAUDE.md`·`docs/yonhap-notices.md` 갱신.

## 13. 실패 시 대안

- 465 `AUTH LOGIN` 실패: IT에 465 인증 정책 확인 또는 587 STARTTLS 개방 요청. 그동안 매칭·화면·이력은 그대로 동작하고 발송만 `skipped`.
- 릴레이가 사외 발신을 거절: Vercel 라우트에서 동일 클라이언트(Node `tls.connect` 465)로 우회 가능. 매칭 결과 테이블이 있어 발송 계층만 교체한다.
