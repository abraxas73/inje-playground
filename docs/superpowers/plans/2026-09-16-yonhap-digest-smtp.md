# 인사·부고 소식 메일 SMTP 이관 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/people-news` "메일로 소식 받기"(예약 메일·지금 수신·미리보기)를 Microsoft Graph에서 Edge Function `yonhap-notices`의 SMTP 릴레이(wblock.innogrid.com:465)로 옮겨 아마란스 메일함에 도착하게 한다.

**Architecture:** 다이제스트 템플릿·조회·발송·이력 기록을 모두 Edge Function으로 옮기고 요청 본문 `action`(`collect`|`send-digests`|`send-now`|`preview`)으로 분기한다. pg_cron `yonhap-notice-email-every-minute`는 Vercel 대신 Edge Function `{"action":"send-digests"}`를 호출하고, Vercel 라우트 `/api/people-news/email`은 세션 JWT를 붙여 Edge Function에 위임하는 얇은 프록시가 된다. Microsoft 메일 연결 조건(RPC·UI)은 제거한다.

**Tech Stack:** Deno 2 Edge Function(`smtp.ts` 재사용), Supabase pg_cron + pg_net + Vault, Next.js 16 API 라우트, Vitest, `supabase db query --linked`.

**Spec:** 이 문서의 "설계" 절(별도 스펙 없음 — 사용자 결정: "Edge Function으로 전부 이관").

## Global Constraints
- 발송 자격 증명은 Edge Function secrets `MEDIA_SMTP_*`만 사용. 저장소·로그·응답에 비밀값·이메일 본문을 남기지 않는다(오류 문구는 `sanitize`).
- 발신자: `MEDIA_SMTP_USER`, 표시 이름 `인사·부고 알림`(부고 알림 메일과 동일).
- 예약 슬롯 규칙(사용자·KST 날짜당 1건, 마지막 성공 이후 수집분, 1분 쿨다운) 변경 없음 — RPC `claim_yonhap_notice_emails`·`claim_yonhap_notice_send_now` 유지.
- 배포 순서: **Edge Function 배포 → SQL 적용 → Vercel 배포.** (구 Edge Function은 본문을 무시하고 cron 비밀값 요청을 모두 수집으로 처리하므로 SQL을 먼저 적용하면 매분 수집이 돈다.)

## 설계
- Edge Function `digest.ts`: `buildDigest`·`loadDigest`(프런트 `lib/people-news/{digest,load-digest}.ts` 이식). `digest-mail.ts`: `runScheduledDigests`(cron), `runSendNow`(사용자), `previewDigest`.
- `handler.ts`: 본문 `action` 파싱(빈 본문 = `collect`), `verifyUser`(JWT→role·people_news 접근) 공용화. `send-digests`는 cron 비밀값만, `send-now`·`preview`는 사용자 JWT만.
- `index.ts`: `createUserClient(jwt)`(anon key + Authorization) 주입 — `claim_yonhap_notice_send_now`가 `auth.uid()`로 동작.
- SQL `docs/sql/2026-09-16-yonhap-notice-smtp.sql`: `set_yonhap_notice_subscription`·`claim_yonhap_notice_send_now`에서 Microsoft 조건 제거, `yonhap_notice_mail_connection` 삭제, `invoke_yonhap_notice_email`을 Edge Function 호출로 교체(Vault `yonhap_project_url`·`yonhap_sync_secret` 재사용).
- Vercel: `/api/people-news/email` GET→`preview`, POST→`send-now` 프록시(`lib/people-news/edge.ts` 공용, `sync` 라우트도 사용). `/api/people-news/subscription`에서 `mailReady`·`connectedEmail` 제거. `SubscriptionCard`에서 Microsoft 연결 UI 제거. `lib/ms`의 `mail` 스코프 옵션 제거. `/api/cron/yonhap-notice-email`, `lib/people-news/{mail,digest,load-digest}.ts`, `scripts/configure-yonhap-email.mjs` 삭제.

---

### Task 1: Edge Function 다이제스트 템플릿·조회 (`digest.ts`)
**Files:** Create `supabase/functions/yonhap-notices/digest.ts`, `supabase/functions/yonhap-notices/digest_test.ts`; Modify `deno.json`(test task).
**Produces:** `buildDigest(notices, total, asOf, lastSyncedAt, appUrl, periodFrom?) → {subject, html, text}`, `loadDigest(admin, from, to, appUrl) → {digest, count}`.
- [ ] 테스트: HTML 이스케이프·`javascript:` 링크 거절·"수신 해제" 링크·제목 형식·`loadDigest`가 `created_at` 범위와 `count: "exact"`를 쓰는지(fake fetch로 쿼리스트링 검증).
- [ ] 구현: 프런트 `digest.ts`/`load-digest.ts` 그대로 이식(Deno ICU로 `ko-KR`·`Asia/Seoul` 포맷 동일).
- [ ] `deno task test` 통과.

