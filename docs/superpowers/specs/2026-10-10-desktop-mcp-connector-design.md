# 데스크탑 앱을 아마란스 MCP 서버로 — claude.ai 조직 커넥터 설계

2026-10-10. 대상: `frontend/`(MCP 끝점·OAuth 동의 화면·중계) + `mobile/`(macOS·Windows 앱의 실행기·도구 57개) + Supabase(OAuth 2.1 서버·중계 테이블). 선행: `2026-10-04-amaranth-app-integration-design.md`(아마란스 호출 규칙), `2026-10-05-mobile-assistant-design.md`(이노봇 도구·확인 규칙).

## 1. 목적과 성공 기준

**목적**: 개인 PC의 Rust 바이너리 `~/bin/inno-creed`(아마란스 MCP 서버, stdio, 도구 57개)를 **데스크탑 앱(맥·윈도우)** 이 대체한다. 조직(Claude Team 플랜) Owner가 claude.ai **커넥터 → 사용자 지정**으로 한 번 등록하면, 구성원은 앱을 설치하고 로그인·아마란스 연결만 하면 claude.ai·Claude Desktop·Claude Code·Cowork 어디서나 같은 도구를 쓴다. 사용자별 MCP 설정 파일·바이너리 배포·크레덴셜 추출(Chrome 확장)이 사라진다.

**성공 기준**
1. Owner가 커넥터 URL `https://innocrew.innogrid.com/api/mcp`를 등록하면 구성원은 claude.ai에서 [연결] → 우리 로그인(Microsoft) → 동의 한 번으로 끝난다. Claude Code `claude mcp list`에도 "claude.ai …" 항목으로 자동 나타난다(지금 Atlassian·Google Drive 커넥터가 보이는 것과 같은 경로).
2. 도구 57개의 **이름·입력 스키마·응답 형식이 inno-creed 2.2.0과 같다** — 기존 프롬프트·스킬·`company-directory-sync.py`가 그대로 동작한다.
3. Windows에서도(inno-creed 빌드가 없는 환경) 같은 기능을 쓴다.
4. 아마란스 크레덴셜은 앱(기기) 밖으로 나가지 않는다. 서버는 도구 이름·소요 시간만 기록하고 인자·결과를 저장·로그하지 않는다(중계 행은 전달 즉시 삭제).

## 2. 범위와 결정

사용자 결정(2026-10-10):
- **도구 범위: inno-creed 57개 완전 대체**(앱이 이미 가진 24개 + 신규 22개 + 내장 데이터 5개 + 로컬 파일 3개 + 세션 3개).
- **쓰기 도구도 항상 노출**(inno-creed와 같음). 호출 전 확인은 Claude 쪽(도구 권한 프롬프트·사용자 지시)에 맡긴다. 앱의 이노봇 확인 카드 규칙은 이노봇에만 적용된다.
- **설정 없이 쓰기**: 조직 커넥터로 등록 → 사용자 PC의 127.0.0.1 서버는 claude.ai 서버가 접근할 수 없으므로 **웹이 MCP 끝점을 맡고 앱으로 중계**한다(§4).

범위 밖(후속 후보): Teams·Confluence·SharePoint 도구 11개의 MCP 노출, 결재 승인·반려(inno-creed에도 없음), `~/.config/inno-creed/approval_line.json` 사용자 override, 모바일(iOS·Android)에서의 실행기(앱이 백그라운드에서 죽어 신뢰할 수 없음), 앱이 꺼져 있을 때 서버가 대신 실행하는 폴백(조직도 등 서버 보유 데이터).

## 3. 현재 상태와 재사용하는 것

