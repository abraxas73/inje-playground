# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Coneplus Workshop** — a team workshop utility app (Korean UI) built with Next.js. Features ladder games (사다리 게임) and team divider (팀 나누기) with Dooray API integration for importing project members.

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # ESLint (flat config, ESLint 9)
npm start        # Start production server
```

No test framework is configured.

## Tech Stack

- **Next.js 16** with App Router (React 19)
- **Tailwind CSS 4** (PostCSS plugin, not legacy config)
- **TypeScript** (strict mode, `@/*` path alias maps to `./src/*`)

## Architecture

### App Router Pages (`src/app/`)
- `/` — Home with feature cards linking to sub-pages
- `/ladder` — Ladder game: participants + results matched via animated canvas ladder
- `/team` — Team divider: random team assignment with card holder distribution and min/max constraints
- `/settings` — Dooray API token and project ID configuration (stored in localStorage)

### API Routes (`src/app/api/`)
- `GET /api/dooray/members?projectId=X` — Proxies Dooray API to fetch project members. Token passed via `x-dooray-token` header. Server-side only (avoids CORS).
- `/api/dooray/debug` — Debug endpoint for Dooray API

### Key Patterns

**Client-side state**: All pages are `"use client"`. State persisted via localStorage through `useLocalStorage` hook. Each feature uses its own storage key (e.g., `ladder-participants`, `team-participants`).

**Shared participant flow**: `useParticipants` hook provides add/remove/clear/setAll. Shared components (`ParticipantInput`, `ParticipantList`, `DoorayImportButton`) are reused across ladder and team pages.

**Ladder game** (`src/lib/ladder.ts`): Generates bridge grid, traces paths column-by-column, renders on canvas with animation. BGM (`useBgm`) and TTS (`useTts`) hooks provide audio feedback.

**Team divider** (`src/lib/team-divider.ts`): Card holders (법인카드 소지자) are distributed round-robin first, then regular members fill remaining slots respecting min/max per team.

### Directory Layout
- `src/components/` — Organized by feature: `ladder/`, `team/`, `settings/`, `shared/`, `layout/`
- `src/hooks/` — `useLocalStorage`, `useParticipants`, `useBgm`, `useTts`
- `src/lib/` — Pure logic: `ladder.ts`, `team-divider.ts`, `dooray.ts`, `bgm-presets.ts`
- `src/types/` — TypeScript interfaces: `ladder.ts`, `team.ts`, `dooray.ts`
