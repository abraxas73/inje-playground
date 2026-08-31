# Claude 사용량 대시보드 운영 런북

> 구조·데이터 흐름·보안 모델 설명은 [아키텍처 문서 `docs/claude-usage-architecture.md`](./claude-usage-architecture.md). 이 문서는 운영 절차와 장애 대응만 다룬다.

설계: `docs/superpowers/specs/2026-08-26-claude-usage-analytics-design.md` · 화면: `/admin/claude-usage`

## 1. 최초 설정
1. Supabase SQL Editor에서 `docs/sql/2026-08-26-claude-usage.sql` 실행.
2. 환경변수(Vercel Production + `frontend/.env.local`):
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase > Project Settings > API > service_role (서버 전용, 절대 클라이언트 노출 금지)
   - `CLAUDE_OTEL_INGEST_TOKEN` — 임의의 32바이트 이상 랜덤 문자열(`openssl rand -hex 32`)
3. 배포 후 `/admin/claude-usage` > 조직·설정 탭에서 "수집 상태"가 토큰/서비스키 구성됨으로 표시되는지 확인.

## 1.1 멤버·초대 상태 테이블 (1회)
- Supabase SQL Editor에서 `docs/sql/2026-08-31-claude-org-members.sql` 실행 → `claude_org_members`(조직×이메일, status active|pending). `/claude-usage-csv` 실행 시 관리자 설정 › 멤버 화면(활성·대기 중 탭)을 스크랩해 조직 단위로 교체 저장하고, 대시보드 **멤버 · 초대** 탭이 사내 조직도(이름·조직/팀)와 조인해 보여준다. "대기 중"(초대 미수락)은 "노는 시트"(활성+30일 사용 0)와 다른 축이다.

## 2. Claude Code 수집 켜기 (조직별 1회)
1. `/admin/claude-usage` → 조직·설정 탭 → "관리형 설정" JSON 복사 → `<CLAUDE_OTEL_INGEST_TOKEN>`을 실제 토큰으로 교체.
   - JSON에는 메트릭 5분(`OTEL_METRIC_EXPORT_INTERVAL=300000`)·로그 1분(`OTEL_LOGS_EXPORT_INTERVAL=60000`) 전송 간격이 포함돼 있다.
2. claude.ai(해당 조직 Owner로 로그인) → 관리자 설정 → Claude Code → 관리형 설정 → 관리 → JSON 붙여넣기 → 저장.
   - 기존 관리형 설정이 있으면 `env` 블록만 병합한다(다른 키 유지).
3. 구성원 안내문(Teams/Dooray 공지): "다음 Claude Code 실행 시 '조직 관리형 설정 승인' 창이 뜹니다. `OTEL_EXPORTER_OTLP_ENDPOINT = https://inje-playground.vercel.app/api/otel` 항목을 확인하고 승인해 주세요. 사용 통계(토큰·비용·세션)만 수집하며 프롬프트/코드 내용은 전송되지 않습니다."
4. 검증: 본인 Claude Code를 재시작해 승인 → **한 번 더 재시작**(승인한 세션 자체는 내보내지 않음) → 5분 후 조직·설정 탭 "24시간 수신"이 1 이상, Claude Code 탭에 본인 이메일 행 등장. 안 되면 §4.
5. 나머지 조직 6개에 같은 JSON 적용(조직 ID는 `organization.id`로 자동 구분·자동 등록되므로 조직·설정 탭에서 이름만 지정).

## 3. 월간 CSV 절차 (매월 1일, 조직당 1분)
가장 쉬운 방법: Claude Code에서 `/claude-usage-csv` 실행(Chrome 확장 연결 필요) → 7개 조직 CSV 내보내기 + 업로드가 자동 진행. 수동으로 받았다면 `./frontend/scripts/claude-usage-upload.sh 3`으로 최근 3일 파일을 일괄 업로드.
1. claude.ai에서 조직 전환 → 분석 → 개요 → 멤버 **모두 보기** → 기간 **30일** → **CSV 내보내기**(`members-analytics-<조직ID>-<시작>-to-<끝>.csv`).
2. 7개 파일을 `/admin/claude-usage` → 채팅·Cowork 탭 → "파일 선택"으로 한 번에 업로드. 결과 줄이 전부 ✓인지 확인.
3. "노는 시트만" 버튼으로 Premium 시트인데 활동 0인 사용자를 확인 → 시트 회수 검토.
- 기간 60/90일 CSV도 업로드 가능(다른 기간 키로 별도 저장). 같은 조직·기간 재업로드는 교체.
- **마지막 수집 시각**: 업로드마다 `claude_csv_imports.created_at`에 기록되며, 채팅·Cowork 탭 "업로드 이력" 상단("마지막 CSV 수집 … · N개 조직")과 조직·설정 탭 "수집 상태"(전체) 및 조직 표 "CSV 최신(수집 시각)"(조직별)에 표시된다. 표시는 조직별 최신 import 기준이라 재업로드로 중복 집계되지 않는다.

