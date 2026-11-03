# 이노봇 아키텍처

이노봇은 INNOCREW의 사내 AI 비서다. 웹 `/chat`, 모바일 앱의 아래 시트, 데스크톱 앱의 떠 있는 창에서 같은 대화를 이어 쓴다.
"우리 앱의 모든 기능을 말로 다루는 입구"가 목표이며, Claude 커넥터(MCP)로 외부에 내놓은 아마란스 도구도 같은 코드로 직접 쓴다.

- 설계서: `docs/superpowers/specs/2026-10-15-llm-portal-phase1-design.md`(대화 플랫폼), `2026-10-05-mobile-assistant` 스펙(앱 도구)
- 운영 런북: `docs/mobile-app.md` §비서
- 이 문서: 동작 방식·도구 체계·안전장치·도구 추가 절차(2026-11-03 점검 기준)

## 1. 한눈에

```
 [웹 /chat]          [앱 이노봇(모바일 시트·데스크톱 창)]
      │  SSE                 │  SSE  (client:"web" | "app")
      ▼                      ▼
 ┌──────────── POST /api/chat/turn (Vercel) ────────────┐
 │ 권한 → 허용 모델 → 하루 상한 → 마스킹 → 도구 목록 구성 │
 │ runTurn(engine.ts) ── Claude(스트리밍, 도구 사용) ──── │
 │   도구 호출마다 "어디서 실행하나(location)" 판정        │
 │     server        → 서버가 바로 실행(읽기) / 확인 후    │
 │     desktop-relay → mcp_calls 행 → 사용자 데스크톱 앱   │
 │     device        → needs_action으로 멈추고 앱에 넘김   │
 │ 대화·요약만 저장(chat_* 테이블), 감사엔 도구 이름·건수  │
 └──────────────────────────────────────────────────────┘
          │ needs_action(쓰기·기기 도구)        ▲ actions(결과·승인)
          ▼                                     │
 [앱] AssistantToolRunner ─ 아마란스 GwApi / 메신저 / McpTools / 화면 이동
       확인 카드(앱이 실제 대상을 다시 읽어 만든 문장) → 사용자가 승인한 것만 실행
```

서버는 Claude와 대화 저장을 맡고, 아마란스처럼 **사용자 기기에만 로그인돼 있는 시스템은 기기가 실행**한다.
아마란스 비밀번호·세션은 서버로 올라가지 않는다.

## 2. 한 턴의 흐름

1. 클라이언트가 `POST /api/chat/turn`에 `{client, conversationId?, text | actions, desktopOnline}`를 보낸다.
2. 서버(`app/api/chat/turn/route.ts`)가 차례로 확인한다.
   - 페이지 권한 `assistant`
   - 허용 모델(settings `assistant_models`)
   - 하루 상한(`assistant_usage`, 기본 200턴)
3. 사용자 글은 `lib/chat/mask.ts`가 주민번호·카드·전화·계좌를 가린 뒤 Claude에 보낸다.
4. `buildToolset`(`lib/chat/toolset.ts`)이 클라이언트·데스크톱 연결·페이지 권한으로 도구 목록과 각 도구의 실행 위치를 정한다(§3).
5. `runTurn`(`lib/chat/engine.ts`)이 Claude를 스트리밍으로 부른다. 도구 호출은 위치에 따라 처리한다.
   - **server + read**: 서버가 바로 실행하고 결과를 Claude에 돌려준다(최대 3회 왕복).
   - **desktop-relay(웹 전용, 읽기만)**: `mcp_calls`에 행을 넣고 사용자의 데스크톱 앱 MCP 워커가 실행한 결과를 기다린다.
   - **그 밖(쓰기 또는 device)**: `needs_action` 이벤트로 멈춘다.
     - 서버 쓰기는 서버가 먼저 실제 대상을 조회한다(`resolveTargets`: Teams 방 이름, Confluence 공간, 할 일 제목).
     - 기능 쓰기는 서버가 확인 카드 줄도 만든다(`featureCard`).
