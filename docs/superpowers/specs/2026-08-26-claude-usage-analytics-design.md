# Claude 팀 플랜 사용량 통계 대시보드 — 설계

- 날짜: 2026-08-26 · 상태: **설계(승인 대기)**
- 배경: 회사에 claude.ai **Team 플랜 조직 7개**가 있고 요청자가 전부 소유자(Owner/Primary Owner). 시트를 받은 개인별 사용량을 한 곳에서 최대한 자세히 관리하고 싶다.

## 1. 데이터 경로 조사 결과 (2026-08 공식 문서 기준)

| 경로 | 키/권한 | 제공 데이터 | Team 플랜 가용성 |
|---|---|---|---|
| **① Analytics 대시보드 + spend report CSV** (claude.ai > Analytics) | Owner/Primary Owner 로그인(Admin 불가) | 활동 요약(주간 활성, PR, Cowork 등) + 멤버별 활동 테이블 + **사용자별 spend CSV**: user email, account UUID, product, model, request count, prompt/completion tokens, net/gross spend | ✅ 가능 — 단 **spend CSV는 시트 포함량을 초과한 "추가 사용량(extra usage)" 스펜드만 담는다.** 추가 사용량이 꺼진 조직은 스펜드 섹션/내보내기 버튼이 아예 없음. 내보내기 위치: 관리자 설정 > 전체 활동(All activity) > Spend 섹션 > Export Spend Report (또는 분석 대시보드 스펜드 섹션). 데이터는 1일 지연 |
| ② Claude Enterprise Analytics API (`/v1/organizations/analytics/`) | Analytics API key (claude.ai 조직 설정 > API, Primary Owner) | 사용자별 일간 활동(chat·Claude Code·Cowork), 활성자 요약, 프로젝트/스킬/커넥터, 비용·사용량 | ❌ **Enterprise 전용** — Team에는 조직 설정 > API 메뉴 자체가 없음 |
| ③ Claude Code Analytics API (`/v1/organizations/usage_report/claude_code`) | Admin API key (Claude Console) | 사용자별 일간 Claude Code 지표(세션, LoC, 커밋, PR, 도구 수락률, 모델별 토큰·비용) | ❌ **Console(API) 조직 전용** — Team 조직은 Admin 키를 만들 수 없음 |
| ④ OpenTelemetry (Claude Code 클라이언트 설정) | 각 사용자 PC의 managed settings | Claude Code 실시간 지표(세션·토큰·비용·도구), 사용자 식별 포함 | ✅ 플랜 무관 — 단 **Claude Code만**, 전 직원 PC에 설정 배포 필요 |
| ⑤ claude.ai admin UI 비공식 호출(브라우저 자동화/내부 API) | 세션 쿠키 | 대시보드가 보여주는 것 전부 | ⚠️ 무보증·언제든 깨짐·약관 리스크 → **지양** |

결론: **Team 플랜인 이상 사용자별 데이터의 공식 수집 수단은 ①번뿐**이다. 따라서 Phase 1은 CSV/내보내기 업로드 파이프라인으로 만들고, 자동화(API)는 Enterprise 전환(②) 또는 OTel(④, Claude Code 한정)로 열어 둔다.

⚠️ **spend CSV의 한계 (2026-08-26 확인)**: Team 플랜의 spend export는 **초과 사용분 스펜드만** 기록한다(시트에 포함된 기본 사용량은 0원으로 치므로 등장하지 않음; 시트 요금 자체는 인보이스에만 있음). 즉 "누가 얼마나 쓰는가"의 전체 그림은 spend CSV가 아니라 **분석 대시보드의 멤버별 활동 테이블**(채팅 메시지 수, Claude Code 세션 등 제품별 지표)이 쥐고 있다. Phase 1 시작 전에 확인할 것: (a) 각 조직의 추가 사용량(extra usage) 활성 여부, (b) 멤버 테이블 "모두 보기"에 CSV 내보내기가 있는지. 멤버 테이블 내보내기가 없으면 Phase 1의 수집 대상을 재검토한다(초과분 spend CSV + 수동 스크린샷/표 붙여넣기 파서, 또는 ⑤ 비공식 경로 재평가).

### 1.1 Innogrid-ax 조직 실사 결과 (2026-08-26, Primary Owner 계정으로 화면 직접 확인)

