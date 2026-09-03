# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**NHN Injeinc Workshop** — NHN 인재아이엔씨 구성원을 위한 팀 워크샵 유틸리티 앱 (Korean UI). Monorepo with Next.js frontend + FastAPI backend (nlm-service). Features ladder games (사다리 게임), team divider (팀 나누기), food finder (뭐 먹지), and guide Q&A (이럴때는 어떻게 하지?) with Dooray/Microsoft Teams integration (관리자 선택) and Google NotebookLM integration. Supabase DB for persistent data storage.

## Repository Structure

```
inje-playground/
├── frontend/              # Next.js 16 App Router (React 19)
│   ├── src/               # App source code
│   ├── public/            # Static assets
│   ├── scripts/
│   │   ├── restart-frontend.sh   # 프론트엔드 재시작 (포트 인자 지원)
│   │   └── deploy-frontend.sh    # Vercel 배포 (preview/prod)
│   ├── package.json       # Node dependencies
│   └── ...                # Next.js config files
├── nlm-service/           # FastAPI backend for NotebookLM Q&A
│   ├── src/               # Python source (main.py, auth.py)
│   ├── scripts/
│   │   ├── restart-nlm-service.sh  # NLM 서비스 재시작 (venv 자동 관리)
│   │   └── nlm-login.sh            # NotebookLM Playwright 브라우저 로그인
│   ├── Dockerfile         # Docker build
│   ├── fly.toml           # fly.io deployment config
│   └── requirements.txt
├── docs/plans/            # Design docs and implementation plans
├── CLAUDE.md              # This file
└── .mcp.json              # MCP server config (Supabase)
```

## Commands

### Frontend

```bash
./frontend/scripts/restart-frontend.sh        # 재시작 (기본 포트 3003)
./frontend/scripts/restart-frontend.sh 3000   # 포트 지정
./frontend/scripts/deploy-frontend.sh         # Vercel Preview 배포
./frontend/scripts/deploy-frontend.sh prod    # Vercel Production 배포

cd frontend
npm run build    # Production build
npm run lint     # ESLint (flat config, ESLint 9)
```

### nlm-service

```bash
./nlm-service/scripts/restart-nlm-service.sh       # 재시작 (기본 포트 8090, venv 자동 생성)
./nlm-service/scripts/restart-nlm-service.sh 9090   # 포트 지정
./nlm-service/scripts/nlm-login.sh                  # NotebookLM 브라우저 로그인 → storage_state.json 저장
```

No test framework is configured.

### 로컬 launchd 자동화 (운영자 Mac)

```bash
claude-jobs status   # GitLab 집계 07:45 · Teams 격언 08:00 · Claude 사용량 CSV 09:05 — 일정·마지막 종료 코드·로그 (런북 docs/launchd-jobs.md)
```

## Tech Stack

### Frontend
- **Next.js 16** with App Router (React 19)
- **Tailwind CSS 4** (PostCSS plugin, not legacy config)
- **TypeScript** (strict mode, `@/*` path alias maps to `./src/*`)
- **shadcn/ui** components

### Backend (nlm-service)
- **FastAPI** with uvicorn (Python 3.9+)
- **notebooklm-py** for Google NotebookLM API
- **fly.io** deployment with persistent volume for auth cookies

## Architecture