- `inno-creed` 2.2.0: Rust(rmcp 3.0.1), 크레덴셜은 Chrome 확장이 쓴 `~/Library/Application Support/inno-creed/ext-creds.json`(BIZCUBE_AT/HK) 또는 `inno-creed auth set`. 도구 57개의 이름·설명·입력 스키마 원본은 `scratchpad`에서 뽑아 `frontend/src/lib/mcp/tools.json`으로 옮긴다(2026-10-10 `tools/list` 출력). 읽기 도구 28개의 실제 응답을 픽스처로 받아 두었다(응답 형식 기준).
- 앱: `GwClient`(서명 4종·봉투 해석·multipart·form), `GwApi`·`GwAssistantApi`(회의실·일정·근태·메일·결재·게시판·검색·명부 — 도구 24개분), `AssistantToolRunner`(이노봇용 — MCP는 거치지 않는다: 이름·인자·결과 형식이 다르고 비서 전용 정책(메일 가드·실행 기록)이 섞여 있다). 크레덴셜 모델은 inno-creed와 동일(`authToken`=BIZCUBE_AT, `signKey`=BIZCUBE_HK).
- 웹: `createBearerSupabase`(Bearer JWT → `getUser`), `page-access`(페이지·API 권한), `logAudit`, Vercel 함수 `maxDuration`(최대 120 사용 중), Supabase(Azure 로그인).
- Supabase **OAuth 2.1 서버**는 아직 꺼져 있다(`/auth/v1/.well-known/oauth-authorization-server` 404). 켜면 인가·토큰·DCR·메타데이터를 Supabase가 제공하고 우리는 **동의 화면 한 장**만 만든다.
- macOS 앱 entitlements: `network.client`·`network.server`·`files.user-selected.read-write`는 있고 `files.downloads.read-write`는 없다(다운로드 도구용으로 추가).

## 4. 전체 구조

```
claude.ai / Claude Desktop / Claude Code / Cowork
   │  HTTPS, Streamable HTTP(JSON-RPC), Bearer(Supabase OAuth 액세스 토큰)
   ▼
innocrew.innogrid.com (Vercel, Next.js)
   /api/mcp                      initialize·tools/list·tools/call·ping
   /.well-known/oauth-protected-resource   → Supabase 인가 서버 가리킴
   /oauth/consent                Supabase가 보내는 동의 화면(로그인 재사용)
   │  tools/call → mcp_calls INSERT(user_id, tool, args) → 결과 폴링(0.5초) → 행 삭제
   ▼
Supabase: mcp_calls(RLS: 본인 행만) + Realtime(postgres_changes)
   ▲  구독·클레임·결과 UPDATE(앱 로그인 세션)
   │
데스크탑 앱(macOS·Windows) `lib/mcp/`
   McpWorker: INSERT 알림 → 클레임 → McpTools 디스패치(57) → GwClient(아마란스) → 결과 저장
```

왜 중계인가: claude.ai는 Anthropic 송신 대역(160.79.104.0/21)에서 **공개 HTTPS**로만 접속한다. 사용자 PC는 공개 주소가 없고 앱은 들어오는 연결을 받을 수 없으므로, 앱이 **바깥으로 구독**하고 웹이 사이를 잇는다. 상시 연결이 필요한 WebSocket 중계 서버를 새로 두지 않고, 이미 있는 Supabase Realtime(앱 ← 알림)과 DB 행(웹 ↔ 앱)으로 잇는다 — 새 인프라 없음.

## 5. 인증(OAuth 2.1)

### 5.1 역할
- **인가 서버**: Supabase Auth OAuth 2.1 서버(프로젝트 `avooqcxehfeurjhqqgui`). 메타데이터 `https://avooqcxehfeurjhqqgui.supabase.co/auth/v1/.well-known/oauth-authorization-server`, 인가 `/auth/v1/oauth/authorize`, 토큰 `/auth/v1/oauth/token`, DCR(동적 클라이언트 등록) 켬. PKCE S256은 Supabase가 지원(Claude는 모든 요청에 S256을 붙인다).
- **리소스 서버**: `/api/mcp`. 토큰 없거나 틀리면 **401** + `WWW-Authenticate: Bearer resource_metadata="https://innocrew.innogrid.com/.well-known/oauth-protected-resource"`(Claude는 401에서만 사인인을 시작한다). 메타데이터 문서:
  ```json
  { "resource": "https://innocrew.innogrid.com/api/mcp",
    "authorization_servers": ["https://avooqcxehfeurjhqqgui.supabase.co/auth/v1"],
    "scopes_supported": ["email", "profile"], "bearer_methods_supported": ["header"] }
  ```
  `resource`는 Owner가 커넥터에 입력하는 URL과 **정확히** 같아야 한다.
- **토큰 검증**: Supabase OAuth 액세스 토큰은 표준 Supabase JWT(`sub`·`role`·`client_id`) → 기존 `createBearerSupabase(token).auth.getUser()`로 검증·사용자 식별. 이 JWT는 다른 `/api/*`에서도 같은 사용자로 통한다(같은 본인 권한이므로 허용). `page-access`에 키 `mcp`(`/api/mcp`, user 이상)를 추가해 guest를 막는다.

