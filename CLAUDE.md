# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**INNOCREW** — 이노그리드 구성원을 위한 사내 포털(한국어 UI, 정식 주소 `https://innocrew.innogrid.com`). 모노레포: Next.js `frontend/`(웹 화면 + 모든 서버 API, Vercel), Flutter `mobile/`(iOS·Android·macOS·Windows 앱 하나의 코드), FastAPI `ppt-service/`(PPT 생성 엔진, Vercel 별도 프로젝트). 데이터는 Supabase(Postgres·Auth·Storage·Realtime·Edge Function). 기능: 사내 AI 비서 이노봇(웹 `/chat`·앱, Teams·Confluence·SharePoint·아마란스·앱 기능 도구), 아마란스 그룹웨어(앱 직접, 웹·Claude 커넥터는 데스크톱 앱 중계), PPT 만들기, RFP 분석, Claude 사용량·비용·성과, 마케팅 Master DB, 인사·부고, 사다리·커피 타임·뭐 먹지 등. 전체 구조는 `docs/architecture.md`.

## Commands

### Frontend

```bash
./frontend/scripts/restart-frontend.sh        # 재시작 (기본 포트 3003)
./frontend/scripts/restart-frontend.sh 3000   # 포트 지정
./frontend/scripts/deploy-frontend.sh         # Vercel Preview 배포
./frontend/scripts/deploy-frontend.sh prod    # Vercel Production 배포
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
claude-jobs status   # GitLab 집계 07:45 · Teams 격언 08:00 · Claude 사용량 CSV 09:05 · Claude 시트 실행기 상시 — 일정·마지막 종료 코드·로그 (런북 docs/launchd-jobs.md)
```

## Architecture

기능별 상세(페이지·API·테이블·패턴)는 `.claude/rules/` 아래 규칙 파일에 있고, 해당 경로의 파일을 다룰 때 자동으로 로드된다: `rfp.md`(RFP 분석·솔루션 카탈로그·SharePoint·Microsoft 연결), `claude-usage-cost.md`(Claude 사용량·비용·성과 지표), `marketing.md`(마케팅 Master DB), `media-news.md`(관리 매체·부고 알림·인사·부고 메일), `ppt-maker.md`(PPT 만들기), `mobile.md`(모바일 앱). 그 기능을 작업할 때는 먼저 해당 파일을 읽는다.

