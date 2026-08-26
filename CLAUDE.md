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
- `/admin/claude-usage` — Claude Code 사용량 대시보드(admin): Claude Code 실시간·멤버 활동 CSV·조직/관리형 설정 탭

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
- `/api/admin/claude-usage/{summary,members,imports,imports/[id],orgs,health}` — Claude 사용량 대시보드(admin). 런북 `docs/claude-usage.md`

### Supabase Tables (guide feature)
- `nlm_notebooks` — Notebook metadata with `is_visible`, `sort_order`
- `nlm_chat_messages` — Per-user chat history with `citations` JSONB
- `nlm_sources` — Source metadata cache per notebook (includes `storage_path`, `original_filename`)

### Supabase Tables (Claude usage feature)
- `claude_orgs, claude_code_daily, claude_code_daily_model, claude_code_requests, claude_ingest_log, claude_csv_imports, claude_member_activity` — Claude Code 사용량 대시보드 데이터(OTLP 수신 + 월간 CSV 업로드). 런북 `docs/claude-usage.md`

### Key Patterns

**Client-side state**: All pages are `"use client"`. State persisted via localStorage through `useLocalStorage` hook. Each feature uses its own storage key.

**Shared participant flow**: `useParticipants` hook provides add/remove/clear/setAll. Shared components reused across ladder and team pages.

**내 팀 구성(개인별)**: 멤버 소스는 후보 명단, 실제 내 팀은 사용자가 `MyTeamPicker`(`lib/my-team.ts` 매칭 로직)로 골라 `user_members`에 저장. `/settings` 카드·`/ladder`·`/team` 버튼에서 진입, `/food`는 내 팀이 기본 목록.

**Guide Q&A**: Frontend proxies to FastAPI nlm-service via `nlmFetch()` helper (`frontend/src/lib/nlm-service.ts`). Notebook metadata and chat history stored in Supabase. NLM service handles NotebookLM API calls. Admin manages notebooks/sources, controls visibility for user page.

**Provider 선택(Dooray/Teams)**: 채널 알림·멤버 소스·개인 DM을 관리자 설정(`notify_provider`/`member_source_provider`/`dm_provider`)으로 축별 선택. 멤버 소스는 `dooray`/`users`(앱 사용자 명단 = `user_profiles`, 권장)/`teams`. Teams 알림·DM은 표준 라이선스용 Teams 웹후크 트리거 규격(Adaptive Card 봉투)으로 보낸다. 서버는 `lib/notify`(Notifier), 클라이언트는 `lib/members`(MemberSource)를 통해서만 provider를 다룬다. 런북: `docs/teams-integration.md`.

**Claude 사용량 대시보드**: `lib/claude-usage/`가 OTLP 페이로드 파싱(`otlp.ts`)·수집 인증(`ingest-auth.ts`)·저장(`ingest-handler.ts`/`ingest-store.ts`)·CSV 파싱(`members-csv.ts`)·집계(`aggregate.ts`)·관리자 권한 체크(`require-admin.ts`)·관리형 설정 JSON 생성(`managed-settings.ts`)을 담당. 런북: `docs/claude-usage.md`.

**Environment Variables**:
- `NLM_SERVICE_URL` — NLM service endpoint (default: `http://localhost:8090`, prod: `https://inje-nlm-service.fly.dev`)
- `GW_LOGIN_ENABLED` — `true`일 때만 `POST /api/auth/gw`(GW 로그인 백엔드) 활성, 기본 404. GW가 토큰 기반 사용자 조회 API를 제공해 이메일을 서버 검증할 수 있을 때까지 꺼둔다
- `TEAMS_GRAPH_CLIENT_SECRET` — Graph app-only 클라이언트 시크릿 (멤버 가져오기를 Graph 방식으로 쓸 때만 필수; `teams_members_webhook_url` 웹훅 방식이면 불필요; settings에 저장 금지)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service_role 키(서버 전용, 클라이언트 노출 금지). Claude 사용량 대시보드 관리자 API에서 사용
- `CLAUDE_OTEL_INGEST_TOKEN` — Claude Code OTLP 수신 엔드포인트(`/api/otel/v1/*`) Bearer 인증 토큰(`openssl rand -hex 32`)

### Directory Layout (frontend/src/)
- `components/` — Organized by feature: `ladder/`, `team/`, `food/`, `guide/`, `settings/`, `shared/`, `layout/`
- `hooks/` — `useLocalStorage`, `useParticipants`, `useBgm`, `useTts`, `useSettings`(관리자 전역 설정), `useProviderSettings`(provider 3축)
- `lib/` — Pure logic: `ladder.ts`, `team-divider.ts`, `dooray.ts`, `nlm-service.ts`, `providers.ts`(provider 상수/파서), `settings-server.ts`(서버 settings 로더), `teams-graph.ts`(Graph app-only), `notify/`(Notifier: dooray/teams/messages/recipients), `members/`(MemberSource: dooray/teams)
- `types/` — TypeScript interfaces: `ladder.ts`, `team.ts`, `dooray.ts`, `guide.ts`
