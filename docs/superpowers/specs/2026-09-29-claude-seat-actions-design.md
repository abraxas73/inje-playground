# Claude 시트 할당·해제 — 설계

> 2026-09-29. 채팅·Cowork 멤버 활동 표(`/admin/claude-chat`)에서 관리자가 노는 시트를 **해제**하고 미할당 멤버에게 시트를 **할당**한다. 서버는 claude.ai에 로그인돼 있지 않으므로 화면은 요청을 기록하고, 관리자 Mac에서 도는 실행기가 소유자 세션으로 claude.ai에 반영한다. 모든 요청·실행 결과는 삭제하지 않고 남겨 사람별 이력이 된다. 기반: `docs/claude-usage.md`(멤버·초대 수집), `.claude/skills/claude-usage-csv/SKILL.md`(claude.ai 내부 API 확인 기록).

## 1. 목적과 성공 기준

- **대상**: 관리자(Claude 조직 소유자). 노는 시트(활성 + 30일 사용 0)를 보고 그 자리에서 회수하거나, 미할당 멤버에게 시트를 준다.
- **성공 기준**: 버튼을 누르면 1분 안에 claude.ai 멤버 화면의 티어가 바뀌고, 화면 표가 새 티어를 보이며, 누가 언제 누구의 시트를 어떻게 바꿨는지 이력에서 사람별로 볼 수 있다.
- **확정된 값**: 실행기 폴링 15초, 화면 상태 재조회 5초(최대 2분), 실행기 하트비트 부재 60초 넘으면 "실행기 꺼짐" 표시, 티어 표기 Standard·Premium·Unassigned(claude.ai 원문 `team_standard`·`team_tier_1`·`unassigned`).
- **공식 API 없음**(2026-09-29 확인): Claude 도움말은 시트 변경을 조직 설정 화면 조작으로만 안내한다. 이 설계는 소유자 브라우저 세션이 쓰는 claude.ai 내부 API를 그대로 쓴다.

## 2. 범위

포함:
1. 액션 `unassign`(시트 → Unassigned, 멤버는 조직에 남음)·`assign`(Unassigned → Standard | Premium).
2. 요청·실행 이력 테이블과 감사 로그, 사람별 이력 조회.
3. 관리자 Mac 실행기(launchd 상시)와 1회 로그인 스크립트.
4. 멤버 표의 행 액션·상태 배지·실행기 상태·이력 화면.

제외(후속 후보): 대량 선택 일괄 처리, 자동 회수 규칙(예: 30일 미사용 자동 해제), 초대 취소·멤버 삭제, 구매 좌석 수 변경(claude.ai 결제 설정에서만 가능 — 대화상자에 안내), 개인 화면(`/usage/chat`) 노출.

## 3. 현재 상태

- 멤버 표는 CSV 업로드(`claude_member_activity`, `seat_tier` 포함)와 사내 조직도를 조인해 보여준다(`GET /api/admin/claude-usage/members`). 멤버·초대 스냅샷 `claude_org_members`(org_id·email PK, seat_tier, status active|pending)는 매일 09:05 `/claude-usage-csv`가 조직 단위로 교체한다.
- 노는 시트 판정 `isIdleSeat`(`lib/claude-usage/aggregate.ts`): 시트가 있고(`hasSeat`) 채팅·코드·Cowork 세션 합이 0.
- claude.ai 내부 API(스킬 노트 7·8·37회차 확인): `GET /api/organizations/<orgId>/members?limit=500` → `[{account:{uuid,email_address,full_name}, role, seat_tier}]`; `PUT /api/organizations/<orgId>/members/<account_uuid>` body `{"seat_tier":"team_tier_1"|"team_standard"|"unassigned"}`(빈 body는 400 — 존재 확인, 실행한 적 없음). 소유자 세션 쿠키가 있는 claude.ai 페이지 안에서 `fetch(credentials:'include')`로 호출된다. 도움말 기준 미할당 멤버는 좌석 한도에 들어가지 않는다.
- 로컬 자동화 선례: `nlm-service/scripts/nlm-login.sh`(Playwright persistent 프로필에 사용자가 직접 로그인), launchd 작업 3개(`claude-jobs status`, 런북 `docs/launchd-jobs.md`), 수집 토큰 `CLAUDE_OTEL_INGEST_TOKEN`(`frontend/.env.local`, 서버와 같은 값). `frontend`에 `playwright-core` 1.61.1 설치돼 있다(E2E). Node 26.