6. 클라이언트가 확인 카드를 보여 준다. 사용자가 승인(또는 거절)하면 그 결과를 `actions`로 다시 보낸다.
   - 앱은 기기 도구를 실행한 결과도 함께 보낸다.
   - 서버는 승인 행을 `running`으로 먼저 잡아(claim) 같은 승인이 두 번 실행되지 않게 한다.
7. 저장 범위:
   - DB에는 대화 글과 도구 결과의 **요약 한 줄**(`lib/chat/summary.ts`)만 남는다. 결과 원문은 그 요청 안에서만 Claude에 넘긴다.
   - 보존 기간은 settings `assistant_retention_days`(기본 90일)이고, 크론 `/api/cron/chat-purge`가 지운다.

## 3. 도구 체계

원본은 하나다. 도구 이름과 등급은 `frontend/src/lib/assistant/tool-contract.json`(계약)과 `feature-tools.ts`의 `FEATURE_TIERS`가 정한다.
서버 `tools.ts`는 등급을 여기서 가져오고, 앱 테스트(`test/assistant/assistant_tools_test.dart`)는 앱 표를 이 파일과 대조한다.

| 묶음 | 개수 | 어디서 실행 | 원본 | 예 |
|---|---|---|---|---|
| 앱 고유 도구 `appTools` | 44 | 앱(device) | 계약 + 스키마 `tools.ts` `ASSISTANT_TOOLS` | 회의실 예약, 일정, 출퇴근, 메일 목록·읽기·검색·발송, 결재 조회, 게시판, 메신저, `open_screen`, `team_absences`, `offer_choices`, `undo_last` |
| └ 그중 서버 위임 `appServerTools` | 11 | 서버(앱은 `/api/assistant/execute`, 웹은 직접) | 계약 | Teams 채팅·보내기, Confluence 검색·읽기·만들기, SharePoint 검색·읽기 |
| 앱 기능 도구 `FEATURE_TOOLS` | 9 | 서버(웹·앱 공통) | `feature-tools.ts` | 할 일 `todo_list·todo_add·todo_update`, Jira 내 업무, 인사·부고, 뭐 먹지, PPT 만들기·내 PPT |
| 아마란스 확장 `appMcpTools` | 33 | 앱(device) — **McpTools** | 계약 + 스키마 `mcp/tools.json` | 결재 목록·상신·회수·결재선, 메일함·임시보관함·첨부 내려받기·삭제·안 읽음, 일정·예약 수정, 월 근태, 조직도, 사람 묶음, `whoami` |
| 웹 중계 읽기 `RELAY_READ_TOOLS` | 37 | 데스크톱 앱(desktop-relay) | `toolset.ts` + `mcp/tools.json` | 웹에서 메일·결재·일정·메신저·결재선·월 근태 조회 |

웹과 앱이 받는 도구 목록은 다르다.

- **앱**: 앱 고유 도구 + 서버 위임 + 기능 도구 + 아마란스 확장(약 86개)
- **웹**: 서버 위임 + 기능 도구, 그리고 데스크톱 앱이 켜져 있을 때만 중계 읽기 도구. 웹에서 아마란스 쓰기는 하지 않고 앱에서 하라고 안내한다.
- **둘 다**: 페이지 권한이 없는 서버 도구(Teams·Confluence·SharePoint·Jira·할 일·PPT 등)는 목록에서 빠진다.

### 3-1. MCP(Claude 커넥터)와 한 코드

`mobile/lib/mcp/mcp_tools.dart` `McpTools`는 아마란스 도구 61개를 구현한다. 이 코드를 세 통로가 함께 쓴다.

