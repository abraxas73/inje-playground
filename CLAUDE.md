# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**NHN Injeinc Workshop** — NHN 인재아이엔씨 구성원을 위한 팀 워크샵 유틸리티 앱 (Korean UI). Monorepo with Next.js frontend + FastAPI backend (nlm-service). Features ladder games (사다리 게임), team divider (팀 나누기), food finder (뭐 먹지), and guide Q&A (이럴때는 어떻게 하지?) with Dooray/Microsoft Teams integration (관리자 선택) and Google NotebookLM integration. Supabase DB for persistent data storage.

## Commands

### Frontend

```bash
./frontend/scripts/restart-frontend.sh        # 재시작 (기본 포트 3003)
./frontend/scripts/restart-frontend.sh 3000   # 포트 지정
./frontend/scripts/deploy-frontend.sh         # Vercel Preview 배포
./frontend/scripts/deploy-frontend.sh prod    # Vercel Production 배포
```

### nlm-service

```bash
./nlm-service/scripts/restart-nlm-service.sh       # 재시작 (기본 포트 8090, venv 자동 생성)
./nlm-service/scripts/restart-nlm-service.sh 9090   # 포트 지정
./nlm-service/scripts/nlm-login.sh                  # NotebookLM 브라우저 로그인 → storage_state.json 저장
```

테스트: `cd frontend && npm test`(vitest, `src/lib/__tests__`), E2E `npm run test:e2e`(Playwright).

### ppt-service

```bash
cd ppt-service && .venv/bin/uvicorn main:app --port 8091   # 로컬 실행
cd ppt-service && .venv/bin/pytest -q                       # 테스트
cd ppt-service && vercel deploy --prod --yes                # 배포 (ppt-service/README.md 참고)
```

### mobile (Flutter)

```bash
cd mobile && flutter pub get && flutter run                 # 연결된 기기/에뮬레이터
cd mobile && flutter test && flutter analyze                # 테스트·정적 분석
cd mobile && flutter build apk --debug                      # Android 디버그 APK (런북 docs/mobile-app.md)
```

### 로컬 launchd 자동화 (운영자 Mac)

```bash
claude-jobs status   # GitLab 집계 07:45 · Teams 격언 08:00 · Claude 사용량 CSV 09:05 — 일정·마지막 종료 코드·로그 (런북 docs/launchd-jobs.md)
```

## Architecture

기능별 상세(페이지·API·테이블·패턴)는 `.claude/rules/` 아래 규칙 파일에 있고, 해당 경로의 파일을 다룰 때 자동으로 로드된다: `rfp.md`(RFP 분석·솔루션 카탈로그·SharePoint·Microsoft 연결), `claude-usage-cost.md`(Claude 사용량·비용·성과 지표), `marketing.md`(마케팅 Master DB), `media-news.md`(관리 매체·부고 알림·인사·부고 메일), `ppt-maker.md`(PPT 만들기), `mobile.md`(모바일 앱). 그 기능을 작업할 때는 먼저 해당 파일을 읽는다.

