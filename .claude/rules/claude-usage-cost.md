---
paths:
  - "frontend/src/app/admin/claude-usage/**"
  - "frontend/src/app/admin/claude-chat/**"
  - "frontend/src/app/admin/claude-cost/**"
  - "frontend/src/app/admin/perf/**"
  - "frontend/src/app/usage/**"
  - "frontend/src/app/api/admin/claude-usage/**"
  - "frontend/src/app/api/admin/claude-cost/**"
  - "frontend/src/app/api/admin/work-metrics/**"
  - "frontend/src/app/api/usage/**"
  - "frontend/src/app/api/otel/**"
  - "frontend/src/app/api/cron/claude-cost/**"
  - "frontend/src/app/api/cron/work-metrics/**"
  - "frontend/src/lib/claude-usage/**"
  - "frontend/src/lib/claude-cost/**"
  - "frontend/src/lib/work-metrics/**"
  - "frontend/src/lib/usage-scope.ts"
  - "frontend/src/lib/__tests__/claude-*"
  - "frontend/src/lib/__tests__/work-metrics*"
  - "frontend/src/components/admin/claude-usage/**"
  - "frontend/src/components/admin/claude-cost/**"
  - "frontend/src/components/usage/**"
  - "frontend/src/types/claude-usage.ts"
  - "frontend/src/types/claude-cost.ts"
  - "frontend/scripts/claude-usage-upload.sh"
  - "frontend/scripts/gitlab-metrics-sync.py"
  - ".claude/skills/claude-usage-csv/**"
  - "docs/claude-usage*.md"
  - "docs/claude-cost.md"
  - "docs/sql/*claude*"
  - "docs/sql/*work-metrics*"
  - "docs/sql/*usage*"
---
# Claude 사용량·비용·성과 지표 (기능 상세)

루트 CLAUDE.md의 기능별 보완 지침. 이 경로의 파일을 다룰 때 자동으로 로드된다. 런북 `docs/claude-usage.md`, `docs/claude-cost.md`, 아키텍처 `docs/claude-usage-architecture.md`.

## 페이지
- `/admin/claude-usage` — Claude Code 사용량(admin, OTel 실시간): Claude Code·팀별 집계·도구 사용·시간대 패턴·프롬프트 탭. 우상단 `$`/`₩` 표시 통화 토글(공용 `components/shared/currency-context.tsx`, 시스템 설정 `usd_krw_rate` 환율 — 비용 관리·Chat/Cowork·개인용 `/usage/code|chat`과 같은 토글, 선택은 브라우저에 기억)
- `/admin/claude-chat` — Claude 사용량 Chat/Cowork(admin, 월간 CSV): 채팅·Cowork 멤버 활동(같은 기간의 Claude Code 프롬프트·**Office 턴** 컬럼 포함) + 팀별 집계 + **Office Agents** 탭(Excel·Word·PowerPoint·Outlook 추가 기능, 조직 설정 Office Agents에 우리 OTLP 수집기를 등록한 Claude 조직 — 7개 모두 등록 2026-09-07), 데이터 기간 선택. CSV 업로드는 웹 UI 없이 `/claude-usage-csv` 스킬·`scripts/claude-usage-upload.sh`가 `POST /api/admin/claude-usage/imports`로 처리
- `/admin/claude-cost` — 비용 관리(admin): 월별 **실제 청구 금액**(Anthropic Stripe 인보이스 — 결제 메일 링크 붙여넣기 → 서버가 `pay.stripe.com/…/pdf`로 PDF를 받아 파싱, PDF 업로드는 보조) + Admin API `cost_report`(Console API 사용분, `CLAUDE_ADMIN_API_KEY` 있을 때만 탭 표시) + 사용량(OTel 활성 사용자·세션·추정 비용, CSV 활성 멤버) 나란히. 월 기준 토글 `발행일 기준`(기본)/`서비스 기간 일할`(일수 비례 배분, 연간 인보이스 12개월 분산 — `?basis=issued|period`), 누락 배지는 서비스 기간 커버리지로 판정, 좌석·좌석당 비용은 티어(Premium/Standard)별 내역 표시, 표시 통화 `$`/`₩` 토글(전역 설정 `usd_krw_rate` 환율 — 시스템 설정 카드 "환율 (USD → KRW)", 저장은 USD 센트·원화는 표시 시 환산; 같은 토글이 Claude Code 사용량·Chat/Cowork·개인용 사용량 화면에도 있음), 청구 합계는 인보이스만(API 비용은 대조용). 조직별 상세(배분액·일수)·인보이스 등록/배정/삭제·PDF. 파서는 pdf.js 글리프 손실(하이픈·대시·마이너스→공백)에 의존하지 않게 설계. 런북 `docs/claude-cost.md`
- `/admin/perf` — 성과 지표 전체 조회(admin): 개인용 `/usage/perf`와 같은 5탭 + 팀 필터 + 개인(이름/이메일) 검색. API `GET /api/admin/work-metrics/perf?from&to&team&q`, 집계는 `lib/work-metrics/perf-report.ts` 공용, UI는 `components/usage/PerfDashboard.tsx` 공용
- `/usage/code`, `/usage/chat`, `/usage/perf` — 개인용 Claude 사용량·성과(user): 본인 것만, 조직장은 자기 말단 조직 전체(units[] 포함 비교 — 팀장→팀, 센터장→센터 산하 전체, 본부장→본부). 조직장 = `company_directory.is_leader`(어드민 조직/팀 탭 체크박스, null이면 duty 자동 판정). `lib/usage-scope.ts`. 어드민과 같은 지표·표(모델별 비용, 토큰/프롬프트, 프롬프트 사람/자동, 팀별 집계, 조직/팀 검색 필터, 총계 행, 도구·시간대, CSV 데이터 기간 선택, 노는 시트, CSV 내려받기, `/usage/chat`의 Office 턴 컬럼·Office Agents 카드)를 허용 범위 안에서만 보여주고, **프롬프트 내용 탭은 개인용에 없다**. 팀별 집계는 `lib/claude-usage/code-team-summary.ts`·`chat-team-summary.ts` 공용