| 위치 | 사용자별 데이터 | 내보내기 | 비고 |
|---|---|---|---|
| 분석 > 개요 > 멤버 **"모두 보기"** | 이름·이메일·**채팅 수·Cowork 세션·코드 세션** (활동 멤버 64명) | ✅ **CSV 내보내기** 버튼 | 기간 30/60/90일, 역할·그룹 필터·검색. **Phase 1 주 데이터** |
| 분석 > Claude Code > 생산성 | 멤버별 **이번 달 수락 코드 라인 수** (60명, 페이지네이션) | ✅ **내보내기** 버튼 | 월 단위 선택(◀ 이전 달), 조직 합계 252,110줄·수락률 99.8% |
| 분석 > Claude Code > 사용량(베타) | 스킬·MCP 서버·기능 채택률(조직 단위, 사용자 수만) | ✅ **CSV 다운로드** | 기간 = 당월 1일~오늘. 활성 Claude Code 사용자 67명 |
| 분석 > Claude Code > 값(베타) | **상위 지출자 5명**(익명 ID·아키타입·$·커밋·$/commit), 기간 지출 $9,819, 세션/커밋/PR당 비용, 지출 집중도 | ❌ | Anthropic이 **사용자별 Claude Code 비용을 계산은 함** — UI는 해시 ID로 익명화 |
| 분석 > 채팅 (`/analytics/usage`) | 채팅·프로젝트·아티팩트 기준 상위 멤버("모두 보기") | ❌(화면만) | 1W/1M/3M/1Y |
| 분석 > Cowork | 세션·메시지 기준 상위 멤버 | ❌(화면만) | |
| 분석 > Claude Design / Claude 태그 / 코드 리뷰 | 데이터 없음(미사용) | — | |
| 관리자 설정 > **멤버** | 이름·이메일·**역할·티어(Premium/할당되지 않음)**, 77명 | ✅ **CSV 내보내기** | 시트 배정 명단의 원천 → "노는 시트" 판정에 사용 |
| 관리자 설정 > 결제 | Team 플랜, **97석(17 여유)**, 다음 청구 2026-09-24 US$11,137.50, 청구서 3건 | 청구서 보기 | 시트 요금은 여기만 |
| 관리자 설정 > 사용량 | 사용 크레딧 **꺼짐**(US$0.00) → spend export 자체가 없음 | — | "Enterprise Analytics API — Enterprise에서 사용 가능" 안내만 표시 |

- 화면이 호출하는 내부 엔드포인트(세션 쿠키, 비공식): `/api/organizations/{org}/analytics/activity/users`, `users/rankings`, `activity/timeseries`, `usage/timeseries`, `skills/top`, `mcp/top-connectors`, `outputs/timeseries`. Enterprise Analytics API와 같은 데이터 모델이 뒤에 있음을 확인 — 공식 경로는 Enterprise 전환뿐.
- **Phase 1 수집 대상 확정(조직당 월 4개 파일)**: ① 멤버 활동 CSV(개요 모두 보기, 30일) ② Claude Code 생산성 내보내기(월별 라인 수) ③ Claude Code 사용량 CSV ④ 관리자 멤버 CSV(역할·티어). ①+④ 조인으로 "시트 있는데 활동 0" 판정, ②로 코딩 강도, ③은 조직 채택 지표.

### 1.2 CSV 없이 자동 수집이 가능한가 — 결론 (2026-08-26 검증)

| 제품 | Team 플랜에서 자동 수집 | 방법 |
|---|---|---|
| **Claude Code** (지출의 대부분: 8월 $9,819) | ✅ **공식·중앙 배포·실시간** | **OpenTelemetry**를 claude.ai **관리자 설정 > Claude Code > 관리형 설정(서버 관리형)** 의 `env`로 켠다. 조직 계정으로 로그인한 모든 PC·IDE·데스크톱·클라우드 세션의 Claude Code가 지정 수집기로 지표를 보낸다. 개발자 PC를 건드릴 필요 없고, 관리형 `OTEL_EXPORTER_OTLP_*`는 개발자 설정을 덮어써 끄거나 우회할 수 없다. 사용자 식별 `user.email`·`user.account_uuid`·`organization.id` 자동 첨부(OAuth Team 로그인 포함) |
| 채팅·Cowork·Design·아티팩트 | ❌ 공식 자동 경로 없음 | (a) 분석 대시보드 멤버 활동 CSV(월 1회, 조직당 1파일) (b) Enterprise 전환 → Analytics API (c) 비공식: 대시보드 내부 API(`/api/organizations/{org}/analytics/activity/users` 등)를 소유자 세션 쿠키로 호출 — 미지원·예고 없이 변경·자동 접근은 약관 위반 소지 → **비권장** |
| 전 제품 사용자별 일간 + 비용 API | Enterprise만 | 7개 조직을 연결 조직으로 묶는 통합 관리도 Enterprise 기능 |

