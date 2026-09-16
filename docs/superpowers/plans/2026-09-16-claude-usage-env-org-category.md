# Claude 사용량 — 계정 정보 없는 세션 표기·개인 조직 묶기·실행 환경 수집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin/claude-usage`에서 (1) `id:…` 사용자를 "계정 정보 없는 세션"으로 표기, (2) OTel이 자동 등록한 개인 Claude 조직을 드롭다운에서 "기타(개인 계정)" 한 항목으로 묶고, (3) 수집기가 `os.type`·`host.arch`·`service.version`·`terminal.type`을 저장해 컨테이너(linux)와 개인 PC(darwin)를 구분한다.

**Architecture:** `claude_orgs.category`(team|personal|system)로 조직을 분류하고 자동 등록은 personal 기본. 실행 환경은 새 테이블 `claude_code_env_daily`(일·조직·사용자·os·arch·version·terminal → points)에 델타 가산, 요약 API가 사용자별 상위 환경을 붙인다. 조직 필터 `org=personal`은 테이블 조회는 `in(ids)`, RPC(도구·시간대)는 SQL 안에서 category 조인으로 처리한다. 드롭다운은 공용 `OrgSelect`.

**Tech Stack:** Supabase SQL(RPC security definer), Next.js API 라우트, `lib/claude-usage/otlp.ts` 순수 파서, Vitest.

**Spec:** 사용자 요청(2026-09-16 13:23) + 조사 결과(`unknown` 144 식별자·134개 1일·터미널 시간 0·사람 프롬프트).

## Global Constraints
- 기존 합계·집계 로직 변경 없음(라벨·묶음·추가 컬럼만). 과거 데이터의 환경은 소급 불가(수집 시점부터).
- 프롬프트·토큰 등 내용은 새로 저장하지 않는다. 환경 속성은 식별자 4개만.
- SQL은 재적용 안전(멱등). Edge/Vercel 배포 순서: SQL → Vercel(라우트가 새 테이블을 best-effort로 읽는다).

---

### Task 1: SQL — `claude_orgs.category`, `claude_code_env_daily`, `claude_code_env_ingest`, RPC `p_org='personal'`
**Files:** Create `docs/sql/2026-09-16-claude-usage-env-org-category.sql`.
- [ ] category 컬럼(check team|personal|system, default personal), 백필: `Innogrid%` → team, `unknown`·`test-org` → system.
- [ ] `claude_code_env_daily` + RPC `claude_code_env_ingest(p_rows)`; `claude_code_tool_summary`·`claude_code_hourly`의 `p_org` 조건에 `personal` 분기.

### Task 2: 파서·저장 — 환경 속성 추출
**Files:** Modify `frontend/src/types/claude-usage.ts`(`EnvDailyRow`, `UserEnv`, `ClaudeOrg.category`, `UserUsageRow.env`), `lib/claude-usage/otlp.ts`(`environment()`, `EnvAcc`, `parseMetricsPayload` → `env`), `lib/claude-usage/ingest-store.ts`(RPC best-effort), Test `__tests__/claude-usage-otlp.test.ts`.
- [ ] 테스트: 리소스 `os.type`/`host.arch`/`service.version` + 포인트 `terminal.type` → 행 1개 points=포인트 수; 속성 없으면 ''.

### Task 3: 집계·API — 환경 붙이기, 조직 필터 `personal`
**Files:** Modify `lib/claude-usage/aggregate.ts`(`env` 입력 → 사용자별 상위 5), Create `lib/claude-usage/org-filter.ts`(`resolveOrgIds`, `applyOrgFilter`), Modify `api/admin/claude-usage/{summary,prompts,orgs,imports}/route.ts`, Test `__tests__/claude-usage-aggregate.test.ts`.
- [ ] orgs GET/PATCH에 `category`; imports upsert `category: "team"`; summary는 env 테이블 best-effort.

### Task 4: 화면 — 라벨·OrgSelect·환경 컬럼·조직 카테고리 편집
**Files:** Create `lib/claude-usage/org-options.ts`(`orgCategory`, `orgSelectOptions`, `orgBadgeLabel`, `formatEnv`, `displayUser`), `components/admin/claude-usage/OrgSelect.tsx`, Test `__tests__/claude-usage-org-options.test.ts`; Modify `CodeUsageTab.tsx`(라벨·배지·환경 컬럼·CSV), 8개 탭의 Select → `OrgSelect`, `OrgSettingsTab.tsx`(카테고리 선택 저장).
- [ ] OTel 탭(Code·팀별·도구·시간대·프롬프트)은 `personal`·`unknown` 항목 포함, CSV·Office 탭은 팀 조직만.

### Task 5: 문서·검증·배포
- [ ] `docs/claude-usage.md`(라벨·기타(개인 계정)·환경 컬럼·SQL), CLAUDE.md 테이블 절.
- [ ] `npm test`·tsc·lint·build → SQL 운영 적용(검증 쿼리) → Vercel 배포 → 커밋·PR·머지.