## API
- `POST /api/otel/v1/metrics`, `POST /api/otel/v1/logs` — Claude Code OTLP/HTTP JSON 수신(Bearer `CLAUDE_OTEL_INGEST_TOKEN`), RPC `claude_code_ingest`로 일 단위 합산
- `POST /api/otel/v1/traces` — Claude for M365 추가 기능(pivot.claude.ai) 커스텀 OTel 수집기(CORS preflight 처리, Bearer `CLAUDE_OFFICE_OTEL_TOKEN` — 모든 멤버 브라우저에 배포되는 저권한 토큰). 파서 `lib/claude-usage/otlp-traces.ts`가 집계 속성만 읽어 `claude_office_trace_log`에 스팬을 남기고 프롬프트·도구 입출력·문서 URL은 버린다. 집계는 RPC `claude_office_usage`(턴=agent.query, 자식 스팬은 trace_id로 귀속) → `GET /api/admin/claude-usage/office`, `GET /api/usage/office`(개인, 스코프 이메일만)
- `/api/admin/claude-usage/{summary,members,imports,imports/[id],orgs,health,org-members,tools,hourly,prompts,office}` — Claude 사용량 대시보드(admin). 런북 `docs/claude-usage.md`
- `/api/admin/claude-cost/{invoices, invoices/[id], invoices/[id]/pdf, monthly, api-cost, api-cost/sync}`, `GET /api/cron/claude-cost`(매일 08:00 KST 최근 3일 재수집) — 비용 관리(admin). 파서·집계 `lib/claude-cost/`(money·stripe-invoice·invoice-ingest·anthropic-cost-report·monthly, 순수 함수는 vitest)
- `GET /api/usage/{scope,code,chat,perf,tools,hourly,office}` — 개인용 사용량·성과(로그인 사용자, guest 제외). 서버가 usage-scope로 허용 이메일 계산(본인/조직장은 말단 조직 전체) — `chat?periodEnd=`·`perf?team&q`는 그 범위 안에서만 좁히는 필터. code는 totals·users·daily·models(어드민 summary와 같은 구성), chat은 행마다 같은 기간의 Claude Code 프롬프트(사람/자동)·조직도 소속(parent_unit)을 붙인다. 대량 조회는 `selectAll`. hourly는 RPC `claude_code_hourly_emails`(SQL `2026-08-31-usage-scope.sql` → `2026-09-03-usage-hourly-users.sql`에서 users 컬럼 추가, isodow 1=월)
- 성과 API(`/api/admin/work-metrics/perf`, `/api/usage/perf`)는 `freshness`(소스별 마지막 수집·48시간 오래됨)·`compare=1`(직전 기간·도입 전후 4주 총계, 도입일 상수 `lib/work-metrics/adoption.ts`)·`durations`(RPC `work_items_time_stats` 행: 리드·사이클·대기·MR 리드 p50/p90/분포, grp all|week:|user:|scope:)를 함께 내린다. 활동 시간대는 `…/perf/hourly?from&to&team&kinds`(RPC `work_items_hourly`, **팀·조직 합계만**, 대상·기여자 3명 미만 suppressed (RPC `work_items_contributors`), 개인은 본인만) — `lib/work-metrics/{freshness,compare,totals,hourly,items,durations-view}.ts`, 화면 `components/usage/PerfHourlyTab.tsx`, 공용 히트맵 `components/shared/HourHeatmap.tsx`
- `GET /api/cron/work-metrics?source=all|jira|confluence|gitlab&from&to` — 성과 지표 일 수집(Vercel Cron 07:30 KST, `CRON_SECRET` 또는 관리자 세션). env `ATLASSIAN_*`/`GITLAB_*` 미설정 소스는 스킵. 설계 `docs/superpowers/specs/2026-08-31-claude-roi-integrations-design.md`