### App Router Pages (`frontend/src/app/`)
- `/admin/page-permissions` — 사용자별 페이지 접근 권한. `lib/page-access.ts` 공용 카탈로그로 사용자 메뉴 2단계 그룹·홈 카드·페이지/API 검사를 통합. 기존 역할 기본값 유지, admin 전체 허용, RLS와 버전 검사 RPC. 런북 `docs/page-access.md`.
- `/` — Home with feature cards linking to sub-pages
- `/ladder` — Ladder game: participants + results matched via animated canvas ladder
- `/team` — Team divider: random team assignment with card holder distribution and min/max constraints
- `/food` — Restaurant/cafe finder with Kakao Maps integration + PAYCO 식권 가맹점 검색
- `/guide` — Guide Q&A: AI-powered Q&A on company guidelines via NotebookLM. Visible notebooks displayed as tabs.
- `/guide/admin` — Admin: notebook/source management, visibility toggle, sort order (superOnly)
- `/admin/chat-history` — Admin: all users' guide Q&A history viewer with filters
- `/settings` — Dooray API token and project ID configuration (stored in localStorage) + Microsoft 계정 연결 카드(`MicrosoftAccountCard`: SharePoint 업로드용 위임 OAuth, refresh 토큰은 서버가 암호화 보관) + **SharePoint 업로드 기본 폴더**(`SharepointFolderCard` — 프로젝트에 폴더가 없을 때 쓰는 개인 폴더, user_settings `rfp_sharepoint_folder`) + **알림 채널 개인 워크플로우 URL**(`NotifyChannelCard` — 내 알림만 이 채널로, user_settings `teams_notify_webhook_url`, 테스트 전송 버튼)
- `/manual` — User manual with Playwright-captured screenshots (8 sections)
- `/admin/audit` — Audit 로그(admin): 로그인 이력 + 액션 이력 통합 조회(구분 로그인 성공/**로그인 실패**/**로그인 시도**/액션/API 호출, 카테고리, KST 기간, 검색 — 사용자·액션·IP·상세, 페이지 CSV). 뷰 `audit_log`는 service_role만 읽는다. 런북 `docs/audit-log.md`
- `/admin/directory` — 조직/팀(admin): 사내 조직도(그룹웨어 아마란스, inno-creed MCP — Claude 사용량 표 "소속" 컬럼의 출처)·Claude 멤버·초대·조직·설정(관리형 설정 JSON) 탭
- `/teams/chat` — 내가 속한 Teams 그룹·1:1 채팅을 목록에서 골라 우리 화면에서 읽고 보내기(본인 Microsoft 위임 토큰, 5초 폴링). 런북 `docs/teams-integration.md` §3-D
- `/apps` — 모바일 앱 설치 안내(user 이상): iPhone TestFlight 공개 링크, Android APK 받기(비공개 버킷 `mobile`의 600초 서명 URL, 누를 때 새로 발급), 현재 버전·릴리스 노트. 데이터는 settings `mobile_release`(릴리스 스크립트 `mobile/scripts/release-mobile.sh`가 씀). 런북 `docs/mobile-app.md` §배포
- `/ppt` — PPT 만들기: 원고(텍스트·파일·URL)·프롬프트(모델·템플릿 선택) → 이노그리드 표준 템플릿 PPTX(ppt-service). URL 원고는 서버가 본문을 가져와 저장(`lib/ppt/web-source.ts`, SSRF 가드는 알림 웹훅과 공유). /ppt/[id] 버전·구성 보기·피드백 재생성·공유·Teams·SharePoint, /ppt/s/[token] 로그인 필요 공유 뷰. 관리자는 `/admin/settings`에서 LLM 규칙(settings `ppt_llm_rules`)과 템플릿 업로드(`ppt_templates`, 샘플 덱 빌드로 검증)를 관리. 같은 페이지에 모바일 앱 홈 브리핑 Claude 스위치(settings `mobile_briefing_llm`)도 있다. 런북 `docs/ppt-maker.md`