## 4. 데이터

### 4.1 `claude_seat_actions` — 요청과 실행 이력(삭제하지 않음)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| org_id | text not null → claude_orgs(id) | |
| email | text not null | 소문자 |
| action | text not null check in ('unassign','assign') | |
| target_tier | text check in ('Standard','Premium') | assign만, unassign은 null |
| status | text not null check in ('requested','running','done','failed','cancelled') default 'requested' | |
| requested_by | uuid not null | auth.users id |
| requested_by_email | text not null | 이력 표시용(사용자 삭제 뒤에도 남김) |
| requested_at | timestamptz not null default now() | |
| started_at | timestamptz | running 진입 |
| finished_at | timestamptz | done·failed·cancelled |
| before_tier | text | 실행 직전 claude.ai 티어(정규화 표기) |
| after_tier | text | 실행 뒤 다시 읽은 티어 |
| error | text | failed 사유(500자) |
| executor | text | 실행기 식별(호스트명) |

인덱스: (email, requested_at desc), (status) where status in ('requested','running'). 부분 유니크 인덱스 `(org_id, email) where status in ('requested','running')` — 같은 사람에게 대기·실행 중 요청은 하나만. RLS: 읽기 admin만(다른 claude_* 테이블과 같은 정책), 쓰기는 service_role.

상태 전이: `requested → running → done | failed`, `requested → cancelled`(관리자 취소). 다른 전이는 서버가 409로 거부.

### 4.2 `claude_seat_executor` — 실행기 하트비트(행 1개)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | text PK, 항상 'default' | |
| last_seen_at | timestamptz not null | 폴링마다 갱신 |
| logged_in | boolean not null | claude.ai 세션 유효 여부 |
| note | text | "로그인 필요", 마지막 오류 등 |
| host | text | 호스트명 |
| version | text | 스크립트 버전 문자열 |

### 4.3 기존 테이블 반영

- `done` 시 서버가 `claude_org_members`(org_id·email)의 `seat_tier`를 `after_tier`로 갱신한다(행이 없으면 건너뜀). 다음 09:05 스냅샷 교체 때 claude.ai 원본으로 덮이므로 정합성은 유지된다.
- `GET /api/admin/claude-usage/members`는 각 행의 `seat_tier`를 `claude_org_members`에 같은 org_id·email 행이 있으면 그 값으로 **덮어쓴다**(CSV는 최대 하루 낡음). 응답에 행별 `seat_action`(진행 중·최근 요청 요약: id·action·status·target_tier·requested_at·error)을 붙인다 — 최근 24시간 안의 마지막 요청 1건.
- 감사 로그(`logAudit`, category `usage`): "시트 해제 요청"·"시트 할당 요청"·"시트 작업 취소"(관리자 세션, detail: org_id·email·action·target_tier·action_id), "시트 해제 완료"·"시트 할당 완료"·"시트 작업 실패"(실행기 PATCH 때 서버가 요청자 명의(user_id·user_email = requested_by)로 기록, detail에 before/after/error). 비밀 값 없음.

## 5. API — `/api/admin/claude-usage/seat-actions`

관리자 세션(`requireAdmin`)과 수집 토큰(`verifyIngestToken`, Bearer `CLAUDE_OTEL_INGEST_TOKEN`) 두 가지 인증. 아래 표의 "누가"가 허용 주체다.