## Supabase 테이블
### Supabase Tables (Claude usage feature)
- `claude_orgs, claude_code_daily(prompts·prompts_auto=자동화 프롬프트, 사람 = prompts−prompts_auto), claude_code_daily_model, claude_code_requests, claude_ingest_log, claude_csv_imports(unknown_headers = 파서가 매핑하지 못해 버린 CSV 칼럼 — 새 지표 감지용, 경고·감사 로그 `claude_csv_unknown_headers`, SQL `2026-09-22-claude-csv-unknown-headers.sql`), claude_member_activity, claude_org_members(멤버·초대 상태 active|pending), claude_code_tool_daily(도구별 일 집계), claude_code_prompts(프롬프트 내용, OTEL_LOG_USER_PROMPTS=1), claude_office_trace_log(Office 추가 기능 스팬 집계 속성 — SQL `2026-09-04-claude-office-traces.sql`, RPC `claude_office_usage` `2026-09-07-claude-office-daily.sql`), claude_orgs.category(team|personal|system — OTel 자동 등록 조직은 personal, 드롭다운 "기타(개인 계정)"·`org=personal`), claude_code_env_daily(실행 환경 os.type·host.arch·service.version·terminal.type 포인트 집계, RPC `claude_code_env_ingest` — SQL `2026-09-16-claude-usage-env-org-category.sql`)` — Claude Code 사용량 대시보드 데이터(OTLP 수신 + 월간 CSV 업로드). claude_code_identity_map(계정 미식별 세션 귀속 — `user.id` → 이메일, RPC `claude_code_accountless_candidates`, SQL `2026-09-16-claude-usage-identity-map.sql`). 계정 속성 없는 텔레메트리는 org `unknown`·user `id:…` = 화면 "계정 정보 없는 세션"(query_source 100% `sdk` — Agent SDK·headless·CI, 조직·설정 탭에서 사람에게 매핑, `org=team`으로 제외). 런북 `docs/claude-usage.md`

### Supabase Tables (Claude 비용 관리)
- `claude_invoices`(invoice_number 유니크·org_id null 허용=미배정·issued_on·subtotal/tax/total_cents 정수·seats·plan·source link|pdf·source_url·storage_path·raw_text), `claude_invoice_lines`(라인·프로레이션 음수·기간·seats/plan), `claude_api_cost_daily`(pk day·workspace_id·description, amount_cents numeric 소수 센트) — RLS 정책 없음 = service role 전용. Storage 버킷 `claude-invoices`(비공개). SQL `docs/sql/2026-09-18-claude-cost.sql`

### Supabase Tables (work metrics — 성과 측정)
- `jira_issue_daily, atlassian_account_map, confluence_daily, gitlab_daily(commits·claude_commits=Co-Authored-By: Claude 커밋·MR), gitlab_email_map(커미터 이메일 수동 매핑), work_metrics_sync` — Jira/Confluence/GitLab 일 집계(성과 분모·사이클타임). SQL `docs/sql/2026-08-31-work-metrics.sql`, `docs/sql/2026-09-03-gitlab-claude-commits.sql`, 수집 `lib/work-metrics/`. GitLab은 사내망 로컬 스크립트 `frontend/scripts/gitlab-metrics-sync.py`(launchd)가 `/api/admin/work-metrics/sync`로 푸시. Supabase 조회는 1000행 상한이 있어 대량 조회는 `selectAll`(`lib/work-metrics/common.ts`)로 페이지네이션
- `work_items`(source·kind·item_key PK, 이슈·MR·커밋 한 행, created_at/started_at/done_at, is_claude — SQL `docs/sql/2026-09-28-work-items.sql`) + RPC `work_items_time_stats`·`work_items_hourly`(service_role). Jira 수집기와 GitLab 로컬 스크립트(`gitlab_items` 소스, 커밋은 기간 replace·MR은 PK upsert)가 일 집계와 함께 쓴다. 백필·대조는 스펙 `2026-09-28-perf-time-metrics-design.md` §4.3

## 패턴
**Claude 사용량 대시보드**: `lib/claude-usage/`가 OTLP 페이로드 파싱(`otlp.ts`)·수집 인증(`ingest-auth.ts`)·저장(`ingest-handler.ts`/`ingest-store.ts`)·CSV 파싱(`members-csv.ts`)·집계(`aggregate.ts`)·관리자 권한 체크(`require-admin.ts`)·관리형 설정 JSON 생성(`managed-settings.ts`)·지표 툴팁 문구(`metric-hints.ts` — 라인 수는 Edit·Write 도구 변경만 집계해 Bash·MCP·SDK 사용자는 0)을 담당. 런북: `docs/claude-usage.md`, 아키텍처: `docs/claude-usage-architecture.md`.