### API Routes (`frontend/src/app/api/`)
- `GET /api/dooray/members?projectId=X` — Proxies Dooray API to fetch project members
- `/api/guide/notebooks` — Notebook CRUD (GET list / POST create). Supabase meta + NLM service proxy
- `/api/guide/notebooks/[id]` — Notebook update (PATCH) / delete (DELETE)
- `/api/guide/notebooks/[id]/sources` — Source CRUD (GET list / POST add / DELETE remove)
- `/api/guide/chat` — POST question → NLM answer + Supabase history save
- `/api/guide/chat/history` — GET per-user chat history from Supabase
- `/api/guide/auth/status` — GET NLM authentication status proxy
- `/api/guide/notebooks/[id]/sources/download` — GET signed URL for source file download
- `/api/admin/chat-history` — GET all users' chat history with filters/pagination (admin only)
- `POST /api/food/payco` — Proxies bizplus.payco.com for PAYCO 식권 merchant search
- `GET /api/teams/members` — Microsoft Graph(app-only) 또는 멤버 목록 웹훅으로 `settings.teams_group_id` 그룹 멤버 조회 (`{id, name, email}`)
- `GET /api/teams/chat`(내가 속한 채팅 목록), `GET·POST /api/teams/chat/messages?chat=` — Teams 그룹·1:1 채팅 읽기·보내기(본인 위임 토큰 `Chat.ReadWrite`, 관리자 동의 불필요; 페이지 `/teams/chat`). 런북 `docs/teams-integration.md` §3-D
- `GET /api/members/users` — 앱 사용자 명단(user_profiles, guest 제외) → `{id, name, email}` (멤버 소스 provider `users`)
- `GET /api/members/directory` — 사내 조직도 명부(company_directory active, service role로 읽음) → `{id: email, name, email, team}` (멤버 소스 provider `directory`)
- `/api/users/members` — 내 팀(user_members: name, email, external_id, dooray_member_id, is_card_holder) GET/POST(교체)/PATCH(법카)/DELETE
- `GET·PUT·DELETE /api/users/sharepoint-folder` — 개인 SharePoint 업로드 기본 폴더(링크를 본인 Graph 권한으로 해석해 저장, `lib/rfp/user-folder.ts`·`lib/ms/folder-route.ts` 공용)
- `GET·PUT·DELETE·POST /api/users/notify-channel` — 개인 채널 알림 웹훅(POST는 테스트 1건 발송). https 공개 주소만(`lib/notify/url-guard.ts`), 감사 로그에는 호스트만 남긴다
- `GET /api/users/[id]`, `DELETE /api/users/[id]` — 관리자용 사용자 상세(프로필·설정·로그인 이력·조직도 소속·활동 요약)/삭제(개인 데이터 → 프로필 → auth.users; 자기 자신·관리자 역할 거부). `/admin/users` 행 클릭 → `components/admin/users/UserDetailSheet`
- `GET /api/admin/audit?kind&category&q&from&to&page&pageSize` — Audit 로그 조회(admin, 뷰 `audit_log`). 기록은 `lib/audit.ts`(`logAudit`·`logLogin`·`logAuthEvent`)·`lib/audit-proxy.ts`(proxy가 변경 요청 자동 기록), 조건 해석은 `lib/audit-query.ts`. 런북 `docs/audit-log.md`
- `POST /api/auth/events` — 로그인 전(익명) 감사 기록: 로그인 시도·실패·차단만(event·provider 화이트리스트, IP당 5분 30건 상한). 성공 로그인은 `/auth/callback`이 `login_history`에 남긴다
- `GET /api/admin/directory`, `POST /api/admin/directory/sync` — 사내 조직도 명부 조회/동기화(동기화는 관리자 세션 또는 수집 토큰; 로컬 `frontend/scripts/company-directory-sync.py`가 inno-creed MCP `find_person` 전사 명부를 밀어 넣음). 런북 `docs/company-directory.md`
- `/api/ppt/uploads`(kind=template은 admin), `/api/ppt/decks[/[id]/(regenerate|versions/[no]/file|share|teams|sharepoint)]`, `/api/ppt/shared/[token][/file]`, `GET /api/admin/ppt/decks`(관리자 `/admin/ppt` 전체 덱 관리), `GET·POST /api/admin/ppt/templates`, `PATCH /api/admin/ppt/templates/[id]` — PPT 만들기(규칙 `.claude/rules/ppt-maker.md`)
- `GET /api/mobile/release` — 플랫폼별 최신 앱 버전·설치 링크(user 이상, 쿠키·Bearer; `lib/mobile/release.ts`). 웹 `/apps`와 앱 시작 시 업데이트 확인이 쓴다. `POST /api/mobile/release/sharepoint` — 최신 Android APK 사본을 SharePoint 폴더(settings `mobile_sharepoint_folder`)에 `innogrid-app-<X.Y.Z>.apk`로 올림(릴리스 스크립트가 `CRON_SECRET`+operator 관리자 이메일로, 또는 관리자 세션; 그 관리자의 Microsoft 연결 사용)
- `POST /api/mobile/briefing` — 홈 '오늘의 한 마디'(user 이상, 제목 수준 payload ≤16KB → 서버가 다시 자름 → Claude Sonnet 5.5 2~3문장; settings `mobile_briefing_llm=off` 또는 `ANTHROPIC_API_KEY` 없음이면 `{enabled:false}`; 감사엔 건수만). `GET /api/teams/mentions?days=` — 홈 브리핑용 Teams 답장 대기(본인 위임 토큰, 그룹 멘션·1:1, 내가 답한 건 제외). 런북 `docs/mobile-app.md` §홈 브리핑
- `POST /api/mobile/login`, `POST /api/mobile/web-token`, 페이지 `/auth/mobile` — 모바일 앱 인증(규칙 `.claude/rules/mobile.md`, 런북 `docs/mobile-app.md`). `/api/*`는 `Authorization: Bearer`도 받는다(`createServerSupabase`·미들웨어 분기)