### 5.2 동의 화면 `/oauth/consent`
Supabase 대시보드 Authentication > OAuth Server에서 켜고 Authorization path를 `/oauth/consent`로 두면 Supabase가 `https://innocrew.innogrid.com/oauth/consent?authorization_id=…`로 보낸다. 페이지(클라이언트 컴포넌트):
1. 로그인 안 됐으면 기존 로그인으로(`/login?next=/oauth/consent?authorization_id=…`).
2. `supabase.auth.oauth.getAuthorizationDetails(id)` → 클라이언트 이름(Claude)·요청 scope·**redirect_uri 호스트**를 표시한다(MCP 규격: 루프백 리디렉션이면 "이 PC의 프로그램(Claude Code)이 연결을 요청했습니다" 경고 문구).
3. [허용] → `approveAuthorization(id)` → 응답 `redirect_url`로 이동. [거부] → `denyAuthorization(id)`.
4. 감사: `logAudit(category:"auth", action:"mcp.oauth.approve|deny")`에 client_id만.

### 5.3 Claude 쪽 등록
- 하드 요구: 콜백 `https://claude.ai/api/mcp/auth_callback`(claude.ai·Desktop·모바일·Cowork)과 Claude Code의 루프백 `http://localhost:<임의 포트>/callback`·`http://127.0.0.1:<임의 포트>/callback`을 인가 서버가 받아야 한다. Claude는 DCR로 자기 redirect_uri를 등록하므로 우리가 손으로 등록할 것은 없다.
- **확인됨(2026-10-10)**: 조직 커넥터는 Claude Code에 자동으로 뜬다(`claude mcp list`에 "claude.ai INNOGRID 아마란스 ✔ Connected") — claude.ai가 쥔 토큰을 쓰므로 루프백 콜백이 필요 없다. 폴백 인가 서버는 불필요.
- 커넥터 등록(Team 플랜은 **Owner·Primary Owner만** 가능): claude.ai 관리자 설정 > 커넥터 > 사용자 지정 커넥터 추가 → URL 입력 → 인증 "Register automatically"(DCR) → 저장. 구성원은 커넥터 목록에서 [연결]을 누른다(조직 등록만으로 자동 연결되지는 않는다 — Anthropic 문서).

## 6. MCP 끝점 `/api/mcp` (`frontend/src/app/api/mcp/route.ts`, `lib/mcp/`)

- **전송**: Streamable HTTP, 무상태. `POST` JSON-RPC 2.0 한 건(배치 미지원 → -32600), 응답은 `application/json` 단일(SSE 없음). `GET` → 405, `DELETE` → 200(세션 없음). `Mcp-Session-Id` 발급 안 함. `maxDuration = 120`.
- **메서드**: `initialize`(요청의 `protocolVersion`을 그대로 되돌림, `capabilities:{tools:{}}`, `serverInfo:{name:"innogrid-app", version:<앱 릴리스와 무관한 끝점 버전>}`), `notifications/initialized` → 202 빈 응답, `ping` → `{}`, `tools/list` → `tools.json` 57개(설명 속 `~/.config/inno-creed/...` 문구는 "앱 설정 폴더"로 바꾼 사본), `tools/call` → §7 중계. 그 외 → -32601. 본문 상한 1MB(-32600), JSON 오류 -32700.
- **인증**: §5. 사용자 역할 user 이상. 분당 60건/사용자(최근 1분 `mcp_calls` 건수) 초과 → `isError` "잠시 후 다시".
- **결과 형식**: 성공 `{"content":[{"type":"text","text":<JSON 문자열>}]}`; 도구 실패 `{"content":[{"type":"text","text":"<오류 문장>"}],"isError":true}`. inno-creed처럼 성공 JSON 안의 `ok:false`(반영 미확인) 패턴은 그대로 둔다.
- **감사**: `logAudit(category:"mcp", action:"mcp.tool", detail:{tool, ms, ok})` — 인자·결과·토큰 금지.

## 7. 중계(웹 ↔ 앱)

### 7.1 테이블 `mcp_calls` (`docs/sql/2026-10-10-mcp-calls.sql`)
| 컬럼 | 타입 | 뜻 |
|---|---|---|
| id | uuid PK | 호출 id |
| user_id | uuid FK auth.users | 호출한 사용자 |
| tool | text | 도구 이름 |
| args | jsonb | 인자(전달 즉시 행 삭제) |
| status | text | `pending` → `running` → `done` \| `error` |
| result | jsonb | 앱이 쓴 결과(`{text}` 또는 `{error}`) |
| worker | text | 클레임한 기기 식별(앱 설치 id, 플랫폼) |
| created_at, claimed_at, done_at | timestamptz | |