### App Router Pages (`frontend/src/app/`)
- `/` — Home with feature cards linking to sub-pages
- `/ladder` — Ladder game: participants + results matched via animated canvas ladder
- `/team` — Team divider: random team assignment with card holder distribution and min/max constraints
- `/food` — Restaurant/cafe finder with Kakao Maps integration + PAYCO 식권 가맹점 검색
- `/guide` — Guide Q&A: AI-powered Q&A on company guidelines via NotebookLM. Visible notebooks displayed as tabs.
- `/guide/admin` — Admin: notebook/source management, visibility toggle, sort order (superOnly)
- `/admin/chat-history` — Admin: all users' guide Q&A history viewer with filters
- `/settings` — Dooray API token and project ID configuration (stored in localStorage)
- `/manual` — User manual with Playwright-captured screenshots (8 sections)
- `/admin/claude-usage` — Claude Code 사용량(admin, OTel 실시간): Claude Code·팀별 집계·도구 사용·시간대 패턴·프롬프트 탭
- `/admin/claude-chat` — Claude 사용량 Chat/Cowork(admin, 월간 CSV): 채팅·Cowork 멤버 활동 + 팀별 집계 탭, 데이터 기간 선택. CSV 업로드는 웹 UI 없이 `/claude-usage-csv` 스킬·`scripts/claude-usage-upload.sh`가 `POST /api/admin/claude-usage/imports`로 처리
- `/admin/perf` — 성과 지표 전체 조회(admin): 개인용 `/usage/perf`와 같은 5탭 + 팀 필터 + 개인(이름/이메일) 검색. API `GET /api/admin/work-metrics/perf?from&to&team&q`, 집계는 `lib/work-metrics/perf-report.ts` 공용, UI는 `components/usage/PerfDashboard.tsx` 공용
- `/admin/directory` — 조직/팀(admin): 사내 조직도(그룹웨어 아마란스, inno-creed MCP — Claude 사용량 표 "소속" 컬럼의 출처)·Claude 멤버·초대·조직·설정(관리형 설정 JSON) 탭
- `/usage/code`, `/usage/chat`, `/usage/perf` — 개인용 Claude 사용량·성과(user): 본인 것만, 조직장은 자기 말단 조직 전체(units[] 포함 비교 — 팀장→팀, 센터장→센터 산하 전체, 본부장→본부). 조직장 = `company_directory.is_leader`(어드민 조직/팀 탭 체크박스, null이면 duty 자동 판정). `lib/usage-scope.ts`

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
- `GET /api/members/users` — 앱 사용자 명단(user_profiles, guest 제외) → `{id, name, email}` (멤버 소스 provider `users`)
- `/api/users/members` — 내 팀(user_members: name, email, external_id, dooray_member_id, is_card_holder) GET/POST(교체)/PATCH(법카)/DELETE
- `POST /api/otel/v1/metrics`, `POST /api/otel/v1/logs` — Claude Code OTLP/HTTP JSON 수신(Bearer `CLAUDE_OTEL_INGEST_TOKEN`), RPC `claude_code_ingest`로 일 단위 합산
- `/api/admin/claude-usage/{summary,members,imports,imports/[id],orgs,health,org-members,tools,hourly,prompts}` — Claude 사용량 대시보드(admin). 런북 `docs/claude-usage.md`
- `GET /api/users/[id]`, `DELETE /api/users/[id]` — 관리자용 사용자 상세(프로필·설정·로그인 이력·조직도 소속·활동 요약)/삭제(개인 데이터 → 프로필 → auth.users; 자기 자신·관리자 역할 거부). `/admin/users` 행 클릭 → `components/admin/users/UserDetailSheet`
- `GET /api/admin/directory`, `POST /api/admin/directory/sync` — 사내 조직도 명부 조회/동기화(동기화는 관리자 세션 또는 수집 토큰; 로컬 `frontend/scripts/company-directory-sync.py`가 inno-creed MCP `find_person` 전사 명부를 밀어 넣음). 런북 `docs/company-directory.md`
- `GET /api/usage/{scope,code,chat,perf,tools,hourly}` — 개인용 사용량·성과(로그인 사용자, guest 제외). 서버가 usage-scope로 허용 이메일 계산(본인/조직장은 말단 조직 전체). hourly는 RPC `claude_code_hourly_emails`(SQL `2026-08-31-usage-scope.sql`)
- `GET /api/cron/work-metrics?source=all|jira|confluence|gitlab&from&to` — 성과 지표 일 수집(Vercel Cron 07:30 KST, `CRON_SECRET` 또는 관리자 세션). env `ATLASSIAN_*`/`GITLAB_*` 미설정 소스는 스킵. 설계 `docs/superpowers/specs/2026-08-31-claude-roi-integrations-design.md`

### Supabase Tables (guide feature)
- `nlm_notebooks` — Notebook metadata with `is_visible`, `sort_order`
- `nlm_chat_messages` — Per-user chat history with `citations` JSONB
- `nlm_sources` — Source metadata cache per notebook (includes `storage_path`, `original_filename`)

### Supabase Tables (Claude usage feature)
- `claude_orgs, claude_code_daily, claude_code_daily_model, claude_code_requests, claude_ingest_log, claude_csv_imports, claude_member_activity, claude_org_members(멤버·초대 상태 active|pending), claude_code_tool_daily(도구별 일 집계), claude_code_prompts(프롬프트 내용, OTEL_LOG_USER_PROMPTS=1)` — Claude Code 사용량 대시보드 데이터(OTLP 수신 + 월간 CSV 업로드). 런북 `docs/claude-usage.md`

### Supabase Tables (work metrics — 성과 측정)
- `jira_issue_daily, atlassian_account_map, confluence_daily, gitlab_daily(commits·claude_commits=Co-Authored-By: Claude 커밋·MR), gitlab_email_map(커미터 이메일 수동 매핑), work_metrics_sync` — Jira/Confluence/GitLab 일 집계(성과 분모·사이클타임). SQL `docs/sql/2026-08-31-work-metrics.sql`, `docs/sql/2026-09-03-gitlab-claude-commits.sql`, 수집 `lib/work-metrics/`. GitLab은 사내망 로컬 스크립트 `frontend/scripts/gitlab-metrics-sync.py`(launchd)가 `/api/admin/work-metrics/sync`로 푸시. Supabase 조회는 1000행 상한이 있어 대량 조회는 `selectAll`(`lib/work-metrics/common.ts`)로 페이지네이션