| 메서드 | 누가 | 요청 | 응답·규칙 |
|---|---|---|---|
| GET `?email=&org=&status=&limit=` | 관리자 | 필터 선택 | `{ rows: SeatAction[], executor: Executor \| null }`. requested_at 내림차순, limit 기본 200 최대 1000. email은 소문자 정확 일치 |
| POST | 관리자 | `{ org_id, email, action, target_tier? }` | 검증: org_id가 `claude_orgs`에 있음, email이 `claude_org_members`에 status active로 있음(없으면 404 "활성 멤버가 아닙니다"), unassign은 현재 `hasSeat`이어야(400), assign은 현재 미할당이고 target_tier ∈ Standard·Premium(400), 대기·실행 중 요청 있으면 409. 성공 201 `{ row }` + 감사 로그 |
| DELETE `?id=` | 관리자 | | status가 requested일 때만 cancelled(아니면 409). `{ row }` + 감사 로그 |
| GET `?claim=1` | 실행기 | | 가장 오래된 requested 1건을 running으로 바꿔 돌려준다(`update … where id = (select … order by requested_at limit 1 for update skip locked) returning *` RPC `claude_seat_action_claim`). 없으면 `{ row: null }` |
| PATCH | 실행기 | `{ id, status: 'done'\|'failed', before_tier?, after_tier?, error?, executor }` | running인 행만(아니면 409). done이면 4.3 반영 + 감사 "완료", failed면 감사 "실패". `{ row }` |
| PUT `/heartbeat` | 실행기 | `{ logged_in, note?, host, version }` | `claude_seat_executor` upsert. `{ ok: true }` |

`SeatAction`·`Executor` 타입은 `frontend/src/types/claude-seat.ts`에 둔다. 실행기 라우트는 `Cache-Control: no-store`.

## 6. 실행기(관리자 Mac)

### 6.1 로그인(1회) — `frontend/scripts/claude-seat-login.sh`
`nlm-login.sh`와 같은 방식. `node frontend/scripts/claude-seat-executor.mjs --login`으로 headed Chromium을 전용 프로필 `~/.claude-seat/profile`에 띄우고 `https://claude.ai/login`을 연다. **로그인·Cloudflare 확인은 사용자가 직접** 한다(자동 통과 금지). 사용자가 창을 닫으면 종료. 프로필 폴더 권한 700.

### 6.2 상시 실행 — `frontend/scripts/claude-seat-executor.mjs`
- `playwright-core`의 `chromium.launchPersistentContext(~/.claude-seat/profile, { headless: true, args: ['--disable-blink-features=AutomationControlled'] })`. 실행 파일은 로컬 Chrome(`channel: 'chrome'`)을 우선 쓰고 없으면 Playwright Chromium.
- 루프(15초): ① `PUT /heartbeat` ② `GET ?claim=1` → 행이 없으면 대기 ③ 행이 있으면 처리 후 `PATCH`. 한 번에 1건, 순차.
- 처리: claude.ai 탭에서 `fetch('/api/organizations/<org_id>/members?limit=500')` → `account.email_address`(소문자)로 대상 찾기(없으면 failed "조직에서 멤버를 찾지 못했습니다") → `before_tier` = 정규화한 현재 티어 → `PUT /api/organizations/<org_id>/members/<uuid>` body `{ seat_tier }`(unassign→`unassigned`, Standard→`team_standard`, Premium→`team_tier_1`) → 2xx가 아니면 failed "claude.ai <status>: <본문 앞 200자>" → 다시 members를 읽어 `after_tier` 확인, 목표와 다르면 failed "적용 후 티어가 <after>입니다" → done.
- 로그인 판정: 탭에서 `fetch('/api/organizations')`가 200이 아니거나 로그인 페이지로 리다이렉트되면 `logged_in=false`, note "로그인 필요 — claude-seat-login.sh 실행"; 요청은 claim하지 않는다(requested 유지). 로그인되면 자동 복귀.
- 정규화·매핑은 순수 함수(`normalizeTier`, `toApiTier`, `findMember`)로 `frontend/src/lib/claude-usage/seat-tier.ts`에 두고 실행기와 서버가 같이 쓴다(vitest 대상). 실행기는 `.mjs`라 TS를 직접 못 읽으므로 같은 규칙을 `frontend/scripts/lib/seat-tier.mjs`에 복제하지 않고, `tsx`도 추가하지 않는다 — 대신 실행기 파일이 매핑 표 하나를 **문자열 상수**로 갖고, 테스트가 두 파일의 표가 같은지 비교한다(`seat-tier.test.ts`가 `.mjs`를 정규식으로 읽어 대조).
- 로그 `~/Library/Logs/claude-seat-executor.log`(한 줄 JSON: 시각·action id·결과), 토큰·쿠키는 남기지 않는다.
- launchd `com.innogrid.claude-seat-executor`: `~/.claude/hooks/claude-seat-executor.sh`가 `exec node …/claude-seat-executor.mjs`, `KeepAlive true`, `RunAtLoad true`, `ThrottleInterval 30`. `claude-jobs`의 로그·설명 표에 등록. 런북 `docs/launchd-jobs.md` 작업 목록·`docs/claude-usage.md` 새 절 "9. 시트 할당·해제".
- 환경: `CLAUDE_OTEL_INGEST_TOKEN`(`frontend/.env.local` → 없으면 `~/.config/inje-playground/work-metrics.env`), `APP_URL` 기본 `https://inje-playground.vercel.app`, `SEAT_PROFILE_DIR` 기본 `~/.claude-seat/profile`.