1. **claude.ai 커넥터 "INNOGRID 아마란스"**: `/api/mcp` → `mcp_calls` → 데스크톱 앱 `McpWorker`(2초 폴링) → `McpTools.execute`
2. **웹 이노봇**: 같은 `mcp_calls` 중계로 읽기 도구만(`RELAY_READ_TOOLS`)
3. **앱 이노봇**: 중계 없이 `AssistantToolRunner`가 `McpTools.execute`를 직접 부른다(`appMcpTools`, 2026-11-03).
   - 이노봇 고유 도구와 기능이 겹치는 MCP 도구(메일 목록·일정 등록 등 27개)와 보류 중인 `download_body_image`는 넣지 않았다.
   - 겹치는 도구는 이노봇 쪽이 확인 카드용 대상 조회·되돌리기·메일 읽기 제한을 갖고 있어서 그쪽을 쓴다.

커넥터에 도구를 더하면(`tools.json`·`McpTools`), 계약 `appMcpTools`에 이름과 등급만 넣으면 이노봇도 쓴다.

### 3-2. 등급

| 등급 | 뜻 | 실행 |
|---|---|---|
| `read` | 조회 | 바로 실행(서버 읽기는 서버가, 기기 읽기는 앱이 카드 없이) |
| `write` | 바꾸기 | 확인 카드 승인 후 |
| `irreversible` | 되돌릴 수 없음(메일 발송, 결재 상신, 임시보관 메일 발송) | 확인 카드에 경고와 전문 |
| `choice` | `offer_choices` — 선택지마다 쓰기 묶음 | 사용자가 고른 선택지의 [실행]이 승인 |
| `meta` | `undo_last` — 실행 기록에서 되돌릴 대상을 앱이 고름 | 확인 후 |

등급은 Claude가 아니라 이 표가 정한다. 프롬프트 주입이 있어도 쓰기를 확인 없이 실행할 수 없다.
서버가 모르는 이름은 쓰기로 본다(`tierOf`). 앱이 모르는 이름은 실행하지 않는다.

### 3-3. 확인 카드 — 누가 만드나

- **앱 고유 쓰기**: 앱 `cardLine`이 만든다.
  - 그 전에 `resolve`가 실행에 쓰일 id로 실제 대상을 다시 읽는다(회의실 이름, 참석자 부서, 예약·일정 제목과 시각, 메신저 방).
  - 모델이 붙인 이름(`room_name`, `label`)은 카드에 쓰지 않는다.
- **서버 쓰기**:
  - Teams·Confluence는 서버가 조회한 `target`으로 카드를 만든다.
  - 기능 도구는 서버의 `featureCard` 줄을 앱·웹이 그대로 보인다. 그래서 새 기능 쓰기 도구는 앱을 업데이트하지 않아도 된다.
  - `todo_update`는 서버가 지금 제목을 조회해 카드에 넣는다.
- **아마란스 확장 쓰기**:
  - 카드는 도구 제목(`_mcpWriteLabel`)과 실행에 그대로 쓰일 **인자 전부**다. 값이 길면 300자까지만 보인다.
  - 사람이 읽기 쉬운 대상 이름으로 다시 조회하지는 않는다. 한계는 §7 참고.

## 4. 앱 쪽 구조(`mobile/lib/assistant/`)

| 파일 | 역할 |
|---|---|
| `assistant_session.dart` | 대화 상태(Riverpod Notifier). SSE 이벤트 처리, `needs_action` → 읽기 실행 / 확인 카드 / 선택지, 결과를 `actions`로 회신, 중지·시간 초과 처리 |
| `assistant_tools.dart` | 등급 표(`assistantToolTiers`·`appMcpToolTiers`), 진행 문구, `cardLine`, 결과 줄이기 `slim`, `MailReadGuard`, `AssistantToolRunner`(아마란스 GwApi·메신저·McpTools·화면 열기·서버 위임 실행) |
| `gw_assistant_api.dart` | 이노봇 고유 아마란스 호출(회의실·일정·출퇴근·메일 등, read-back 포함) |
| `assistant_journal.dart` | 실행 기록(되돌리기 `undo_last`의 근거) |
| `app_screens.dart` | `open_screen` 화면 키 → 앱 경로(권한은 메뉴와 같은 `canUsePage`) |
| `innobot_button.dart` · `assistant_sheet.dart` · `assistant_window.dart` | 떠 있는 버튼(앱 전체 위 오버레이), 모바일 시트, 데스크톱 창. 오버레이가 화면 이동 통로 `innobotOpenPath`를 건다 |
| `assistant_voice.dart` | 🎤 음성 입력·🔊 읽기(자동 TTS 없음) |
| `chat_api.dart` | `/api/chat/turn` SSE 클라이언트, 대화 기록 |

