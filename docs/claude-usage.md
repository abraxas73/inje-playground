# Claude 사용량 대시보드 운영 런북

설계: `docs/superpowers/specs/2026-08-26-claude-usage-analytics-design.md` · 화면: `/admin/claude-usage`

## 1. 최초 설정
1. Supabase SQL Editor에서 `docs/sql/2026-08-26-claude-usage.sql` 실행.
2. 환경변수(Vercel Production + `frontend/.env.local`):
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase > Project Settings > API > service_role (서버 전용, 절대 클라이언트 노출 금지)
   - `CLAUDE_OTEL_INGEST_TOKEN` — 임의의 32바이트 이상 랜덤 문자열(`openssl rand -hex 32`)
3. 배포 후 `/admin/claude-usage` > 조직·설정 탭에서 "수집 상태"가 토큰/서비스키 구성됨으로 표시되는지 확인.

## 2. Claude Code 수집 켜기 (조직별 1회)
1. `/admin/claude-usage` → 조직·설정 탭 → "관리형 설정" JSON 복사 → `<CLAUDE_OTEL_INGEST_TOKEN>`을 실제 토큰으로 교체.
2. claude.ai(해당 조직 Owner로 로그인) → 관리자 설정 → Claude Code → 관리형 설정 → 관리 → JSON 붙여넣기 → 저장.
   - 기존 관리형 설정이 있으면 `env` 블록만 병합한다(다른 키 유지).
3. 구성원 안내문(Teams/Dooray 공지): "다음 Claude Code 실행 시 '조직 관리형 설정 승인' 창이 뜹니다. `OTEL_EXPORTER_OTLP_ENDPOINT = https://inje-playground.vercel.app/api/otel` 항목을 확인하고 승인해 주세요. 사용 통계(토큰·비용·세션)만 수집하며 프롬프트/코드 내용은 전송되지 않습니다."
4. 검증: 본인 Claude Code를 재시작해 승인 → 1~2분 후 조직·설정 탭 "24시간 수신"이 1 이상, Claude Code 탭에 본인 이메일 행 등장. 안 되면 §4.
5. 나머지 조직 6개에 같은 JSON 적용(조직 ID는 `organization.id`로 자동 구분·자동 등록되므로 조직·설정 탭에서 이름만 지정).

## 3. 월간 CSV 절차 (매월 1일, 조직당 1분)
1. claude.ai에서 조직 전환 → 분석 → 개요 → 멤버 **모두 보기** → 기간 **30일** → **CSV 내보내기**(`members-analytics-<조직ID>-<시작>-to-<끝>.csv`).
2. 7개 파일을 `/admin/claude-usage` → 채팅·Cowork 탭 → "파일 선택"으로 한 번에 업로드. 결과 줄이 전부 ✓인지 확인.
3. "노는 시트만" 버튼으로 Premium 시트인데 활동 0인 사용자를 확인 → 시트 회수 검토.
- 기간 60/90일 CSV도 업로드 가능(다른 기간 키로 별도 저장). 같은 조직·기간 재업로드는 교체.

## 4. 장애 대응
| 증상 | 확인 | 조치 |
|---|---|---|
| 수집 상태 "24시간 수신 0" | Vercel 로그에서 `/api/otel/v1/metrics` 401 → 토큰 불일치 | 관리형 설정 헤더 토큰과 `CLAUDE_OTEL_INGEST_TOKEN` 일치 확인(양쪽 공백 주의) |
| 415 응답 | 프로토콜이 protobuf | 관리형 설정 `OTEL_EXPORTER_OTLP_PROTOCOL` = `http/json` |
| 500 `store failed` | 조직·설정 탭 "마지막 오류" | `claude_code_ingest` 함수 존재·`SUPABASE_SERVICE_ROLE_KEY` 확인. RPC 오류 `cannot affect row a second time`면 파서 사전집계 버그 → 이슈 |
| 사용자 승인 창에서 거부 | Claude Code 종료됨 | 재실행 후 승인. 승인은 조직당 1회 기록됨 |
| 특정 사용자 데이터 없음 | Bedrock/Vertex/`ANTHROPIC_BASE_URL` 사용자는 관리형 설정을 받지 않음 | 해당 사용자는 OTel 대상 아님(문서상 제약) |
| CSV 업로드 "필수 칼럼 누락" | Anthropic이 헤더를 바꿈 | `frontend/src/lib/claude-usage/members-csv.ts`의 `MEMBERS_CSV_COLUMNS`에 새 헤더 추가 |
- 데이터 보존: `claude_code_requests`는 요청 단위라 커짐 → 필요 시 `delete from claude_code_requests where ts < now() - interval '180 days'`.
