---
paths:
  - "frontend/src/app/media-directory/**"
  - "frontend/src/app/people-news/**"
  - "frontend/src/app/api/media-directory/**"
  - "frontend/src/app/api/people-news/**"
  - "frontend/src/lib/media-directory/**"
  - "frontend/src/lib/people-news/**"
  - "frontend/src/lib/__tests__/media-*"
  - "frontend/src/lib/__tests__/people-news*"
  - "frontend/src/components/media-directory/**"
  - "frontend/src/components/people-news/**"
  - "frontend/src/types/media-directory.ts"
  - "frontend/src/types/people-news.ts"
  - "supabase/functions/yonhap-notices/**"
  - "docs/media-directory.md"
  - "docs/yonhap-notices.md"
  - "docs/sql/*media*"
  - "docs/sql/*yonhap*"
---
# 관리 매체·부고 알림·인사·부고 메일 (기능 상세)

루트 CLAUDE.md의 기능별 보완 지침. 이 경로의 파일을 다룰 때 자동으로 로드된다. 런북 `docs/media-directory.md`, `docs/yonhap-notices.md`.

## 페이지
- `/media-directory` — 관리 매체·부서(조회는 `people_news` 접근자, 편집·엑셀 업로드·발송 이력은 admin): 부고 알림 매칭 기준 목록. 매체(별칭·**부서 무관**·활성)·부서. `/people-news`에는 "관리 매체·부서 부고 알림 받기" 카드(`MediaAlertCard`, 로그인 이메일로 수신, Microsoft 연결 불필요)와 부고 항목의 "매체 / 부서 일치" 배지. 런북 `docs/media-directory.md`

## API
- `GET /api/media-directory?q=`, `POST …/outlets`, `POST·DELETE(?id=) …/departments`, `POST …/import/preview`(xlsx 2MB), `POST …/import`({rows}), `GET …/deliveries`(admin) — 매체·부서 관리(`lib/media-directory/`: normalize=SQL `media_norm` 미러·excel·preview·server). `GET·PUT /api/people-news/media-alerts` — 부고 알림 구독. `GET /api/people-news`는 `matches`(부고 source_id → 일치 라벨) 포함

## Supabase 테이블
- `media_outlets`(name_norm 유니크·aliases·any_department·active), `media_departments`(outlet별 name_norm 유니크), `media_obituary_matches`(부고 × 매체 × 부서, `notified_at`), `media_alert_subscriptions`(사용자별 on/off), `media_alert_deliveries`(run × 수신자 sent|failed) — SQL `docs/sql/2026-09-15-media-directory.sql`. RPC `media_directory_import`·`media_outlet_save`·`media_department_save`·`media_department_delete`(admin, 매칭 cascade), `set_media_alert_subscription`(people_news), `media_match_notices`·`media_alert_recipients`(service_role). 매칭·발송은 Edge Function `yonhap-notices`의 `alerts.ts`·`smtp.ts`(SMTPS 465, AUTH LOGIN — Supabase 런타임은 25·587 아웃바운드 차단)

## 연합뉴스 인사·부고 메일
`/people-news`에서 사용자가 인사·부고를 조회하고 즉시 수집하거나, 개인별 메일 수신 여부·한국 시간 발송 시각과 **이전 발송 내역 제외**(`yonhap_notice_subscriptions.exclude_sent`, 기본 켬 — 예약·즉시 통틀어 이미 보낸 소식 다음부터만, 새 소식이 없으면 즉시 수신은 `skipped`)를 설정한다. 수집·메일 발송은 모두 Supabase Edge Function `yonhap-notices`가 맡는다. RSS 요약은 기사 앞부분(대개 80자)만 담아 중간에서 끊기므로, 요약에 본문 끝의 발신지 표기 `(서울=연합뉴스)`가 없거나 말줄임으로 끝나면 원문 본문으로 갈음한다(`article.ts`, 기사 영역 앵커 안에서 상용구 앞까지 최대 60문단·4,000자, 1회 60건·동시 6건, 실패·앵커 없음이면 RSS 요약 유지). 항목만 붙이면 소제목이 어긋나 오귀속된다. 채워 둔 저장분은 이후 수집이 더 짧은 RSS 요약으로 되돌리지 않는다. 요청 본문 `action`(요청 본문 `action`: `collect`|`send-digests`|`send-now`|`preview`). 매일 07:00 KST 수집, 매분 pg_cron `invoke_yonhap_notice_email()`이 `send-digests`로 due 구독을 claim해 **사내 SMTP 릴레이(465, `MEDIA_SMTP_*`)**로 로그인 이메일에 보낸다. "지금 수신"·"메일 미리보기"는 Vercel `/api/people-news/email`이 세션 JWT를 붙여 Edge Function에 위임한다(`lib/people-news/edge.ts`, `sync`도 같은 헬퍼). Microsoft 계정 연결·Mail.Send는 더 쓰지 않는다(Graph 발송은 Exchange Online에만 남고 아마란스 메일함에 오지 않았음 — SQL `2026-09-16-yonhap-notice-smtp.sql`). 운영·설정·검증 절차는 `docs/yonhap-notices.md`. 수집 직후 새 부고를 관리 매체·부서와 매칭해 알림 구독자에게 묶음 메일을 보낸다(`docs/media-directory.md`).