RLS: `user_id = auth.uid()`인 행만 SELECT·UPDATE(앱 세션). INSERT·DELETE는 service role(웹)만. `supabase_realtime` publication에 추가. 인덱스 `(user_id, status, created_at)`.

### 7.2 흐름
1. 웹: INSERT(pending) → 0.5초마다 행 조회.
2. 앱: Realtime `postgres_changes` INSERT(`user_id=eq.<me>`) 수신(+ 5초 주기 안전 폴링 `status=pending`) → **클레임** `UPDATE … SET status='running', worker=… WHERE id=? AND status='pending'`(반환 행 있으면 내 것 — Mac·Windows 앱이 둘 다 떠 있어도 한쪽만 실행).
3. 앱: 디스패치·실행(도구별 시간 제한 90초) → `UPDATE status='done'|'error', result`.
4. 웹: `done|error`를 보면 결과를 MCP 응답으로 바꾸고 **행을 삭제**한다. 10초 안에 클레임이 없으면 삭제 후 `isError` "데스크탑 앱이 실행 중이 아닙니다. innocrew.innogrid.com/apps 에서 앱을 설치·로그인하고 아마란스를 연결하세요."; 110초 안에 끝나지 않으면 삭제 후 `isError` "앱이 응답하지 않았습니다(시간 초과). 쓰기 작업이면 아마란스에서 반영 여부를 확인하세요."
5. 정리: `/api/cron/mcp-purge`(5분마다) — 10분 지난 행 삭제(비정상 종료 잔여물).

### 7.3 앱 워커 `lib/mcp/mcp_worker.dart`
- macOS·Windows 전용(`talkAlertWatcherProvider`와 같은 자리에서 `ref.watch`). 조건: 앱 로그인 세션 있음 + 설정 스위치 "Claude 커넥터 요청 받기"(기본 켬). 아마란스 미연결이면 구독은 유지하고 도구 결과는 `error: "아마란스가 연결되어 있지 않습니다. 앱 더보기 > 아마란스에서 연결하세요."`.
- 구독 끊김(네트워크·절전)은 supabase_flutter가 재연결; 폴링이 공백을 메운다. 실행은 직렬(한 번에 하나) — 아마란스 서명값은 1회용이라 동시 호출로 섞일 일은 없지만 단순함을 위해.
- 결과 크기 상한 512KB(초과 시 앞부분 + `truncated:true`).
- 상태 노출: `더보기 > Claude 커넥터`(§9).

## 8. 도구 57개 매핑 (`lib/mcp/mcp_tools.dart`, 신규 호출은 `lib/gw/gw_mcp_api.dart`)

등급은 inno-creed 설명과 앱 `assistantToolTiers` 기준(정보용 — 노출·실행에 차이 없음). "실측"은 §10 방법으로 요청·응답을 받아 픽스처를 만든 뒤 구현한다는 뜻. 응답 형식은 모두 inno-creed 픽스처와 같은 키.

**세션·사람·조직**
| 도구 | 등급 | 재료 | 비고 |
|---|---|---|---|
| whoami | read | `session()` + 명부(`roster()`)의 duty·position | `profileResolved` |
| find_person | read | `findPerson` 확장: 이름·ID·이메일·부서명·부서경로·직책·직급 부분일치, `limit` 기본 20, `no_limit`, `truncated` | |
| org_chart | read | `gw102A01` 트리(이미 roster가 호출) + `gw102A02` 부서원 | `tree`/`flat`/`parent_seq`/`dept_id`, userCount 누적 |
| person_group · save_person_group · delete_person_group | read·write·write | 앱 지원 디렉터리 `person_groups.json`(`{"groups":{이름:{note,members:[{empSeq,label}]}}}`, inno-creed와 같은 형식) + 명부 검증(없는 사람·동명이인이면 저장 안 함, 후보 반환) | 응답 `path`는 실제 파일 경로 |