### Supabase Tables (guide feature)
- `nlm_notebooks` — Notebook metadata with `is_visible`, `sort_order`
- `nlm_chat_messages` — Per-user chat history with `citations` JSONB
- `nlm_sources` — Source metadata cache per notebook (includes `storage_path`, `original_filename`)

### Supabase Tables (audit)
- `login_history`(user_id, logged_in_at, ip_address, user_agent), `action_history`(user_id·user_email·action·category·detail jsonb + `ip_address`/`user_agent`/`source` app|api), 조회 뷰 `audit_log`(둘의 union, service_role 전용, kind는 `source`와 `detail.result`로 login|login_failed|login_attempt|action|api 구분) — SQL `docs/sql/2026-09-07-audit-log.sql`. 익명 설문 응답과 OTel 수집은 기록하지 않는다

### Supabase Tables (company directory)
- `company_directory`(email PK, units[], division/headquarters/team, duty, position, active, synced_at), `company_directory_sync` — 사내 조직도 명부(아마란스). SQL `docs/sql/2026-08-29-company-directory.sql`

### Supabase Tables (ppt)
- `ppt_decks`, `ppt_deck_versions`(삭제 없음, `template_id`·`template_name`, source_kind text|file|pptx|url), `ppt_templates`(업로드 템플릿, 비활성화만), 버킷 `ppt`(`source/`·`decks/`·`templates/`) — SQL `docs/sql/2026-09-30-ppt-maker.sql`, `2026-10-01-ppt-templates.sql`, `2026-10-01-ppt-url-source.sql`

### Key Patterns

**내 팀 구성(개인별)**: 멤버 소스는 후보 명단, 실제 내 팀은 사용자가 `MyTeamPicker`(`lib/my-team.ts` 매칭 로직)로 골라 `user_members`에 저장. `/settings` 카드·`/ladder`·`/team` 버튼에서 진입, `/food`는 내 팀이 기본 목록.

**Provider 선택(Dooray/Teams)**: 채널 알림·멤버 소스·개인 DM을 관리자 설정(`notify_provider`/`member_source_provider`/`dm_provider`)으로 축별 선택. 채널 알림은 개인 설정(`user_settings.teams_notify_webhook_url`)이 있으면 그 사람의 알림만 Teams 워크플로우로 보낸다(`personalNotifyOverrides`). 멤버 소스는 `dooray`/`directory`(사내 조직도 명부 = `company_directory`, 전 직원·팀, 외부 연동·동의 불필요, 권장)/`users`(앱 사용자 명단 = `user_profiles`)/`teams`(Graph 앱 권한 동의 또는 웹훅 필요). Teams 알림·DM은 표준 라이선스용 Teams 웹후크 트리거 규격(Adaptive Card 봉투)으로 보낸다. 서버는 `lib/notify`(Notifier), 클라이언트는 `lib/members`(MemberSource)를 통해서만 provider를 다룬다. 런북: `docs/teams-integration.md`.

**사내 조직도 명부**: `lib/directory/parse.ts`가 아마란스 `deptPath`(회사>회사>부문>본부>센터>팀)를 `units[]`·division/headquarters/team으로 분해. 동기화는 서버가 아니라 **로컬 스크립트**가 inno-creed MCP(stdio, 그룹웨어 로그인 필요)를 호출해 API로 밀어 넣는 푸시형. Claude 사용량 `summary`/`members` API가 이메일로 조인해 `team`/`division`을 붙인다.