### App Router Pages (`frontend/src/app/`)
- `/admin/page-permissions` — 사용자별 페이지 접근 권한. `lib/page-access.ts` 공용 카탈로그로 사용자 메뉴 2단계 그룹·홈 카드·페이지/API 검사를 통합. 기존 역할 기본값 유지, admin 전체 허용, RLS와 버전 검사 RPC. 런북 `docs/page-access.md`. **PAGES에 키를 추가하면 DB 함수 `valid_page_permissions`·`has_page_access`의 키 목록도 갱신**(최신 `docs/sql/2026-10-23-gw-app-page-keys.sql`, 빠지면 관리자 저장이 `Invalid permissions`로 실패 — `gw-mail.test.tsx`가 SQL과 대조).
- `/` — Home with feature cards linking to sub-pages. 데스크톱 브라우저(macOS·Windows)에서 이 계정으로 그 OS의 데스크톱 앱에 로그인한 기록(`login_history` User-Agent `InnogridApp/… (macOS|windows)`, 대소문자 무시)이 없으면 맨 위에 설치 안내 카드(`components/home/DesktopAppCard`, `GET /api/desktop/presence`; ‘다음에’는 localStorage 30일)
- `/ladder` — Ladder game: participants + results matched via animated canvas ladder
- `/team` — Team divider: random team assignment with card holder distribution and min/max constraints
- `/food` — Restaurant/cafe finder with Kakao Maps integration + PAYCO 식권 가맹점 검색
- `/settings` — Dooray API token and project ID configuration (stored in localStorage) + Microsoft 계정 연결 카드(`MicrosoftAccountCard`: SharePoint 업로드용 위임 OAuth, refresh 토큰은 서버가 암호화 보관) + **SharePoint 업로드 기본 폴더**(`SharepointFolderCard` — 프로젝트에 폴더가 없을 때 쓰는 개인 폴더, user_settings `rfp_sharepoint_folder`) + **알림 채널 개인 워크플로우 URL**(`NotifyChannelCard` — 내 알림만 이 채널로, user_settings `teams_notify_webhook_url`, 테스트 전송 버튼)
- `/manual` — 사용자 매뉴얼(`lib/manual/sections.ts`, 메뉴 맨 끝 링크). 웹 기능 + 모바일·데스크톱 앱 기능을 함께 다루며 앱 절은 `app` 필드로 목차·제목에 "(모바일·데스크톱 앱)"을 표시. 재현 이미지는 `images` 필드
- `/chat`, `/chat/[id]` — 이노봇 웹 채팅(페이지 키 `assistant`, 메뉴 AI 맨 앞·상단 바 버튼): 서버 저장 대화·SSE 스트리밍·도구 칩·쓰기 확인 카드·첨부(5개·10MB)·연결 상태 띠. 웹의 아마란스는 데스크톱 앱 중계 읽기만. 설계 `docs/superpowers/specs/2026-10-15-llm-portal-phase1-design.md`
- `/admin/audit` — Audit 로그(admin): 로그인 이력 + 액션 이력 통합 조회(구분 로그인 성공/**로그인 실패**/**로그인 시도**/액션/API 호출, 카테고리, KST 기간, 검색 — 사용자·액션·IP·상세, 페이지 CSV). 뷰 `audit_log`는 service_role만 읽는다. **보존 100일**(pg_cron `audit-log-retention-100d` 매일 04:10 KST → `purge_audit_logs(100)`, 사람별·플랫폼별(iOS·Android·macOS·Windows) 마지막 앱 로그인 1건은 설치 안내 카드·관리자 사용자 목록의 설치 현황 판단용으로 남김 — `docs/sql/2026-10-16-audit-retention.sql`, `2026-10-20-audit-retention-app-logins.sql`). 런북 `docs/audit-log.md`
- `/admin/users` — 사용자 관리(admin): 표 형태 목록(이름·이메일·소속·역할 인라인 변경·가입일 = `user_profiles.created_at`·최근 로그인·**앱 설치 현황** iOS/Android/Windows/Mac 마지막 로그인 버전), 검색(이름·이메일·소속·직책)·역할 필터(통계 카드 클릭)·정렬, 행 클릭 → `UserDetailSheet`. 설치 현황은 `GET /api/users`가 `login_history`의 앱 User-Agent(`lib/desktop/presence.ts` `installsFromRows`)로 붙인다
- `/admin/directory` — 조직/팀(admin): 사내 조직도(그룹웨어 아마란스, inno-creed MCP — Claude 사용량 표 "소속" 컬럼의 출처)·Claude 멤버·초대·조직·설정(관리형 설정 JSON) 탭
- `/org` — 조직도(페이지 키 `org_chart`, user 이상): 아마란스 조직도를 부서 트리 카드 + 소속 직원 표로(검색·전체 펼치기/접기·하위 부서 포함). 데이터 `GET /api/directory/org`(company_departments + company_directory, service role). 매일 07:40 GitHub Actions `gw-directory-sync`가 연동 계정으로 동기화. 런북 `docs/company-directory.md` §1.5
- `/sharepoint` — SharePoint 문서(user 이상): 즐겨찾기(링크 붙여 넣기·★)·자주 쓰는/나와 공유/주변에서 많이 보는 문서·검색. 본인 Microsoft 연결 권한으로만. 홈 카드 `SharepointDocsCard`
- `/teams/chat` — 내가 속한 Teams 그룹·1:1 채팅을 목록에서 골라 우리 화면에서 읽고 보내기(본인 Microsoft 위임 토큰, 5초 폴링). 본문은 원문 서식(줄·굵게·목록·링크·멘션)을 서버 `teamsHtmlToMarkdown`이 이스케이프한 마크다운(`markdown` 필드, 글자색은 버림)으로 그린다 — 본문 그림(Graph hostedContents)은 마크다운 그림 주소 `GET /api/teams/chat/image?chat&message&content`(본인 토큰 중계, 그림 형식만·`private` 하루 캐시)로 웹·앱이 그리고 누르면 크게, 외부 주소 그림은 [이미지] 글 — `text` 평문은 이노봇·브리핑·검색용. 메시지 반응은 말풍선 아래 칩(종류별 수·누가, 누르면 같이 붙이기/떼기)·😊+로 6개 중 골라 붙이기(`POST /api/teams/chat/reaction` — Graph setReaction/unsetReaction, Chat.ReadWrite로 충분·옛 like 값은 그대로 떼기, 조직 사용자 정의 반응(넵·대박 등) — 그림(`reactionContentUrl`)은 본문 그림과 같은 중계 주소로 칩에 작게, 모르는 주소 형식이면 `:이름:`; 붙이기·떼기는 beta `reactionId`(`이름;…`, 그래서 메시지 목록은 beta로 읽음)를 beta setReaction에 `{reactionType:"custom", reactionId}`로(문서에 없음, 2026-10-27 실측) — 조직 목록 API가 없어 메시지 조회 뒤(`after`) 처음 본 반응을 ID·그림째 등록부 `teams_custom_reactions`(service role만, `docs/sql/2026-10-27-teams-custom-reactions.sql`)에 저장 → `GET /api/teams/chat/custom-reactions`(목록·`?name=` 그림)로 고르기 창 구분선 아래에 전부(새 방에서도), 감사엔 붙임/뗌만). 목록 위 돋보기 → 검색 화면(앱 메신저 검색과 같은 구성: 대화방 이름·구성원 + 대화 내용 두 묶음, 결과를 누르면 그 메시지 강조)(`GET /api/teams/chat/search?q=` — Microsoft Search `chatMessage` — Chat.ReadWrite에 더해 `ChannelMessage.Read.All`(관리자 동의) 필요, 없으면 409 `reconnect_search`·관련도 순 25건·채널 메시지 제외, 검색어 저장·로그 없음). 런북 `docs/teams-integration.md` §3-D
- `/apps` — 모바일 앱 설치 안내(user 이상): iPhone TestFlight(설정에서 신청), **Android는 신청 없이 Google Play 정식 스토어 링크**(`ANDROID_PLAY_URL`, 2026-10-24 프로덕션 출시 — 앱 사용 신청은 iOS만, API는 android 신청 400; 스토리지 APK는 릴리스 백업용), 현재 버전·릴리스 노트. 데이터는 settings `mobile_release`(릴리스 스크립트 `mobile/scripts/release-mobile.sh`가 씀). 런북 `docs/mobile-app.md` §배포
- `/gw/mail` — 아마란스 메일(user 이상, 페이지 키 `gw_mail` = 앱 네이티브 메일과 같은 키): 받은메일 최근 20통·본문(텍스트)·안 읽음 되돌리기. 서버는 아마란스에 직접 닿지 않고 Claude 커넥터와 같은 `mcp_calls` 중계로 **사용자의 데스크톱 앱**에 `list_mail_inbox`·`read_mail`·`mark_mail_unread`를 맡긴다(앱 미실행이면 409 `no_app` 안내). 웹 메뉴에는 없고(`hidden`, 매뉴얼 링크·주소로 진입) 상위 메뉴는 앱 하단 바와 같은 일상·AI·업무 세 그룹 + 맨 끝 사용자 매뉴얼 링크(`lib/page-access.ts` PAGE_GROUPS, 앱 전용 아마란스 그룹은 웹에 두지 않음 — 2026-10-11 사용자 결정). 런북 `docs/mobile-app.md` §웹 메일
- `/proposal/general`, `/proposal/general/[id]` — 제안도우미-일반현황(페이지 키 `proposal`, 업무 그룹): 프로젝트명(필수)·고객사 템플릿(.pptx/.potx) + 일반현황 PPT 버전(누구나 등록, 최신 기본·숨기기만) → 고객사 양식 일반현황 PPT. 방식 ① 모양 유지(`restyle` — 도형·표·그림·차트를 벡터 그대로 옮기고 고객사 마스터·테마 글꼴·accent1·슬라이드 크기만) ② 레이아웃 재구성(`reflow` — Claude 배치 JSON, 원문에 없는 숫자면 실패). 고른 버전은 내려받기(`/api/proposal/profiles/[id]/file`)와 앞 3장 미리보기(`…/previews`, 올린 사람 브라우저가 `pptx-preview`+`html-to-image`로 그려 `ppt/proposal/previews/<id>/N.jpg`에 저장 — 서버에 PPT 렌더러 없음). 내 결과·공유된 결과(`share_enabled`). 테이블 `proposal_profiles`·`proposal_jobs`(버킷 `ppt`의 `proposal/`), SQL `docs/sql/2026-10-20-proposal-general.sql`, 엔진 ppt-service `/proposal/outline`·`/proposal/build`(`service/proposal.py`), 서버 `lib/proposal/`, 스펙 `docs/superpowers/specs/2026-10-20-proposal-general-design.md`
- `/ppt` — PPT 만들기: 원고(텍스트·파일·URL)·프롬프트(모델·템플릿 선택) → 이노그리드 표준 템플릿 PPTX(ppt-service). 목록은 내 덱 / **공유된 덱**(`?all=1` — 누구나, share_enabled인 덱만, 남의 덱은 공유 뷰로 열고 삭제 불가; 전체 덱은 관리자 `/admin/ppt` — 소유자·**공유 여부** 열 포함). 소유자 칸은 이메일 대신 이름(팀)(`lib/ppt/owner-label.ts`). URL 원고는 서버가 본문을 가져와 저장(`lib/ppt/web-source.ts`, SSRF 가드는 알림 웹훅과 공유). /ppt/[id] 버전·구성 보기·피드백 재생성·공유·Teams·SharePoint, /ppt/s/[token] 로그인 필요 공유 뷰. 관리자는 `/admin/settings`에서 LLM 규칙(settings `ppt_llm_rules`)과 템플릿 업로드(`ppt_templates`, 샘플 덱 빌드로 검증)를 관리. 같은 페이지에 모바일 앱 홈 브리핑 Claude 스위치(settings `mobile_briefing_llm`)와 모바일 앱 비서(이노봇) 켜기·하루 상한(settings `assistant_enabled`·`assistant_daily_turns`)도 있다. 런북 `docs/ppt-maker.md`