## 7. 화면 — `MembersCsvTab`(관리자만 렌더되는 탭)

- **행 액션 열**(맨 오른쪽): 시트 있음 → "해제" 버튼, 미할당 → "할당" 드롭다운(Standard·Premium). 대기·실행 중 요청이 있으면 버튼 대신 배지 `대기`·`적용 중…`(+ 대기일 때 "취소"), 최근 24시간 결과가 있으면 `완료 → Premium`·`실패`(title에 사유) 배지 뒤에 버튼을 다시 보인다.
- **확인 대화상자**(`AlertDialog`): 조직명·이메일·이름, "현재 Standard → Unassigned"처럼 전후 티어, 안내 문구 "회수한 시트는 다른 멤버에게 줄 수 있습니다. 구매 좌석 수는 바뀌지 않으며 claude.ai 결제 설정에서 줄여야 합니다."(할당 때는 "빈 좌석이 없으면 실패합니다"). 확인 → POST → 실패 시 오류 문구를 대화상자에 표시.
- **상태 재조회**: 요청·취소 뒤 5초 간격으로 `members`를 다시 불러 배지를 갱신, 모든 요청이 끝나거나 2분이 지나면 멈춘다.
- **실행기 칩**(수집 시각 줄 옆): `실행기 정상 · 방금`/`N분 전`, 60초 넘게 하트비트가 없으면 주황 "실행기 꺼짐 — 요청은 켜지면 처리됩니다", `logged_in=false`면 붉은 "claude.ai 로그인 필요". title에 host·note.
- **이력**: 상단 "시트 작업 이력" 버튼 → `Sheet`에 표(시각·조직·이메일·이름·액션·전후 티어·요청자·상태·사유), 이메일 검색 입력. 행의 사용자 셀에 작은 "이력" 링크 → 같은 Sheet를 그 이메일로 연다. 데이터는 `GET seat-actions?email=&limit=`.
- 개인 화면 `/usage/chat`은 이 컴포넌트를 쓰지 않으므로 변경 없음.

## 8. 오류·안전

- 서버 검증(5절)이 잘못된 요청을 막고, 실행 실패는 사유와 함께 `failed`로 남아 재요청할 수 있다. 실행기 오류(브라우저 크래시)는 launchd가 재시작하고, `running`으로 남은 행은 실행기가 시작할 때 10분 넘은 것을 `failed "실행기 재시작"`으로 정리한다.
- 서버에 claude.ai 자격 증명을 두지 않는다. 프로필 폴더는 관리자 Mac에만 있다.
- 실행기가 다른 사람의 시트를 바꾸는 유일한 경로는 `requested` 행이며, 그 행은 관리자 세션으로만 만들어진다. 수집 토큰으로는 요청을 만들 수 없다.
- 실행 결과와 요청은 모두 감사 로그와 `claude_seat_actions`에 남는다.

## 9. 테스트

- vitest: 요청 검증(활성 멤버·중복·티어 규칙), 상태 전이(허용/409), 티어 정규화·API 매핑·멤버 찾기(순수 함수), `.mjs`와 TS의 매핑 표 일치, members 응답의 `seat_tier` 덮어쓰기·`seat_action` 첨부, 실행기 상태 칩 문구(하트비트 부재·로그인 필요).
- 실제 반영: 사용자가 지정한 멤버 1명으로 해제 → 화면·claude.ai 확인 → 다시 할당 → 이력 2건 확인.

## 10. 단계

1. SQL(4.1·4.2·claim RPC) 적용 → 타입·검증·API → members 덮어쓰기 → 배포.
2. 실행기·로그인 스크립트·launchd·claude-jobs·런북 → 이 Mac에서 로그인·기동.
3. 화면(행 액션·대화상자·칩·이력) → 배포 → 사용자 지정 1명으로 실제 확인.