**OTel로 얻는 지표** (모두 `user.email` 라벨): `claude_code.session.count`, `claude_code.cost.usage`(USD, `model`·`query_source`), `claude_code.token.usage`(input/output/cacheRead/cacheCreation × model), `claude_code.lines_of_code.count`(added/removed), `claude_code.code_edit_tool.decision`(accept/reject × tool × language), `claude_code.active_time.total`; 이벤트 `api_request`(요청별 cost_usd·tokens·duration), `tool_result`, `tool_decision`, `user_prompt`(내용은 기본 `<REDACTED>`). 커밋/PR은 tool_result·이벤트에서 파생.

**관리형 설정 예시**(조직 7개에 동일 적용, `organization.id`로 구분):
```json
{ "env": {
  "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
  "OTEL_METRICS_EXPORTER": "otlp", "OTEL_LOGS_EXPORTER": "otlp",
  "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
  "OTEL_EXPORTER_OTLP_ENDPOINT": "https://<수집기>/v1",
  "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <토큰>",
  "OTEL_METRICS_INCLUDE_SESSION_ID": "false" } }
```
수집기 후보: ① Grafana Cloud 무료 티어(OTLP 수신·대시보드 내장, 가장 빠름) ② self-host otel-collector → Supabase/ClickHouse ③ 앱 내 OTLP/HTTP 수신 라우트 → Supabase(앱 대시보드에 통합, 구현 비용 최대).

**권장 조합**: Claude Code = OTel(자동·실시간) + 채팅/Cowork = 멤버 활동 CSV 월 1회(조직당 1파일, 7개) + 시트 티어 = 관리자 멤버 CSV(변동 시). 장기 = Enterprise 전환 검토.

## 2. 확정 아키텍처 (2026-08-26 결정: A2 — 앱 내 통합)

두 축을 모두 만든다. **우선순위 1 = Claude Code(OTel 실시간)**, **우선순위 2(필수) = 채팅·Cowork(멤버 활동 CSV)**.

```
[각 직원 PC/IDE/웹 Claude Code] --OTLP http/json (관리형 설정으로 일괄 켬)--> POST /api/otel/v1/{metrics,logs}
      Bearer CLAUDE_OTEL_INGEST_TOKEN                                  │ parse(lib/claude-usage/otlp.ts)
                                                                        ▼ rpc claude_code_ingest (delta 합산)
                                                   Supabase: claude_orgs / claude_code_daily / claude_code_daily_model
                                                             claude_code_requests(api_request 이벤트) / claude_ingest_log
[소유자가 월 1회 내려받은 members-analytics-*.csv ×7] --업로드--> POST /api/admin/claude-usage/imports
                                                                        ▼ parse(lib/claude-usage/members-csv.ts)
                                                   Supabase: claude_csv_imports / claude_member_activity
[관리자] GET /admin/claude-usage  ── 탭: Claude Code(실시간) · 채팅/Cowork(CSV) · 조직/설정(관리형 설정 JSON·수집 상태)
```

### 2.1 OTel 수집
- 관리형 설정(`Admin Settings > Claude Code > Managed settings`, Owner)에 `env` 블록 배포. 프로토콜 `http/json`, temporality 기본 **delta** → 서버는 단순 합산. 엔드포인트 `https://inje-playground.vercel.app/api/otel` (exporter가 `/v1/metrics`, `/v1/logs`를 붙임).
- 사용자는 첫 실행 시 `OTEL_EXPORTER_OTLP_ENDPOINT` 승인 대화상자를 1회 본다(거부 시 Claude Code 종료). 설정 반영: 다음 실행 또는 1시간 폴링.
- 메트릭 → 일 단위(KST) 사용자별 합산: sessions, prompts(user_prompt 이벤트 수), cost_usd, 토큰 4종, loc_added/removed, edits_accepted/rejected, commits, pull_requests, active_user/cli_seconds. 모델별 비용·토큰은 별도 테이블.
- 이벤트 `claude_code.api_request`는 요청 단위 원본 보관(모델·비용·토큰·지연·query_source) — 드릴다운용. 프롬프트 본문은 기본 REDACTED이며 저장하지 않는다.
- 인증: `Authorization: Bearer <CLAUDE_OTEL_INGEST_TOKEN>` 상수시간 비교. 실패 401. 페이로드 파싱 실패 400. DB 쓰기는 service role(`SUPABASE_SERVICE_ROLE_KEY`).
- 사용자 식별: 데이터포인트 속성 `user.email` → 리소스 속성 → 없으면 `uuid:<account_uuid>`. 조직: `organization.id`(없으면 `unknown`). 미등록 조직 ID는 `claude_orgs`에 자동 추가(이름 = ID 앞 8자, 관리자가 수정).