### API Routes (`frontend/src/app/api/`)
- `GET /api/dooray/members?projectId=X` — Proxies Dooray API to fetch project members
- `POST /api/food/payco` — Proxies bizplus.payco.com for PAYCO 식권 merchant search
- `GET /api/teams/members` — Microsoft Graph(app-only) 또는 멤버 목록 웹훅으로 `settings.teams_group_id` 그룹 멤버 조회 (`{id, name, email}`)
- `GET /api/teams/chat`(내가 속한 채팅 목록 — 마지막 메시지 순, `lastMessagePreview` 기준), `GET·POST /api/teams/chat/messages?chat=` — Teams 그룹·1:1 채팅 읽기·보내기(본인 위임 토큰 `Chat.ReadWrite` — 이 테넌트는 사용자 동의를 막아 두어 `MS_SCOPES` 전부를 앱 등록 API 사용 권한에 넣고 관리자 동의해야 함, 런북 §3-F; 페이지 `/teams/chat`, 첨부 파일은 `contentUrl` 링크). 런북 `docs/teams-integration.md` §3-D
- `/api/sharepoint/{feed,search,favorites}` — 개인 SharePoint·OneDrive(RFP·Teams 채팅과 같은 Microsoft 연결 `ms_connections`, 이미 받은 `Files.ReadWrite.All`·`Sites.Read.All`로 충분 — 새 권한·재연결 없음): 자주 쓰는(인사이트 used, 꺼진 조직은 `/me/drive/recent`로 갈음)·나와 공유·주변에서 많이 보는 문서, `/search/query` 문서 검색, 즐겨찾기(user_settings `sharepoint_favorites`, 최대 30). 페이지 `/sharepoint`, 이노봇 도구 `sharepoint_*`(읽기는 docx·pdf·pptx(ppt-service /extract)·xlsx·hwp·txt·html), PPT 만들기 URL 원고에 SharePoint 문서 링크. 런북 `docs/mobile-app.md` §SharePoint
- `/api/confluence/{search,feed,spaces,pages,pages/[id],weekly-report}` — 개인 Confluence(Jira와 같은 Atlassian 연결·토큰, `jira_connections.scopes`에 Confluence 권한이 있을 때만, `CONFLUENCE_ENABLED=true`일 때 권한 요청): 검색·멘션/지켜보기/내 편집·공간·페이지 만들기(회의록·주간보고)·본문 읽기. 페이지 `/confluence`(+`/new`·`/weekly`), 이노봇 도구 `confluence_*`. 런북 `docs/mobile-app.md` §Confluence
- `GET /api/members/users` — 앱 사용자 명단(user_profiles, guest 제외) → `{id, name, email}` (멤버 소스 provider `users`)
- `GET /api/members/directory` — 사내 조직도 명부(company_directory active, service role로 읽음) → `{id: email, name, email, team}` (멤버 소스 provider `directory`)
- `/api/users/members` — 내 팀(user_members: name, email, external_id, dooray_member_id, is_card_holder) GET/POST(교체)/PATCH(법카)/DELETE
- `GET·PUT /api/users/favorites` — 앱 페이지 즐겨찾기(계정 단위 user_settings `app_favorites`, `{path,title}` 최대 30, 앱 안 경로만 — `lib/app-favorites.ts`). 데스크톱·모바일 앱의 이노봇 위 ★ 목록과 화면 제목 옆 ☆
- `GET·PUT /api/users/home-dashboard` — 데스크톱 앱 홈 위젯 배치(계정 단위 user_settings `home_dashboard`, `lib/home-dashboard.ts`, 없으면 빈 배열 → 앱 기본 배치). 모바일은 쓰지 않는다
- `GET·PUT·DELETE /api/users/sharepoint-folder` — 개인 SharePoint 업로드 기본 폴더(링크를 본인 Graph 권한으로 해석해 저장, `lib/rfp/user-folder.ts`·`lib/ms/folder-route.ts` 공용)
- `GET·PUT·DELETE·POST /api/users/notify-channel` — 개인 채널 알림 웹훅(POST는 테스트 1건 발송). https 공개 주소만(`lib/notify/url-guard.ts`), 감사 로그에는 호스트만 남긴다
- `GET /api/users/[id]`, `DELETE /api/users/[id]` — 관리자용 사용자 상세(프로필·설정·로그인 이력·조직도 소속·활동 요약)/삭제(개인 데이터 → 프로필 → auth.users; 자기 자신·관리자 역할 거부). `/admin/users` 행 클릭 → `components/admin/users/UserDetailSheet`
- `GET /api/admin/audit?kind&category&q&from&to&page&pageSize` — Audit 로그 조회(admin, 뷰 `audit_log`). 기록은 `lib/audit.ts`(`logAudit`·`logLogin`·`logAuthEvent`)·`lib/audit-proxy.ts`(proxy가 변경 요청 자동 기록), 조건 해석은 `lib/audit-query.ts`. 런북 `docs/audit-log.md`
- `GET·POST /api/admin/test-accounts`, `PATCH·DELETE /api/admin/test-accounts/[id]`, `POST /api/auth/password-login` — 테스트 전용 이메일 계정(애플 심사·공개 테스트, admin, `app_metadata.test_account=true`, 권한은 user와 같음; 비밀번호는 생성·재설정 응답으로 한 번만, 감사에 남기지 않음). 테스트 계정이 아닌 이메일 세션은 프록시가 거부(웹 `/login?error=email_not_allowed`, API 403 `email_login_not_allowed`, `lib/auth/test-account.ts`), 가입은 Auth Hook `hook_before_user_created`가 막음(`docs/sql/2026-10-23-test-accounts.sql`). 화면 `/admin/users` "테스트 계정" 카드, 로그인 화면 "테스트 계정으로 로그인". 런북 `docs/test-accounts.md`
- `POST /api/auth/events` — 로그인 전(익명) 감사 기록: 로그인 시도·실패·차단만(event·provider 화이트리스트, IP당 5분 30건 상한). 성공 로그인은 `/auth/callback`이 `login_history`에 남긴다
- `GET /api/admin/directory`, `POST /api/admin/directory/sync` — 사내 조직도 명부 조회/동기화(동기화는 관리자 세션 또는 수집 토큰; 로컬 `frontend/scripts/company-directory-sync.py`가 inno-creed MCP `find_person` 전사 명부를 밀어 넣음). 런북 `docs/company-directory.md`
- `/api/ppt/uploads`(kind=template은 admin), `/api/ppt/decks[/[id]/(regenerate|versions/[no]/file|share|teams|sharepoint)]`, `/api/ppt/shared/[token][/file]`, `GET /api/admin/ppt/decks`(관리자 `/admin/ppt` 전체 덱 관리), `GET·POST /api/admin/ppt/templates`, `PATCH /api/admin/ppt/templates/[id]` — PPT 만들기(규칙 `.claude/rules/ppt-maker.md`)
- `/api/mcp`(Streamable HTTP JSON-RPC, inno-creed 57개 중 56개 노출 — 본문 인라인 이미지 내려받기 1개는 실측 캡처 뒤 추가, `lib/mcp/protocol.ts` `WITHHELD_TOOLS`) · `/.well-known/oauth-protected-resource` · `/oauth/consent` · 크론 `/api/cron/mcp-purge` — claude.ai 조직 커넥터 "INNOGRID 아마란스"가 `mcp_calls` 중계로 데스크탑 앱의 아마란스를 부르는 Claude 커넥터(Supabase OAuth 2.1). 런북 `docs/mobile-app.md` §Claude 커넥터
- `GET /api/gw/mail`, `GET /api/gw/mail/[muid]`, `POST /api/gw/mail/[muid]/unread`, `GET /api/gw/mail/search?q&sort` — 웹 메일(데스크톱 앱 중계, `lib/gw/mail.ts` parseInbox·parseDetail·parseSearch·callApp; 본문·인자·검색어는 기록하지 않음). 검색은 앱의 기기 안 색인 도구 `search_mail_index`(tools.json 밖, Claude 커넥터에는 안 보임; 앱 1.6.9+)
- `GET /api/gw/approvals`, `GET /api/gw/schedule?date=YYYY-MM-DD`(오늘 KST ±7일) — 웹 결재·일정 읽기 전용(페이지 `/gw/approvals`·`/gw/today`, 키 `gw_approvals`·`gw_today`, 메뉴 숨김·메일 화면 탭으로 오감). 데스크톱 앱 중계로 기존 도구 `pending_approvals`·`list_events`(`lib/gw/agenda.ts` parseApprovals·parseEvents, 결재 항목은 아마란스 웹 문서 링크만)
- `POST /api/app/events` — 앱 장애 신호(아마란스 자동 로그인 실패·세션 만료·예외 타입 이름, 정해진 값만, 감사 category `app`, 사용자당 10분 30건). 자동 로그인 실패가 1시간 안 2명 이상이면 관리자 채널 알림(6시간 1회). 로그인 페이지 상시 점검은 `.github/workflows/gw-login-probe.yml`. 런북 `docs/mobile-app.md` §장애 신호
- `GET /api/desktop/presence` — 내 계정의 macOS·Windows 앱 최근 로그인 시각(홈 설치 안내 카드용, `lib/desktop/presence.ts`). `GET /api/desktop/release`·`/api/desktop/download/[platform]` — 데스크톱 앱 배포 정보·설치 파일
- `GET /api/desktop/update/appcast?platform&version`·`GET /api/desktop/update/artifact/[platform]/[version]`·`POST /api/desktop/update-failure` — 데스크톱 자동 업데이트(macOS Sparkle·Windows WinSparkle, 로그인 Bearer, 설치 파일은 서버가 버킷 `desktop-releases`에서 받아 흘려줌, 실패는 감사 category `desktop`; 앱 `mobile/lib/release/desktop_updater.dart`)
- `GET /api/mobile/release` — 플랫폼별 최신 앱 버전·설치 링크(user 이상, 쿠키·Bearer; `lib/mobile/release.ts`). 웹 `/apps`와 앱 시작 시 업데이트 확인이 쓴다. `POST /api/mobile/release/sharepoint` — 최신 Android APK 사본을 SharePoint 폴더(settings `mobile_sharepoint_folder`)에 `innogrid-app-<X.Y.Z>.apk`로 올림(릴리스 스크립트가 `CRON_SECRET`+operator 관리자 이메일로, 또는 관리자 세션; 그 관리자의 Microsoft 연결 사용)
- `/api/proposal/{uploads,profiles[/id],jobs[/id[/file]]}` — 제안도우미-일반현황(서명 업로드, 일반현황 버전 등록·숨기기, 생성 요청 `after()`·공유·삭제·내려받기). 감사 카테고리 `proposal`
- `POST /api/chat/turn`(SSE), `GET /api/chat/{config,status,conversations}`, `GET·PATCH·DELETE /api/chat/conversations/[id]`, `POST /api/chat/attachments`, 크론 `/api/cron/chat-purge`, 관리자 `GET /api/admin/assistant-usage` — 이노봇 대화 플랫폼(`lib/chat/*`: 엔진·마스킹·도구 위치·저장소). 거버넌스는 턴 API 한 곳: 권한 → 허용 모델(settings `assistant_models`) → 하루 상한(`assistant_usage`) → 마스킹 → 도구 목록. 보존 settings `assistant_retention_days`(기본 90). 이노봇은 우리 앱 기능도 쓴다(도구를 추가하면 계약 JSON `lib/assistant/tool-contract.json`부터 — 앱 실행 도구 이름·등급의 원본, 앱 테스트가 대조; 서버 전용 `lib/assistant/feature-tools.ts`: Jira 내 업무·인사·부고·뭐 먹지·PPT 만들기/내 PPT, 페이지 권한 검사, 쓰기 확인 카드 줄은 서버가 `needs_action.card`로 — PPT 덱 생성은 `lib/ppt/start.ts` `startDeck`을 웹 API와 공유)
- `POST /api/assistant/turn`(1.7.0 미만 앱용 — 2026-10-16부터 Claude를 부르지 않고 업데이트 안내 426 `app_update_required`만 돌려준다, 보급 후 삭제), `POST /api/assistant/execute` — 모바일 비서 이노봇(user 이상): 앱은 1.7.0부터 `/api/chat/turn`, execute는 Teams 서버 도구(teams_chats·teams_mentions·teams_send, `teams_chat` 페이지 권한). 런북 `docs/mobile-app.md` §비서
- `POST /api/mobile/briefing` — 홈 '데일리 브리핑' 카드(user 이상, 제목 수준 payload ≤16KB → 서버가 다시 자름 → Claude Sonnet 5.5 2~3문장; settings `mobile_briefing_llm=off` 또는 `ANTHROPIC_API_KEY` 없음이면 `{enabled:false}`; 감사엔 건수만). `GET /api/teams/mentions?days=` — 홈 브리핑용 Teams 답장 대기(본인 위임 토큰, 그룹 멘션·1:1, 내가 답한 건 제외). 런북 `docs/mobile-app.md` §홈 브리핑
- `POST /api/mobile/login`, `POST /api/mobile/web-token`, 페이지 `/auth/mobile` — 모바일 앱 인증(규칙 `.claude/rules/mobile.md`, 런북 `docs/mobile-app.md`). `/api/*`는 `Authorization: Bearer`도 받는다(`createServerSupabase`·proxy 분기 — Next 16 미들웨어 진입점은 `src/proxy.ts` → `lib/supabase-middleware.ts`)

