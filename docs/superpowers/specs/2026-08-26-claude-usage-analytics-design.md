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

## 2. Phase 1 — CSV 수집 + 통합 대시보드 (inje-playground 앱 내)

### 운영 흐름
1. 매월(권장: 전월 마감 직후) 7개 조직 각각에서 Analytics > spend report **CSV 다운로드** — 조직당 1분, 월 10분 내외.
2. 앱 `/admin/claude-usage/import`에서 파일 여러 개를 한 번에 업로드(조직·대상 월 지정, 파일명으로 추정해 프리필).
3. 대시보드 `/admin/claude-usage`에서 조직 통합 조회.

### DB (Supabase, admin 전용 RLS)
```sql
create table claude_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,          -- 조직 표시명 (7개)
  seats_standard int default 0,       -- 수동 관리(시트 수는 CSV에 없음)
  seats_premium int default 0,
  sort_order int default 0
);

create table claude_usage_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references claude_orgs(id),
  period_start date not null,         -- 대상 월 1일
  period_end date not null,
  filename text,
  uploaded_by uuid,
  row_count int,
  created_at timestamptz default now(),
  unique (org_id, period_start)       -- 같은 조직+월 재업로드 → 기존 레코드 교체
);

create table claude_usage_records (
  id bigint generated always as identity primary key,
  import_id uuid not null references claude_usage_imports(id) on delete cascade,
  org_id uuid not null references claude_orgs(id),
  period_start date not null,
  user_email text not null,           -- 소문자 정규화
  account_uuid text,
  product text not null,              -- chat / claude_code / cowork ...
  model text,
  request_count bigint default 0,
  prompt_tokens bigint default 0,
  completion_tokens bigint default 0,
  net_spend_cents numeric default 0,
  gross_spend_cents numeric default 0
);
create index on claude_usage_records (period_start, user_email);
create index on claude_usage_records (org_id, period_start);
```
- 멱등성: 업로드는 `(org, month)` 단위 교체(delete cascade → insert). 부분 업서트 추정보다 단순·안전.
- 개인 식별: `user_email` 기준. 같은 사람이 여러 조직에 시트를 가진 경우 이메일로 자동 합산. 실명 표시는 `user_profiles`(앱 로그인 명단)와 이메일 조인 + 수동 별칭 테이블(선택, Phase 1.5).

### 대시보드 `/admin/claude-usage`
- **요약 카드**: 기간 총 spend(net/gross), 활성 사용자 수 / 등록 시트 수(조직별 seats 합), 1인당 평균 spend, 전월 대비 증감.
- **사용자 테이블**(핵심 화면): 이메일(실명)·조직·제품별 spend·요청수·토큰·주력 모델, 정렬/검색/CSV 재수출. 조직 여러 곳에 걸친 사용자는 배지로 표기.
- **차트**: 월별 추이(조직 스택 막대), 모델 믹스(도넛), 상위 10 사용자(가로 막대), 제품 비중(chat vs Claude Code).
- **시트 관리 뷰**: spend 0(=CSV 미등장) 시트 추정 — `claude_orgs.seats_*` 수동 입력과 활성 사용자 수의 차이로 "노는 시트"를 조직별 표시. (정확한 시트 배정자 명단은 Team 플랜 API로 못 가져오므로, 필요하면 조직 멤버 이메일을 수동 등록하는 `claude_seats` 테이블을 Phase 1.5에 추가.)
- 필터: 기간(월 범위), 조직(멀티), 제품, 검색.
- 접근: `role=admin` 전용(기존 admin 패턴 그대로).

### CSV 파서 주의점
- 헤더 명칭·칼럼 순서는 Anthropic이 예고 없이 바꿀 수 있으므로 **헤더 이름 기반 매핑 + 알 수 없는 칼럼 무시 + 필수 칼럼 누락 시 업로드 거부**(어떤 칼럼이 없는지 명시).
- 금액 단위(달러/센트)·토큰 칼럼명은 첫 실물 CSV로 확정한다. **구현 첫 단계 = 실제 CSV 1개 확보 후 파서 스펙 고정.**

## 3. Phase 2 — 자동화 옵션 (선택)

| 옵션 | 내용 | 효과 | 비용/조건 |
|---|---|---|---|
| **A. Enterprise 전환** | 7개 Team 조직을 Enterprise 1개(연결 조직)로 통합 → Primary Owner가 Analytics API 키 발급 → 앱이 cron으로 `/v1/organizations/analytics/` pull → 같은 테이블 적재(CSV 업로드 대체) | 사용자별 **일간** chat+Claude Code+Cowork 활동·비용 자동 수집, 조직 통합 관리 | Enterprise 계약(영업 접촉)·가격. 데이터는 2026-01-01 이후분 제공 |
| **B. OpenTelemetry** | 전 직원 Claude Code에 managed settings로 OTel 내보내기 설정 → 수집기(예: self-host collector 또는 Grafana Cloud) | Claude Code **실시간** 토큰·비용·세션·도구 지표 | 클라이언트 배포 필요, Claude Code 외 사용(chat)은 안 잡힘 |

Phase 1 테이블 설계는 A의 API 적재와 호환되도록 `import` 단위를 소스 불문(`csv`/`api`)으로 잡는다.

## 4. 결정 필요 사항
1. 7개 조직이 전부 claude.ai Team 플랜이 맞는지(Claude Console/API 병용 조직이 있으면 그쪽은 ③ API로 자동화 가능).
2. Phase 1(CSV 업로드) 방식으로 시작해도 되는지 — 시작 전 **실물 spend report CSV 1개** 필요.
3. Enterprise 전환 검토 의향(장기 자동화의 정석 경로).