### 2.1.1 대상 조직 (2026-08-26 확인, 모두 Team 플랜)
Innogrid-ax(조직 ID `4ad6b3e9-552f-4b67-bb96-25b51d1852f4`, 97석) · Innogrid_AIMS클라우드 · Innogrid_AIPaaS · Innogrid_AI반도체Cloud · Innogrid_S1 · Innogrid_S2 · Innogrid_자율행동체. 나머지 6개의 조직 ID는 OTel `organization.id` 또는 CSV 파일명에서 자동 등록되며, 관리자 화면 조직·설정 탭에서 이름을 지정한다.

### 2.2.1 CSV 수집 자동화 범위 (2026-08-26 결정)
- 사용자가 트리거하는 **반자동**: Chrome 확장(claude-in-chrome)으로 7개 조직을 순회하며 CSV 내보내기 → 스크립트로 업로드하는 스킬 `/claude-usage-csv`. 주기는 사용자 선택(매일 가능 — 각 파일은 30일 롤링 스냅샷이므로 날짜별 시리즈가 쌓임).
- 무인 자동(서버 크론이 claude.ai 내부 API 호출)은 비공식·약관 리스크로 **하지 않음**. 공식 무인 경로는 Enterprise Analytics API.
- 이를 위해 업로드 API는 관리자 세션 외에 수집 토큰(Bearer `CLAUDE_OTEL_INGEST_TOKEN`) 인증도 허용한다(스크립트용).

### 2.2 CSV 수집
- 파일: 분석 > 개요 > 멤버 "모두 보기" > CSV 내보내기 → `members-analytics-{orgId}-{from}-to-{to}.csv` (BOM, 19칼럼: Name, Email, Role, Seat Tier, Last Active, Days Active, Chats, Messages, Projects Created, Projects Used, Pull Requests, Code sessions, File Edits, Cowork Sessions, Cowork Messages, Artifacts Created, Claude Code Artifacts, Cowork Artifacts, Estimated Spend (USD)). 조직 전체 멤버 포함(시트 티어 포함) → 관리자 멤버 CSV 불필요.
- 업로드: 여러 파일 동시, 파일명에서 org/기간 자동 인식(실패 시 폼 입력). 같은 (org, from, to) 재업로드 = 교체. 헤더 이름 기반 매핑, 알 수 없는 칼럼 무시, 필수 칼럼(Email, Seat Tier, Chats, Code sessions, Cowork Sessions) 누락 시 거부.
- 노는 시트 = Seat Tier가 Premium/Standard인데 Chats+Code sessions+Cowork Sessions = 0.

### 2.3 대시보드 `/admin/claude-usage` (admin 전용)
- **Claude Code 탭**: 기간(7/30/90일·이번 달·지난 달)·조직 필터, KPI(비용·활성 사용자·세션·수락 라인·수락률·커밋/PR), 일별 비용 막대, **사용자 표**(이메일·이름(CSV 조인)·조직·비용·세션·토큰·LoC·수락률·커밋·PR·활성시간, 정렬·검색·CSV 저장), 모델별 비용.
- **채팅·Cowork 탭**: 업로드 영역, 업로드 이력, 멤버 활동 표(조직·기간 선택, 노는 시트 강조, 정렬·검색).
- **조직·설정 탭**: 조직 이름/시트 수 편집, 관리형 설정 JSON(엔드포인트 자동 채움) 복사, 수집 상태(최근 수신 시각·24h 건수·오류).

### 2.4 보안·운영
- 모든 신규 테이블 RLS: SELECT는 `user_profiles.role='admin'`만, 쓰기는 service role만(정책 없음).
- 환경변수: `SUPABASE_SERVICE_ROLE_KEY`(Vercel·.env.local, 신규), `CLAUDE_OTEL_INGEST_TOKEN`(신규).
- 롤아웃: Innogrid-ax 1개 조직에 먼저 적용 → 수집 상태 확인 → 나머지 6개 조직 동일 JSON 적용.

## 3. Phase 2 후보 (선택)
- Enterprise 전환 시 Analytics API 커넥터(cron)로 CSV 업로드 대체. 테이블은 소스 불문으로 설계.
- Grafana/OTel Collector 병렬 수신이 필요하면 관리형 설정의 엔드포인트를 collector로 바꾸고 collector가 앱으로 fan-out.

## 4. 결정 기록
- 2026-08-26 사용자 결정: A(OTel 중심) + CSV(채팅·Cowork) 필수. 수집기는 앱 내 Supabase 통합(A2).