### Task 2: 발송 러너 (`digest-mail.ts`)
**Files:** Create `digest-mail.ts`, `digest-mail_test.ts`.
**Produces:** `runScheduledDigests({admin, smtp, appUrl, send?, now?, limit?}) → {claimed, sent, failed, cancelled, skipped?}`, `runSendNow({admin, smtp, appUrl, user: {client, id, email, emailConfirmed}, send?, now?}) → {status, body, headers?}`, `previewDigest({admin, appUrl, now?}) → {subject, html, text, count, from, to}`, `SENDER_NAME`.
- [ ] 테스트(fake supabase fetch + fake send): SMTP 미설정이면 claim 하지 않음 / 구독 해제된 claim은 cancelled / 정상 발송 sent+provider_id=messageId+item_count / 거절·SmtpError는 failed(이메일 제거된 문구) / send-now: 미인증 400·SMTP 미설정 503(claim 전)·쿨다운 429+Retry-After·성공 200 `{count, from, to}`·실패 502 + manual_deliveries failed / preview는 24시간 범위, 쓰기 없음.
- [ ] 구현 후 `deno task test` 통과.

### Task 3: 핸들러 액션 분기 (`handler.ts`, `index.ts`)
**Files:** Modify `handler.ts`, `index.ts`, `handler_test.ts`.
- [ ] 테스트: 빈 본문·`{}`·`{"action":"collect"}`는 기존과 동일 / 알 수 없는 action 400 / `send-digests`는 사용자 JWT면 403, cron이면 runner 호출 후 `{ok, claimed, sent…}` / `send-now`·`preview`는 cron 비밀값이면 403, JWT면 verifyUser 거친 뒤 runner 호출(응답 status·Retry-After 전달) / 액션 요청은 수집·`sync_runs` 기록 없음.
- [ ] 구현: `readAction`, `verifyUser`, `Dependencies.createUserClient`, `digests` 주입. `index.ts`에 `SUPABASE_ANON_KEY` 기반 `createUserClient`.
- [ ] `deno task test` 통과.

### Task 4: SQL
**Files:** Create `docs/sql/2026-09-16-yonhap-notice-smtp.sql`; Modify `scripts/check-yonhap-scheduling.sql`, `scripts/deploy-yonhap-notices.py`.
- [ ] SQL 작성(위 설계). `check-yonhap-scheduling.sql`: `ms_connections` 없이 이메일 인증된 user로 검증, `yonhap_notice_mail_connection` 참조 제거.
- [ ] 운영 적용은 Task 7에서(Edge Function 배포 후).

### Task 5: Vercel 프록시·구독 API·UI
**Files:** Create `frontend/src/lib/people-news/edge.ts`; Modify `api/people-news/email/route.ts`, `api/people-news/sync/route.ts`, `api/people-news/subscription/route.ts`, `components/people-news/SubscriptionCard.tsx`, `lib/ms/{oauth,connections}.ts`, `api/ms/{connect,callback}/route.ts`; Delete `api/cron/yonhap-notice-email/route.ts`, `lib/people-news/{mail,digest,load-digest}.ts`, `__tests__/people-news-mail.test.ts`, `scripts/configure-yonhap-email.mjs`; Rewrite `__tests__/people-news-send-now.test.ts`.
- [ ] `callYonhapFunction(supabase, action, {timeoutMs}) → {status, body}`: `auth.getSession()` 없으면 401, `fetch(${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/yonhap-notices, {action})`, 네트워크 실패는 502.
- [ ] email 라우트: GET→preview(그대로 전달), POST→send-now(status·Retry-After 전달). 테스트 재작성.
- [ ] subscription GET: `mailReady`·`connectedEmail` 제거, `requireNewsUser` 사용. PUT: 55000 분기 제거.
- [ ] SubscriptionCard: Microsoft 연결 블록·`mailReady`·`useMsCallbackQuery` 제거, 문구 "사내 메일 서버(SMTP)로 계정 이메일에 보냅니다".
- [ ] `lib/ms`: `mail` 옵션·`MAIL_SCOPE` 제거(connect/callback `mail:` 인자 제거). `ms-oauth.test.ts`·`ms-connections.test.ts`가 `mail`을 참조하면 수정.
- [ ] `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` 통과.

### Task 6: 문서
**Files:** `docs/yonhap-notices.md`, `CLAUDE.md`(환경 변수·연합뉴스 메일 절), `docs/media-directory.md`(관련 문장 있으면).
- [ ] 메일 경로 SMTP·Microsoft 연결 불필요·cron→Edge Function·배포 절차 갱신, `YONHAP_EMAIL_CRON_SECRET` 제거.

### Task 7: 배포·검증
- [ ] `supabase functions deploy yonhap-notices --use-api` → `supabase db query --linked --file docs/sql/2026-09-16-yonhap-notice-smtp.sql` → `scripts/check-yonhap-scheduling.sql` 통과 → `cd frontend && NODE_OPTIONS= vercel --prod --yes --scope seunguk-kangs-projects` → alias 확인.
- [ ] 검증: `/people-news` "지금 수신" → `yonhap_notice_manual_deliveries` sent(provider_id=Message-ID) → 아마란스 수신 확인. cron 1분 후 `cron.job_run_details` 정상, pg_net 응답 200.
- [ ] 커밋·PR·squash 머지, 워크트리 main 리셋, handoff·memory 갱신.
