# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**NHN Injeinc Workshop** — NHN 인재아이엔씨 구성원을 위한 팀 워크샵 유틸리티 앱 (Korean UI). Monorepo with Next.js frontend + FastAPI backend (nlm-service). Features ladder games (사다리 게임), team divider (팀 나누기), food finder (뭐 먹지), and guide Q&A (이럴때는 어떻게 하지?) with Dooray API integration and Google NotebookLM integration. Supabase DB for persistent data storage.

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

### API Routes (`frontend/src/app/api/`)
- `GET /api/dooray/members?projectId=X` — Proxies Dooray API to fetch project members
- `/api/guide/notebooks` — Notebook CRUD (GET list / POST create). Supabase meta + NLM service proxy
- `/api/guide/notebooks/[id]` — Notebook update (PATCH) / delete (DELETE)
- `/api/guide/notebooks/[id]/sources` — Source CRUD (GET list / POST add / DELETE remove)
- `/api/guide/chat` — POST question → NLM answer + Supabase history save
- `/api/guide/chat/history` — GET per-user chat history from Supabase
- `/api/guide/auth/status` — GET NLM authentication status proxy
- `/api/guide/notebooks/[id]/sources/download` — GET signed URL for source file download
- `/api/guide/nlm/shutdown` — POST stop NLM fly.io machine via Machines API (admin only)
- `/api/admin/chat-history` — GET all users' chat history with filters/pagination (admin only)
- `POST /api/food/payco` — Proxies bizplus.payco.com for PAYCO 식권 merchant search

### Supabase Tables (guide feature)
- `nlm_notebooks` — Notebook metadata with `is_visible`, `sort_order`
- `nlm_chat_messages` — Per-user chat history with `citations` JSONB
- `nlm_sources` — Source metadata cache per notebook (includes `storage_path`, `original_filename`)

### Key Patterns

**Client-side state**: All pages are `"use client"`. State persisted via localStorage through `useLocalStorage` hook. Each feature uses its own storage key.

**Shared participant flow**: `useParticipants` hook provides add/remove/clear/setAll. Shared components reused across ladder and team pages.

**Guide Q&A**: Frontend proxies to FastAPI nlm-service via `nlmFetch()` helper (`frontend/src/lib/nlm-service.ts`). Notebook metadata and chat history stored in Supabase. NLM service handles NotebookLM API calls. Admin manages notebooks/sources, controls visibility for user page.

**NLM auto-shutdown**: Source upload triggers automatic fly.io machine stop via Machines API. `auto_stop_machines = 'stop'` in fly.toml as safety net. `auto_start_machines = true` restarts on next request.

**Environment Variables**:
- `NLM_SERVICE_URL` — NLM service endpoint (default: `http://localhost:8090`, prod: `https://inje-nlm-service.fly.dev`)
- `FLY_API_TOKEN` — Fly.io API token for machine stop/start (Vercel env)
- `FLY_APP_NAME` — Fly app name (default: `inje-nlm-service`)

### Directory Layout (frontend/src/)
- `components/` — Organized by feature: `ladder/`, `team/`, `food/`, `guide/`, `settings/`, `shared/`, `layout/`
- `hooks/` — `useLocalStorage`, `useParticipants`, `useBgm`, `useTts`
- `lib/` — Pure logic: `ladder.ts`, `team-divider.ts`, `dooray.ts`, `nlm-service.ts`
- `types/` — TypeScript interfaces: `ladder.ts`, `team.ts`, `dooray.ts`, `guide.ts`