### Supabase Tables (guide feature — 2026-10-23 코드 삭제, 테이블·버킷 `nlm-files`만 남김)
- `nlm_notebooks` — Notebook metadata with `is_visible`, `sort_order`
- `nlm_chat_messages` — Per-user chat history with `citations` JSONB
- `nlm_sources` — Source metadata cache per notebook (includes `storage_path`, `original_filename`)

### Supabase Tables (audit)
- (보존 100일, 위 `/admin/audit` 참고) `login_history`(user_id, logged_in_at, ip_address, user_agent), `action_history`(user_id·user_email·action·category·detail jsonb + `ip_address`/`user_agent`/`source` app|api), 조회 뷰 `audit_log`(둘의 union, service_role 전용, kind는 `source`와 `detail.result`로 login|login_failed|login_attempt|action|api 구분) — SQL `docs/sql/2026-09-07-audit-log.sql`. 익명 설문 응답과 OTel 수집은 기록하지 않는다

### Supabase Tables (company directory)
- `company_directory`(email PK, units[], division/headquarters/team, duty, position, active, synced_at), `company_directory_sync` — 사내 조직도 명부(아마란스). SQL `docs/sql/2026-08-29-company-directory.sql`

### Supabase Tables (ppt)
- `ppt_decks`, `ppt_deck_versions`(삭제 없음, `template_id`·`template_name`, source_kind text|file|pptx|url), `ppt_templates`(업로드 템플릿, 비활성화만), 버킷 `ppt`(`source/`·`decks/`·`templates/`) — SQL `docs/sql/2026-09-30-ppt-maker.sql`, `2026-10-01-ppt-templates.sql`, `2026-10-01-ppt-url-source.sql`