**회의실**
| 도구 | 등급 | 재료 | 비고 |
|---|---|---|---|
| list_resources | read | `resources()` 원본 `resultList` | |
| list_reservations | read | `rs121A05` 기간·`res_seqs`·`verbose` | |
| my_reservations | read | `myReservations` | `displayTitle` |
| find_free_rooms | read | `freeRooms` + `group`·`include_lunch`·`window` | |
| reserve_resource | write | `reserveRoom` + `attendees`(이름·empSeq)·`desc`·`req_text`, `lunchWarning` | |
| update_reservation | write | **신규** `rs121A12`(실측) → 응답의 새 `seqNum`·`resIdx`로 `rs121A10` 재조회 `attendeesVerified`(캡처가 A05가 아니라 A10) | 참석자 미지정 시 유지, 반복 예약(repeatType≠10)은 거절(미실측) |
| cancel_reservation | write | `cancelReservation` | |

**일정**
| 도구 | 등급 | 재료 | 비고 |
|---|---|---|---|
| list_calendars | read | `calendars()` 원본 `resultList` | |
| list_events | read | `sc111A03` 기간 | |
| create_calendar_event | write | `createEvent` + `allday`·`calendar`(mcalSeq·이름)·`secret_memo`·`video`(실측) | 공용 캘린더 경고 |
| update_calendar_event | write | **신규** `sc111A05` 수정 모드(실측) + 소유권 확인·재조회 | |
| delete_calendar_event | write | `deleteEvent` | |

**근태**
| 도구 | 등급 | 재료 | 비고 |
|---|---|---|---|
| get_attendance_today | read | `attendanceToday` | |
| attendance_clock_in · attendance_clock_out | write | `punch` | already·read-back |
| attendance_month | read | **신규** `/human/...` 기간 조회(실측 — 바이너리 문자열 `attendancePeriod`) | `days[]`·`summary` |

**메일**
| 도구 | 등급 | 재료 | 비고 |
|---|---|---|---|
| list_mailboxes | read | `mail000A01` 원본 봉투 | |
| mailbox_counts | read | `mail000A03` 원본 배열 | |
| list_mail_inbox | read | `mail003A01` 원본 봉투(`Records`) | |
| list_mail_drafts | read | `mail003A01` + DRAFTS `mboxSeq` | |
| read_mail | read | `mailRead` → inno-creed 형식(`attachments[].fileSn` 토큰, `inlineImages`, `remoteResourceCount`) 실측 대조 | 읽음 처리됨(설명 그대로) |
| mark_mail_unread | write | **신규** `mail002A15`(실측) + 목록 재조회 `verifiedByReadback`, 최근 200건 | |
| delete_mail | write | **신규** `mail002A05`/`A07`(실측) | |
| save_mail_draft | write | `mailSaveDraft` + `attachments`(로컬 파일 업로드 실측)·`signature` | |
| send_mail | irreversible | `mailSend` + 위와 같음 | |
| send_mail_from_draft | irreversible | **신규** `mail014A06`/`A08`(실측) + 초안 삭제·제약 4가지(설명) | |
| download_mail_attachment | read | **신규** `email014A08`(실측) → 파일 저장 | §9 저장 경로 |
| download_body_image | read | **신규** gw 호스트 이미지 GET(서명 헤더), 외부 호스트 거부 | |

**결재**
| 도구 | 등급 | 재료 | 비고 |
|---|---|---|---|
| approval_counts | read | `approvalCounts` → 픽스처 키(`sent(상신)` 등) | |
| pending_approvals | read | `pendingApprovals` | |
| list_approvals | read | **신규** `eap105A04` 함별 `eaBoxId/menuNo`(실측), draft는 `eap107A06`(실측) | 8개 함 |
| read_approval | read | `approvalDetail`(`eap111A04`) 형식 맞춤 | |
| list_approval_attachments | read | **신규** 상신 문서·임시 문서 각각(실측) | `files[].fileId` |
| download_approval_attachment | read | **신규** `ecm001A04`(실측), 1건만 | |
| list_approval_lines · read_approval_line · save_approval_line · delete_approval_line | read·read·write·write | **신규** `eap102A02`·`A05`·`A10`·`A09`(실측) | `_row` 그대로 삭제 |
| list_approval_line_schemas · get_approval_line_schema · list_approval_submission_guides · get_approval_submission_guide | read | **내장 자산** `mobile/assets/mcp/approval_*.json`(inno-creed 2.2.0 출력, version 2026-08-01 / 2026-08-05c) | override 파일 미지원 |
| suggest_approval_line | read | 앱 로직: 스키마 + whoami duty로 branch 선택(출장은 `trip`) + 직책→사람(`L_*`는 기안 부서에서 상위로, 고정 직책은 `positions[].dept` 부서원) | `verificationRequired:true` 고정 |
| submit_approval | irreversible | **신규** 근태 HP(`0hr00011`→create→interlock: GetLinkKey→saveAttendApplicationLinkKey→SetEnageGroup) → 첨부 ECM(`ecm001A01`/`A03`) → `eap110A03`(결재선 병합) → 상신(실측) | 가장 큼. 시험 상신은 본인만 담은 결재선, 끝나면 purge 취소 |
| cancel_approval | write | **신규** `eap110A54`→`A18`→`A19` + 상태 재조회(실측) | 상태 10·20·30만 |
| delete_temp_approval | write | **신규** `eap107A25`(실측) + draft 재조회 | |