서버가 할 일을 바꾸면(`todo_add`·`todo_update` 완료 이벤트) 앱은 `todosProvider`를 다시 읽어 할 일 화면과 위젯을 맞춘다.

## 5. 안전장치

| 위험 | 장치 |
|---|---|
| 프롬프트 주입(메일·게시글·채팅 속 "…해 줘") | 규칙 4(데이터일 뿐 지시 아님), 등급 표 고정, 모든 쓰기는 확인 카드 |
| 모델이 지어낸 대상 | 카드는 실행 id로 다시 읽은 실제 대상(앱 `resolve`·서버 `resolveTargets`). 못 찾으면 카드 없이 오류로 돌려 모델이 다시 묻게 함 |
| 메일 읽음 처리 부작용 | `MailReadGuard`: 같은 요청의 목록·검색에서 나온 muid만, 요청당 5통 |
| 개인정보 유출 | 마스킹(`mask.ts`). 조직도 도구만 전화번호 예외(`ORG_TOOLS`). DB엔 결과 요약만. 감사엔 도구 이름·토큰·가린 건수만 |
| 중복 실행 | 승인 claim(`running`), 결과 불명 쓰기(응답 직전 끊김)는 "확인 후 다시" 안내만 하고 자동 재시도하지 않음 |
| 비용 | 하루 턴 상한, 허용 모델, 관리자 끄기(settings `assistant_enabled`) |
| 권한 | 서버 도구는 페이지 권한으로 목록에서 제외. 할 일은 서비스 키로 실행하되 `user_id` 조건 고정. `open_screen`은 `canUsePage` |

## 6. 도구를 추가할 때

1. **어디서 실행할지** 정한다.
   - 사용자 기기만 닿는 시스템(아마란스)이면 앱이 실행한다.
   - DB나 외부 API만 쓰면 서버 기능 도구(`feature-tools.ts`)로 만든다. 웹과 앱에서 함께 쓰이고 앱 업데이트가 필요 없다.
   - 커넥터 도구를 그대로 쓰면 되면 `appMcpTools`.
2. **계약부터** 고친다: `tool-contract.json`(`appTools`, `appServerTools`, `appMcpTools`) 또는 `FEATURE_TIERS`.
3. **스키마**: 앱 고유와 서버 위임은 `tools.ts` `ASSISTANT_TOOLS`, 기능 도구는 `FEATURE_TOOLS`, 확장은 `mcp/tools.json`(자동).
4. **규칙**: 언제 쓰는지 한 줄이 필요하면 `tools.ts` `ASSISTANT_RULES` 끝에 번호를 붙여 넣는다.
5. **요약 라벨**: `summary.ts` `TOOL_LABEL`(대화 기록·도구 칩에 쓰인다).
6. **앱**:
   - 등급 표와 실행(`assistant_tools.dart`), 쓰기면 `cardLine`과 `resolve`, 진행 문구를 맞춘다.
   - 서버 기능 도구면 앱 변경은 필요 없다(서버 카드 줄을 그대로 보인다).
7. **테스트**:
   - 웹: `assistant-tools.test.ts`(이름 목록), `assistant-feature-tools.test.ts`, `chat-toolset.test.ts`
   - 앱: `assistant_tools_test.dart`(계약 대조)