### Supabase Tables (mcp)
- `mcp_calls`(MCP 도구 호출 중계 행: status·result jsonb·worker, RLS, 앱은 2초 폴링(Realtime 발행 제외 — 2026-10-21 슬로우 쿼리), 응답 후 삭제·10분 크론 정리) — SQL `docs/sql/2026-10-10-mcp-calls.sql`

### Supabase Tables (chat)
- `chat_conversations`·`chat_messages`·`chat_tool_calls`(결과 원문 없이 요약만)·`chat_attachments`(버킷 `chat`)·`assistant_usage`(사용자×KST 날짜, RPC `chat_usage_add`) — RLS 본인만, SQL `docs/sql/2026-10-15-chat-portal.sql`, 쓰기 확인 중복 실행 방지는 `docs/sql/2026-10-15-chat-tool-calls-once.sql`(승인은 status `running`으로 먼저 claim)

### Key Patterns

**내 팀 구성(개인별)**: 멤버 소스는 후보 명단, 실제 내 팀은 사용자가 `MyTeamPicker`(`lib/my-team.ts` 매칭 로직)로 골라 `user_members`에 저장. `/settings` 카드·`/ladder`·`/team` 버튼에서 진입, `/food`는 내 팀이 기본 목록.

**Provider 선택(Dooray/Teams)**: 채널 알림·멤버 소스·개인 DM을 관리자 설정(`notify_provider`/`member_source_provider`/`dm_provider`)으로 축별 선택. 채널 알림은 개인 설정(`user_settings.teams_notify_webhook_url`)이 있으면 그 사람의 알림만 Teams 워크플로우로 보낸다(`personalNotifyOverrides`). 멤버 소스는 `dooray`/`directory`(사내 조직도 명부 = `company_directory`, 전 직원·팀, 외부 연동·동의 불필요, 권장)/`users`(앱 사용자 명단 = `user_profiles`)/`teams`(Graph 앱 권한 동의 또는 웹훅 필요). Teams 알림·DM은 표준 라이선스용 Teams 웹후크 트리거 규격(Adaptive Card 봉투)으로 보낸다. 서버는 `lib/notify`(Notifier), 클라이언트는 `lib/members`(MemberSource)를 통해서만 provider를 다룬다. 런북: `docs/teams-integration.md`.