**Environment Variables**:
- `NLM_SERVICE_URL` — NLM service endpoint (default: `http://localhost:8090`, prod: `https://inje-nlm-service.fly.dev`)
- `GW_LOGIN_ENABLED` — `true`일 때만 `POST /api/auth/gw`(GW 로그인 백엔드) 활성, 기본 404. GW가 토큰 기반 사용자 조회 API를 제공해 이메일을 서버 검증할 수 있을 때까지 꺼둔다
- `TEAMS_GRAPH_CLIENT_SECRET` — Graph 클라이언트 시크릿. 멤버 가져오기 Graph 방식(app-only)과 RFP SharePoint 업로드(위임 OAuth 토큰 교환·갱신)에 필수; 멤버 가져오기만 웹훅 방식이면 후자 때문에 여전히 필요. settings에 저장 금지
- `MS_TOKEN_ENC_KEY` — RFP SharePoint 업로드용 Microsoft refresh 토큰 암호화 키(64자 hex, `openssl rand -hex 32`). 교체 시 모든 연결이 재연결 필요
- `MS_ALLOWED_ORIGINS` — (선택) Microsoft OAuth 리디렉션 오리진 허용 목록(쉼표). 기본 `https://inje-playground.vercel.app,http://localhost:3003`
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service_role 키(서버 전용, 클라이언트 노출 금지). Claude 사용량 대시보드 관리자 API에서 사용
- `CLAUDE_OTEL_INGEST_TOKEN` — Claude Code OTLP 수신 엔드포인트(`/api/otel/v1/metrics|logs`) Bearer 인증 토큰(`openssl rand -hex 32`)
- `CLAUDE_OFFICE_OTEL_TOKEN` — Office 추가 기능 트레이스 수신(`/api/otel/v1/traces`) 전용 토큰. claude.ai 조직 설정 Office Agents의 OTLP 헤더 `Authorization=Bearer <값>`에 넣는 값이라 Claude Code 토큰과 분리
- `ANTHROPIC_API_KEY`, `RFP_LLM_MODEL`(기본 claude-opus-5) — RFP 비표준 문서 LLM 폴백 + 카탈로그 기능 추출 + 솔루션 매핑(선택 — 없으면 규칙 엔진만)
- `PPT_SERVICE_URL` — ppt-service 주소(`https://innogrid-ppt-service.vercel.app`)
- `PPT_SERVICE_TOKEN` — 프론트·ppt-service 공통 토큰(`openssl rand -hex 32`, 두 프로젝트 같은 값)
- `PPT_LLM_MODEL` — (선택) 폼에서 모델을 안 골랐을 때의 PPT 생성 모델, 기본 `claude-sonnet-5-5`(폼 선택지 Sonnet 5.5·Opus 5.5는 `types/ppt.ts`). `ANTHROPIC_API_KEY`가 없으면 /ppt는 안내문만 보인다
- `CLAUDE_ADMIN_API_KEY` — (선택) Anthropic Admin API 키(`sk-ant-admin01-…`, Console > Admin keys). 비용 관리의 API 비용 수집(`cost_report`)에만 쓰고, 없으면 그 탭을 숨긴다. settings 저장 금지
- `MARKETING_AI_ENABLED`, `MARKETING_AI_MODEL` — 마케팅 Master DB AI 추천(선택). `ANTHROPIC_API_KEY`와 함께 있을 때만 활성, 없으면 규칙 검증·수동 검수만. 현재 운영 미설정
- `MEDIA_SMTP_HOST`, `MEDIA_SMTP_PORT`, `MEDIA_SMTP_USER`, `MEDIA_SMTP_PASS`, `MEDIA_APP_URL` — **Edge Function secrets**(Vercel 아님). 부고 알림과 인사·부고 소식 메일(예약·지금 수신) SMTPS 발송. 비어 있으면 매칭만 하고 발송·예약 claim을 건너뛴다
- `ATLASSIAN_SITE`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN` — 카탈로그 Confluence 가져오기(기존 성과 지표와 공유)
- `NEXT_PUBLIC_APP_URL` — 예약 메일의 HTTPS 앱 주소(예: `https://inje-playground.vercel.app`)