## 4. 장애 대응
| 증상 | 확인 | 조치 |
|---|---|---|
| 수집 상태 "24시간 수신 0" | Vercel 로그에서 `/api/otel/v1/metrics` 401 → 토큰 불일치 | 관리형 설정 헤더 토큰과 `CLAUDE_OTEL_INGEST_TOKEN` 일치 확인(양쪽 공백 주의) |
| 415 응답 | 프로토콜이 protobuf | 관리형 설정 `OTEL_EXPORTER_OTLP_PROTOCOL` = `http/json` |
| 500 `store failed` | 조직·설정 탭 "마지막 오류" | `claude_code_ingest` 함수 존재·`SUPABASE_SERVICE_ROLE_KEY` 확인. RPC 오류 `cannot affect row a second time`면 파서 사전집계 버그 → 이슈 |
| 사용자 승인 창에서 거부 | Claude Code 종료됨 | 재실행 후 승인. 승인은 조직당 1회 기록됨 |
| 특정 사용자 데이터 없음 | Bedrock/Vertex/`ANTHROPIC_BASE_URL` 사용자는 관리형 설정을 받지 않음 | 해당 사용자는 OTel 대상 아님(문서상 제약) |
| CSV 업로드 "필수 칼럼 누락" | Anthropic이 헤더를 바꿈 | `frontend/src/lib/claude-usage/members-csv.ts`의 `MEMBERS_CSV_COLUMNS`에 새 헤더 추가 |
| 503 `store failed` (Retry-After) | 일시적 DB 오류 — OTel 익스포터가 자동 재시도함 | 반복되면 조직·설정 탭 "마지막 오류" 확인, DB 상태 점검 |
| 승인 창을 통과한 세션인데 데이터가 안 옴 | 승인 직후 세션은 `OTEL_*` env가 아직 미적용(`CLAUDE_CODE_ENABLE_TELEMETRY`만 있음) | 정상 동작 — Claude Code를 한 번 더 재시작하면 그 세션부터 내보냄. 서버 관리형 설정 캐시 `~/.claude/remote-settings.json`, 승인 기록 `~/.claude/remote-settings-consent.json` |
| 사용자 `식별 불가 (API 키 인증)` / `API 키 사용자 id:…` / 조직 `조직 미확인` 행 | `claude_code_requests`에서 해당 행의 `query_source`가 `sdk`, `account_uuid`·`org_id` 없음 | Agent SDK 등이 claude.ai 로그인 대신 **API 키(Console) 인증**으로 실행된 것 — Team 시트 사용량이 아니라 Console 과금분이며 개인 귀속 불가. `user.id`가 있으면 `id:…`로 사용자별 구분만 된다. 필요하면 해당 머신의 관리형 설정 캐시(`~/.claude/remote-settings.json`)와 `ANTHROPIC_API_KEY` 사용 여부 확인 |
| 사용자 칸이 비어 있음 | CSV `Name`이 빈 문자열인 멤버(claude.ai 표시 이름 미설정) | 2026-08-27 수정(빈 이름은 null로 정규화 → 이메일 표시). 이름을 보고 싶으면 본인이 claude.ai 프로필에 표시 이름 설정 |
| metrics는 오는데 프롬프트 수·요청 표가 0 | `claude_ingest_log`에서 `signal='logs'` 행의 `bytes`>0인데 `rows=0` → 이벤트 이름 불일치 | 2026-08-27 수정(89ed70c: `event.name` 접두어 유무 모두 인식). 재발 시 Vercel 함수 로그의 `[claude-usage] logs: … 무시한 이벤트` 경고에서 실제 이벤트 이름 확인 후 `otlp.ts` `eventNames()` 조정 |
- 데이터 보존: `claude_code_requests`는 요청 단위라 커짐 → 필요 시 `delete from claude_code_requests where ts < now() - interval '180 days'`.
- 수신 로그 보존: `delete from claude_ingest_log where received_at < now() - interval '30 days'`(수신 건수가 많아 30일 권장).
- 진단 조회: `claude_ingest_log`·`claude_code_requests`·`claude_code_daily`는 관리자 RLS 읽기 정책이 있어 대시보드에 로그인한 관리자 세션 토큰으로 PostgREST를 직접 조회할 수 있다(service_role 키 불필요). Vercel의 `SUPABASE_SERVICE_ROLE_KEY`는 Sensitive로 저장돼 `vercel env pull`로 받아지지 않는다.
- 마이그레이션 2(중복 방지 인덱스): 아직 적용 전이면 Supabase SQL Editor에서 `docs/sql/2026-08-26-claude-usage-2.sql` 실행 — `api_request` 이벤트 재수신 시 중복 삽입을 막는 부분 유니크 인덱스(`claude_code_requests_request_id_uidx`). 인덱스가 존재해야 이후 `storeLogs`를 upsert로 전환할 수 있다.

### 스모크/테스트 데이터 정리
```sql
delete from claude_code_daily_model where org_id = 'test-org';
delete from claude_code_requests   where org_id = 'test-org';
delete from claude_code_daily      where org_id = 'test-org';
delete from claude_ingest_log      where 'test-org' = any(org_ids);
delete from claude_orgs            where id = 'test-org';
```

## 5. 테스트
- 단위: `cd frontend && npx vitest run` (parser·CSV·집계·인증·관리형 설정).
- E2E: `cd frontend && npx playwright test e2e/claude-usage.spec.ts` — OTLP 수신/관리자 API 게이트(401·415·400·200)는 세션 없이 실행된다. 관리자 화면 2개 테스트(3탭 렌더, 합성 CSV 업로드→표→삭제)는 `E2E_ADMIN_STORAGE_STATE`(Google 관리자 로그인 storageState JSON; `npx playwright codegen --save-storage=/tmp/admin-storage.json http://localhost:3003`)와 `SUPABASE_SERVICE_ROLE_KEY`(로컬 `.env.local`)가 있을 때만 실행되고 없으면 SKIP된다.