**게시판·검색**
| 도구 | 등급 | 재료 | 비고 |
|---|---|---|---|
| list_notices | read | `notices` + `field`·`start_date`·`end_date`, 픽스처 키 | |
| read_notice | read | `notice` + `images[]` | |
| list_notice_attachments | read | **신규**(실측) | `files[].fileSn` 0-base |
| download_notice_attachment | read | **신규**(실측) | |
| search | read | `search` + `scope`·`from`·`to`·`limit` | |

합계 57. 앱에 없는 **신규 호출 22개**는 모두 실측 뒤 구현한다; 실측을 못 한 도구는 `isError` "이 버전에서는 지원하지 않습니다"로 두지 않고 **`tools/list`에서 뺀다**(설명과 다른 거동을 내놓지 않는다). 최종 목표는 57개 전부 노출.

## 9. 앱 쪽 세부

- **파일**: `lib/mcp/mcp_worker.dart`(구독·클레임·실행·결과), `lib/mcp/mcp_tools.dart`(이름 → 핸들러 57, 인자 정규화: inno-creed 스키마가 `['string','integer']`를 허용하므로 `asStr`/`asInt`로 받는다), `lib/gw/gw_mcp_api.dart`(신규 엔드포인트 22개분), `lib/mcp/person_groups.dart`, `lib/mcp/approval_schemas.dart`(자산 로드·suggest 로직), `assets/mcp/*.json`.
- **다운로드 도구** `out_path`: 그 경로에 쓰고 실패(macOS 샌드박스 밖 경로)하면 `~/Downloads/<파일명>`에 저장하고 응답 `savedPath`로 알린다. macOS entitlements 2개 파일에 `com.apple.security.files.downloads.read-write` 추가. 업로드(첨부) 인자의 로컬 경로도 같은 제약 — 읽기 실패 시 오류 문장에 "Downloads 폴더에 두고 다시".
- **설정 화면** `더보기 > Claude 커넥터`(데스크탑만, `_GwRow` 아래 행): 상태(연결 대기 중 / 마지막 호출 `도구명 · N초 전` / 아마란스 미연결 경고), 스위치 "Claude 커넥터 요청 받기", 안내 "claude.ai 커넥터에서 'INNOGRID 아마란스'를 연결하면 이 앱이 요청을 실행합니다". 모바일에는 표시하지 않는다.
- **기기 식별** `worker`: 설치 id(uuid, shared_preferences) + 플랫폼 — 감사용 아님, 클레임 충돌 진단용.

## 10. 신규 엔드포인트 실측 방법

inno-creed는 `HTTPS_PROXY`를 따르고(실측: 닫힌 포트를 주면 요청 실패) TLS는 `rustls-platform-verifier`(macOS 키체인 신뢰)다. 따라서:
1. `brew install mitmproxy`, `mitmdump -w flows` 기동, mitm CA를 로그인 키체인에 **사용자가** 신뢰 등록(비밀번호 1회).
2. `HTTPS_PROXY=http://127.0.0.1:8080 ~/bin/inno-creed`를 stdio로 띄워 도구별 `tools/call` 1회 → 요청 헤더·본문·응답 JSON을 `mobile/test/mcp/fixtures/<tool>.json`으로 추출(스크립트 `mobile/scripts/mcp-fixture-from-flows.py`, 토큰·서명 헤더·개인정보는 가린다).
3. 쓰기 도구의 안전 대상: 예약·일정은 시험 건 만들고 취소, 메일은 본인 수신 초안, 결재는 **외근신청**을 본인만 담은 결재선으로 상신 후 `cancel_approval(purge=true)`, 임시보관 삭제는 그 잔여물. 출퇴근 punch는 캡처하지 않는다(앱이 이미 가짐).
4. 캡처한 쌍이 곧 MockClient 픽스처 → 구현 → 단위 테스트. 실기기 확인은 Claude Code에서 커넥터로 1회.