### Supabase Tables (company directory)
- `company_directory`(email PK, units[], division/headquarters/team, duty, position, active, synced_at), `company_directory_sync` — 사내 조직도 명부(아마란스). SQL `docs/sql/2026-08-29-company-directory.sql`

### Key Patterns

**Client-side state**: All pages are `"use client"`. State persisted via localStorage through `useLocalStorage` hook. Each feature uses its own storage key.

**Shared participant flow**: `useParticipants` hook provides add/remove/clear/setAll. Shared components reused across ladder and team pages.

**내 팀 구성(개인별)**: 멤버 소스는 후보 명단, 실제 내 팀은 사용자가 `MyTeamPicker`(`lib/my-team.ts` 매칭 로직)로 골라 `user_members`에 저장. `/settings` 카드·`/ladder`·`/team` 버튼에서 진입, `/food`는 내 팀이 기본 목록.

**Guide Q&A**: Frontend proxies to FastAPI nlm-service via `nlmFetch()` helper (`frontend/src/lib/nlm-service.ts`). Notebook metadata and chat history stored in Supabase. NLM service handles NotebookLM API calls. Admin manages notebooks/sources, controls visibility for user page.

**Provider 선택(Dooray/Teams)**: 채널 알림·멤버 소스·개인 DM을 관리자 설정(`notify_provider`/`member_source_provider`/`dm_provider`)으로 축별 선택. 멤버 소스는 `dooray`/`users`(앱 사용자 명단 = `user_profiles`, 권장)/`teams`. Teams 알림·DM은 표준 라이선스용 Teams 웹후크 트리거 규격(Adaptive Card 봉투)으로 보낸다. 서버는 `lib/notify`(Notifier), 클라이언트는 `lib/members`(MemberSource)를 통해서만 provider를 다룬다. 런북: `docs/teams-integration.md`.

**사내 조직도 명부**: `lib/directory/parse.ts`가 아마란스 `deptPath`(회사>회사>부문>본부>센터>팀)를 `units[]`·division/headquarters/team으로 분해. 동기화는 서버가 아니라 **로컬 스크립트**가 inno-creed MCP(stdio, 그룹웨어 로그인 필요)를 호출해 API로 밀어 넣는 푸시형. Claude 사용량 `summary`/`members` API가 이메일로 조인해 `team`/`division`을 붙인다.

**Claude 사용량 대시보드**: `lib/claude-usage/`가 OTLP 페이로드 파싱(`otlp.ts`)·수집 인증(`ingest-auth.ts`)·저장(`ingest-handler.ts`/`ingest-store.ts`)·CSV 파싱(`members-csv.ts`)·집계(`aggregate.ts`)·관리자 권한 체크(`require-admin.ts`)·관리형 설정 JSON 생성(`managed-settings.ts`)을 담당. 런북: `docs/claude-usage.md`, 아키텍처: `docs/claude-usage-architecture.md`.

**Environment Variables**:
- `NLM_SERVICE_URL` — NLM service endpoint (default: `http://localhost:8090`, prod: `https://inje-nlm-service.fly.dev`)
- `GW_LOGIN_ENABLED` — `true`일 때만 `POST /api/auth/gw`(GW 로그인 백엔드) 활성, 기본 404. GW가 토큰 기반 사용자 조회 API를 제공해 이메일을 서버 검증할 수 있을 때까지 꺼둔다
- `TEAMS_GRAPH_CLIENT_SECRET` — Graph app-only 클라이언트 시크릿 (멤버 가져오기를 Graph 방식으로 쓸 때만 필수; `teams_members_webhook_url` 웹훅 방식이면 불필요; settings에 저장 금지)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service_role 키(서버 전용, 클라이언트 노출 금지). Claude 사용량 대시보드 관리자 API에서 사용
- `CLAUDE_OTEL_INGEST_TOKEN` — Claude Code OTLP 수신 엔드포인트(`/api/otel/v1/*`) Bearer 인증 토큰(`openssl rand -hex 32`)

### Directory Layout (frontend/src/)
- `components/` — Organized by feature: `ladder/`, `team/`, `food/`, `guide/`, `settings/`, `shared/`, `layout/`, `admin/claude-usage/`(Claude 사용량 대시보드 탭·차트), `admin/directory/`(사내 조직도 표)
- `hooks/` — `useLocalStorage`, `useParticipants`, `useBgm`, `useTts`, `useSettings`(관리자 전역 설정), `useProviderSettings`(provider 3축)
- `lib/` — Pure logic: `ladder.ts`, `team-divider.ts`, `dooray.ts`, `nlm-service.ts`, `providers.ts`(provider 상수/파서), `settings-server.ts`(서버 settings 로더), `teams-graph.ts`(Graph app-only), `notify/`(Notifier: dooray/teams/messages/recipients), `members/`(MemberSource: dooray/teams), `claude-usage/`(OTLP 파서·CSV 파서·집계·인증)
- `types/` — TypeScript interfaces: `ladder.ts`, `team.ts`, `dooray.ts`, `guide.ts`, `claude-usage.ts`
