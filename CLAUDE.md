# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**NHN Injeinc Workshop** — NHN 인재아이엔씨 구성원을 위한 팀 워크샵 유틸리티 앱 (Korean UI). Monorepo with Next.js frontend + FastAPI backend (nlm-service). Features ladder games (사다리 게임), team divider (팀 나누기), food finder (뭐 먹지), and guide Q&A (이럴때는 어떻게 하지?) with Dooray API integration and Google NotebookLM integration. Supabase DB for persistent data storage.

## Repository Structure

```
inje-playground/
├── frontend/          # Next.js 16 App Router (React 19)
│   ├── src/           # App source code
│   ├── public/        # Static assets
│   ├── scripts/       # deploy.sh, dev.sh
│   ├── package.json   # Node dependencies
│   └── ...            # Next.js config files
├── nlm-service/       # FastAPI backend for NotebookLM Q&A
│   ├── src/           # Python source (main.py, auth.py)
│   ├── scripts/       # nlm-login.sh
│   ├── Dockerfile     # Docker build
│   ├── fly.toml       # fly.io deployment config
│   └── requirements.txt
├── docs/              # Design docs and plans
├── CLAUDE.md          # This file
└── .mcp.json          # MCP server config
```

## Commands

### Frontend (from `frontend/` directory)

```bash
cd frontend
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # ESLint (flat config, ESLint 9)
npm start        # Start production server
```

### nlm-service (from `nlm-service/` directory)

```bash
cd nlm-service
pip install -r requirements.txt
python -m uvicorn src.main:app --host 0.0.0.0 --port 8090 --reload  # Dev server
./scripts/nlm-login.sh  # NotebookLM authentication
```

No test framework is configured.

## Tech Stack

### Frontend
- **Next.js 16** with App Router (React 19)
- **Tailwind CSS 4** (PostCSS plugin, not legacy config)
- **TypeScript** (strict mode, `@/*` path alias maps to `./src/*`)
- **shadcn/ui** components

### Backend (nlm-service)
- **FastAPI** with uvicorn
- **notebooklm-py** for Google NotebookLM API
- **fly.io** deployment with persistent volume

## Architecture

### App Router Pages (`frontend/src/app/`)
- `/` — Home with feature cards linking to sub-pages
- `/ladder` — Ladder game: participants + results matched via animated canvas ladder
- `/team` — Team divider: random team assignment with card holder distribution and min/max constraints
- `/food` — Restaurant/cafe finder with Kakao Maps integration
- `/guide` — Guide Q&A: AI-powered Q&A on company guidelines via NotebookLM
- `/guide/admin` — Admin: notebook/source management (superOnly)
- `/settings` — Dooray API token and project ID configuration (stored in localStorage)

### API Routes (`frontend/src/app/api/`)
- `GET /api/dooray/members?projectId=X` — Proxies Dooray API to fetch project members
- `/api/guide/notebooks` — Notebook CRUD (Supabase + NLM service proxy)
- `/api/guide/notebooks/[id]/sources` — Source management per notebook
- `/api/guide/chat` — Q&A chat (NLM proxy + Supabase history)
- `/api/guide/auth/status` — NLM authentication status

### Key Patterns

**Client-side state**: All pages are `"use client"`. State persisted via localStorage through `useLocalStorage` hook. Each feature uses its own storage key.

**Shared participant flow**: `useParticipants` hook provides add/remove/clear/setAll. Shared components reused across ladder and team pages.

**Guide Q&A**: Frontend proxies to FastAPI nlm-service via `nlmFetch()` helper (`frontend/src/lib/nlm-service.ts`). Notebook metadata and chat history stored in Supabase. NLM service handles NotebookLM API calls.

### Directory Layout (frontend/src/)
- `components/` — Organized by feature: `ladder/`, `team/`, `food/`, `guide/`, `settings/`, `shared/`, `layout/`
- `hooks/` — `useLocalStorage`, `useParticipants`, `useBgm`, `useTts`
- `lib/` — Pure logic: `ladder.ts`, `team-divider.ts`, `dooray.ts`, `nlm-service.ts`
- `types/` — TypeScript interfaces: `ladder.ts`, `team.ts`, `dooray.ts`, `guide.ts`

# currentDate
Today's date is 2026-03-08.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