## 11. 오류 처리

| 상황 | 동작 |
|---|---|
| 토큰 없음·만료 | 401 + `WWW-Authenticate … resource_metadata` → Claude가 재로그인·갱신 |
| guest 역할 | 403 `{"error":"권한 없음"}`(MCP 응답 아님) |
| 모르는 도구 | JSON-RPC -32602 "모르는 도구" |
| 앱 미실행(10초 미클레임) | `isError` 안내 + /apps 링크 |
| 앱 실행 중 시간 초과(110초) | `isError` + 쓰기면 반영 확인 안내; 앱은 결과를 써도 행이 없으면 무시 |
| 아마란스 미연결·401 | `isError` "아마란스가 연결되어 있지 않습니다…"; 앱은 `needsRelogin` 배너 |
| GwException(resultCode≠0) | `isError` 서버 `resultMsg` 그대로 한 줄 |
| 분당 60건 초과 | `isError` "요청이 너무 많습니다" |
| 결과 512KB 초과 | 앞부분 + `truncated:true` |

## 12. 테스트

- 웹(vitest): `/api/mcp` initialize·tools/list(57·스키마 원본 동일)·tools/call 중계(가짜 Supabase: pending→done 행 전이, 10초·110초 시간 초과, 행 삭제), 401 헤더 형식, 메타데이터 JSON, 분당 상한, 배치·GET·크기 상한; `/oauth/consent` 로그인 리디렉션·승인·거부(supabase-js oauth 메서드 모킹).
- 앱(flutter test): `McpWorker` 클레임 경합(두 워커 중 하나만)·폴링 공백·직렬 실행·결과 상한; `McpTools` 57개 각각 MockClient 픽스처로 **inno-creed 응답 키 일치** 단정(픽스처 = inno-creed 실측 출력); 사람 그룹 파일 검증(동명이인·없는 사람); suggest_approval_line(연차·출장 국내/해외·외근·휴일 4양식 × 직책 분기); 다운로드 경로 폴백. `dart format` 금지(치환 편집), `flutter analyze` 0건.
- 수동: Supabase OAuth 켠 뒤 claude.ai 사용자 지정 커넥터로 [연결] → whoami·find_person·list_mail_inbox; Claude Code `claude mcp list`에 뜨는지와 **루프백 콜백 통과 여부**(§5.3 확인 항목); Windows 앱에서 같은 호출.

## 13. 배포·전환 순서

1. SQL(`mcp_calls`·RLS·publication) 적용 → 프론트 배포(끝점·메타데이터·동의 화면) → Supabase 대시보드: OAuth 2.1 서버 켬, Authorization path `/oauth/consent`, DCR 켬(관리자 작업).
2. 앱 릴리스(macOS·Windows; 모바일은 워커 없음) → `/apps`.
3. Owner: claude.ai 관리자 설정 > 커넥터 > 사용자 지정 커넥터 "INNOGRID 아마란스" 등록(URL, Register automatically).
4. 사용자: 앱 설치·로그인·아마란스 연결 → claude.ai 커넥터 [연결] → 로그인·동의.
5. `frontend/scripts/company-directory-sync.py`: inno-creed stdio 대신 커넥터 끝점(`INNO_MCP_URL`·앱 로그인 토큰)으로 `find_person(no_limit)` 호출하도록 옵션 추가(기본은 기존 바이너리 유지, 둘 다 되면 바이너리 경로 제거).
6. 각자 `~/.claude.json`의 `inno-creed` 항목과 바이너리는 사용자가 정리(문서 안내). 도구 id가 `mcp__inno-creed__*`에서 `mcp__claude_ai_<커넥터명>__*`으로 바뀌므로 커넥터 이름을 정할 때 알린다.

## 14. 다음 단계 후보(이번 범위 밖)

Teams·Confluence·SharePoint 11개 노출(서버 도구라 앱 없이도 웹이 직접 실행 가능), 앱 미실행 시 서버 폴백(조직도·사람 찾기는 `company_directory`로), Realtime 대신 Supabase Edge Function/WebSocket 중계(지연 0.5초가 문제될 때), 결재 승인·반려.
