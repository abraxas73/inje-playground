# 관리 매체·부서 및 부고 매칭 알림

2026-09-15 구현. 설계: `docs/superpowers/specs/2026-09-15-media-obituary-alerts-design.md`, 계획: `docs/superpowers/plans/2026-09-15-media-obituary-alerts.md`.

## 사용 방법

1. `/people-news` 상단 **관리 매체·부서**(또는 `/media-directory`)에서 매체·부서 목록을 확인한다. 조회는 인사·부고 접근 사용자 전체, 편집은 admin.
2. admin은 **엑셀 업로드**로 미디어 리스트(첫 시트, `매체`·`부서` 열)를 적재한다. 미리보기에서 신규/기존/중복 건수를 확인한 뒤 **N행 적용**. 기존 항목은 유지되고 새 항목만 추가되므로 재적재는 안전하다. 부서가 빈 행은 그 매체를 **부서 무관**으로 표시한다.
3. **매체 추가/수정**에서 매체명·별칭(쉼표)·부서 무관·활성, 부서 추가·이름 변경·활성 토글·**삭제**를 한다. 부서 삭제는 확인 후 즉시 지워지며 그 부서로 기록된 부고 매칭 배지도 함께 삭제된다(잠시 제외만 하려면 비활성). 매체명·별칭은 2자 이상이고 다른 매체와 겹칠 수 없다.
4. 알림을 받으려면 `/people-news`의 **관리 매체·부서 부고 알림 받기**를 켠다. 수신 주소는 로그인 이메일이며 Microsoft 연결이 필요 없다.

## 매칭 규칙

- 대상: 수집(07:00 KST 자동, ‘지금 가져오기’) 시 **처음 저장된 부고**만.
- 텍스트 = 제목 + 요약을 `media_norm`(소문자·공백 제거·`㈜`·`(주)`·구두점 제거)으로 정규화.
- 매체명 또는 별칭이 포함되고, **그 매체에 등록된 활성 부서 중 하나도 포함될 때** 일치. 부서 무관 매체는 매체만으로 일치. 부서가 없고 부서 무관도 아닌 매체는 알림 대상이 아니다.
- 일치는 `media_obituary_matches`에 남고 `/people-news` 목록에 “매체 / 부서 일치” 배지로 표시된다.

## 발송

- Edge Function `yonhap-notices`가 수집 성공 기록 뒤 `media_match_notices` → 새 매칭이 있으면 `media_alert_recipients` 전원에게 SMTPS(`wblock.innogrid.com:465`, `AUTH LOGIN`) 1통을 보낸다. 제목 `[부고 알림] 관리 매체·부서 일치 N건 · M월 D일`.
- 수신자별 결과는 `media_alert_deliveries`(sent/failed). 실패는 자동 재발송하지 않는다. `/media-directory` 하단 “최근 알림 발송 이력”(admin)과 알림 카드의 “최근 알림”에서 확인한다.
- 알림 실패는 수집 결과에 영향을 주지 않는다. 응답 `alerts` 필드에 요약(`matches, recipients, sent, failed, skipped`)이 담긴다.
- Secrets(Edge Function): `MEDIA_SMTP_HOST`, `MEDIA_SMTP_PORT=465`, `MEDIA_SMTP_USER`(발신 주소), `MEDIA_SMTP_PASS`, 선택 `MEDIA_APP_URL`. 25·587은 Supabase 런타임에서 아웃바운드가 막혀 있어 465만 쓴다(2026-09-15 스파이크: 25/587 타임아웃, 465 배너·EHLO·AUTH 성공). 비밀번호 변경 시 `supabase secrets set --project-ref avooqcxehfeurjhqqgui --env-file <로컬 파일>`만 하면 다음 호출부터 반영된다.

## 배포·운영

- SQL: `supabase db query --linked --file docs/sql/2026-09-15-media-directory.sql`, 부서 삭제 RPC `docs/sql/2026-09-16-media-department-delete.sql`. 검증: `supabase db query --linked --file scripts/check-media-directory.sql`(전부 롤백).
- 함수: `supabase functions deploy yonhap-notices --project-ref avooqcxehfeurjhqqgui --use-api`. 테스트: `cd supabase/functions/yonhap-notices && deno task test`.
- 프런트: `cd frontend && npm test && npm run build`, 배포 `NODE_OPTIONS= vercel --prod --yes --scope seunguk-kangs-projects`(반드시 `frontend/`에서).
- 기존 부고에 배지를 채우려면(메일 없음) service role로 `select public.media_match_notices(array(select source_id from public.yonhap_notices where category='obituary'), null);`를 실행한다. 새 부고만 메일 대상이므로 과거 매칭은 발송되지 않는다.
- 문제 시: 알림만 멈추려면 `supabase secrets unset MEDIA_SMTP_PASS --project-ref avooqcxehfeurjhqqgui`(발송 생략, 매칭·배지는 유지). 수집 자체는 영향 없음.

## 운영 검증 (2026-09-15)

- 엑셀 적재: 매체 73·부서 70·부서 무관 24, 규칙 없는 매체 0. 과거 부고 56건 백필 매칭 1건(중앙일보, 부서 무관).
- 수동 "지금 가져오기"(run 7): 신규 부고 7건 중 등록 매체+부서 일치 0 → 발송 0(`skipped: no-matches`).
- End-to-end: RSS에 남아 있던 중앙일보 부고 1건(`AKR20260914143700505`)을 DB에서 지우고 크론 경로(`invoke_yonhap_notices_sync`)로 재수집(run 8, 21:19 KST) → 새 부고로 저장 → 매칭 1건(`notified_at` 기록) → `media_alert_deliveries` sent 1건(운영자). 수집·매칭·SMTPS 발송·이력 기록이 한 run에서 모두 동작함을 확인했다.
- 익명 API(`/api/media-directory`, `/api/people-news/media-alerts`, `…/deliveries`, `POST …/import`) 401, `/media-directory` 비로그인은 `/login` 리다이렉트.