**사내 조직도 명부**: `lib/directory/parse.ts`가 아마란스 `deptPath`(회사>회사>부문>본부>센터>팀)를 `units[]`·division/headquarters/team으로 분해. 동기화는 서버가 아니라 **로컬 스크립트**가 inno-creed MCP(stdio, 그룹웨어 로그인 필요)를 호출해 API로 밀어 넣는 푸시형. Claude 사용량 `summary`/`members` API가 이메일로 조인해 `team`/`division`을 붙인다.

**Environment Variables**:
- `CRON_SECRET` — Vercel 크론(`/api/cron/*`)·릴리스 스크립트의 SharePoint 단계 Bearer 인증
- `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, `JIRA_REDIRECT_URI` — 개인 Jira·Confluence 연결(Atlassian 3LO OAuth). `JIRA_TOKEN_ENC_KEY` — 그 토큰 암호화 키(64자 hex, 없으면 `MS_TOKEN_ENC_KEY`). `JIRA_PROJECTS`, `JIRA_STORY_POINTS_FIELD` — 성과 지표 Jira 수집 범위·스토리 포인트 필드
- `DOORAY_SITE`, `DOORAY_ORGANIZATION_ID`, `DOORAY_TOKEN_ENC_KEY` — 개인 Dooray 연결(사이트·조직, 토큰 암호화 키)
- `GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_GROUPS` — 성과 지표 GitLab 수집(Vercel IP가 막혀 운영은 로컬 `gitlab-metrics-sync.py`가 푸시)
- `MOBILE_BRIEFING_MODEL`, `CONFLUENCE_WEEKLY_MODEL` — (선택) 앱 홈 브리핑·Confluence 주간보고 초안 모델(기본 Sonnet 5.5)
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