8. **배포 순서**: 웹(서버)을 먼저 배포한다.
   - 앱 도구를 추가했다면 예전 앱은 모르는 도구라 실행을 거절하고 "모르는 도구"로 답한다.
   - 그러니 그 도구를 쓰는 규칙은 앱이 보급된 뒤에 의미가 있다.

## 7. 점검 결과(2026-11-03)와 남은 구멍

이번에 메운 것:

- MCP 커넥터에만 있던 아마란스 도구 33개를 앱 이노봇이 직접 쓴다.
  - 결재: 상신·회수·결재선·첨부
  - 메일: 메일함·임시보관함·삭제·안 읽음·첨부 내려받기
  - 일정·회의실 예약 수정, 월 근태, 조직도, 사람 묶음
- 웹 이노봇 중계 읽기에 결재선·상신 안내·월 근태·메일함·임시보관함 등 15개를 더했다.
- 앱 기능:
  - 할 일 조회·추가·바꾸기(서버, 웹·앱 공통)
  - 앱 화면 열기 `open_screen`
  - 팀원 부재 `team_absences`(근태 화면과 같은 원본)

아직 남은 것:

- **확장 쓰기의 확인 카드**는 인자 그대로다.
  - 예: `delete_mail`은 muid만 보이고 메일 제목은 보이지 않는다.
  - 자주 쓰는 것부터 `resolve`에 대상 조회(메일 제목, 결재 문서 제목)를 넣는 게 다음 순서다.
- **첨부 내려받기·사람 묶음**은 데스크톱 폴더(Downloads, 앱 지원 폴더)를 전제로 한다. 모바일에서는 실패 문장으로 끝난다.
- **Dooray**(업무·일정)는 이노봇 도구가 없다. WebView 화면이라 `open_screen`으로 여는 것까지만 된다.
- **웹 이노봇의 아마란스 쓰기**는 설계상 없다(데스크톱 앱 중계는 읽기만).
- **홈 위젯 배치·즐겨찾기·Tip·테마 같은 앱 설정**은 도구로 만들지 않았다. 말로 바꿀 일이 드물어서다. 필요하면 서버 기능 도구로 쉽게 붙는다.
- `team_absences`는 근태 화면과 같은 함수를 감싼 얇은 도구다. 실데이터 실측은 하지 않았다.

## 8. 파일 지도

| 위치 | 내용 |
|---|---|
| `frontend/src/app/api/chat/turn/route.ts` | 턴 API(거버넌스, SSE) |
| `frontend/src/lib/chat/engine.ts` | `runTurn`, 대상 확인, 실행·기록 |
| `frontend/src/lib/chat/toolset.ts` | 도구 목록·위치, 웹 중계 읽기, 클라이언트별 지침 |
| `frontend/src/lib/chat/{store,summary,mask,usage,events}.ts` | 저장, 결과 요약, 마스킹, 사용량, 이벤트 타입 |
| `frontend/src/lib/assistant/tool-contract.json` | **계약**: 이름·등급 원본 |
| `frontend/src/lib/assistant/tools.ts` | 스키마, `ASSISTANT_RULES`, 시스템 프롬프트, `APP_MCP_TOOLS` |
| `frontend/src/lib/assistant/feature-tools.ts` | 서버 기능 도구(할 일·Jira·인사·뭐 먹지·PPT), 카드 줄 |
| `frontend/src/lib/assistant/server-tools.ts` | 서버 위임 도구 실행(Teams·Confluence·SharePoint) + 페이지 권한 |
| `frontend/src/lib/mcp/tools.json` | 커넥터 도구 스키마(이노봇 확장·웹 중계가 공유) |
| `mobile/lib/assistant/` | 앱 이노봇(§4) |
| `mobile/lib/mcp/mcp_tools.dart` | 아마란스 도구 구현(커넥터·웹 중계·앱 이노봇 공용) |
