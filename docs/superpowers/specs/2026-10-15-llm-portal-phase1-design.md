# 사내 LLM 포털 1단계 설계

- 작성: 2026-10-15
- 상태: 설계 승인(대화), 구현 계획 전
- 앞선 설계: `2026-10-05-mobile-assistant-design.md`(무상태 이노봇), `2026-10-10-desktop-mcp-connector-design.md`(mcp_calls 중계)

## 0. 목적과 범위

웹·앱을 사내 LLM 포털로 키운다. 1단계는 두 조각을 함께 한다.

- **A. 대화 플랫폼**: 서버가 대화를 저장하고 턴을 진행하는 API, 웹 채팅 화면(`/chat`), 파일 첨부, 거버넌스 최소 묶음.
- **C. 홈·정보구조**: 홈을 채팅 중심으로 재배치하고 메뉴에 이노봇을 올린다.

### 확정된 결정

| 항목 | 결정 |
|---|---|
| 사내 지식 | 사내 LLM 위키 프로젝트를 MCP로 연결한다. 포털은 벡터 DB를 만들지 않는다(연결은 위키 서버가 준비되면 별도 작업). |
| 화면 | 백엔드 하나, 화면 둘. 웹은 React 채팅, 앱은 네이티브 이노봇. WebView 공용화는 하지 않는다. |
| 대화 저장 | 서버 저장. 보존 기본 90일(관리자 변경), 사용자 즉시 삭제, 대화별 "저장 안 함". |
| 모델 | Sonnet 5.5 기본, Opus 5.5는 누구나 선택. |
| 비용 상한 | 하루 턴 수 상한 유지(`assistant_daily_turns`). 턴마다 토큰을 기록한다. 팀 예산 경고는 후속. |
| 민감정보 | 주민번호·카드번호·계좌번호·휴대전화를 가린 뒤 전송, 화면에 가린 건수 표시. 사내 조직도 도구 결과의 전화번호는 예외. |
| 웹의 아마란스 | 데스크톱 앱 중계로 **읽기 도구만**. 아마란스 쓰기(결재 상신·메일 발송 등)는 앱에서만. |
| 첨부 | 1단계에 포함(웹). 앱 첨부 화면은 후속. |

### 1단계에서 하지 않는 것

대화 공유, 대화 분기, 대화 목록 검색, 앱 첨부 화면, 팀 예산 경고, 위키 MCP 연결, `/guide`(NotebookLM) 정리.

## 1. 구조와 데이터

### 1.1 흐름

클라이언트(웹·앱)는 대화 ID와 새 입력(또는 앱 도구 결과)만 보낸다. 서버가 저장된 대화를 이어 붙여 Claude를 부르고, 결과를 저장하고, SSE로 흘려 보낸다.

```
클라이언트 ──POST /api/chat/turn──▶ 서버
                                   ├ 권한·상한·마스킹·도구 목록 계산(2절)
                                   ├ Claude 호출(스트리밍)
                                   ├ 서버 도구면 서버에서 실행 후 이어서 호출(한 턴 최대 3회)
                                   └ 앱 도구면 스트림을 멈추고 클라이언트에 실행 요청
클라이언트 ── 앱 도구 실행(쓰기는 확인 카드) ── 결과를 다시 POST
```

웹에서 아마란스 읽기 도구는 서버가 기존 `relayToolCall`(mcp_calls)로 데스크톱 앱에 맡긴다. 즉 웹에는 "클라이언트 실행" 도구가 없다.

### 1.2 테이블

모두 RLS로 본인만 읽고 쓴다. 관리자도 본문은 열람하지 못한다. service_role은 보존 크론과 첨부 정리에서만 쓴다.

- `chat_conversations`: `id`, `user_id`, `title`, `model`, `ephemeral`(저장 안 함), `created_at`, `last_message_at`, `expires_at`.
- `chat_messages`: `id`, `conversation_id`, `role`(user|assistant), `content`(jsonb, 마스킹 뒤 블록), `status`(ok|failed|stopped), `input_tokens`, `output_tokens`, `masked_count`, `created_at`.
- `chat_tool_calls`: `id`, `message_id`, `tool`, `location`(server|device|desktop-relay), `status`(ok|error|timeout|cancelled), `summary`(사람이 읽는 한 줄), `created_at`. **도구 결과 원문은 저장하지 않는다.** 대화를 다시 열면 결과 자리에 summary만 넣어 모델에 넘기고, 필요하면 모델이 도구를 다시 부른다.
- `chat_attachments`: `id`, `conversation_id`, `message_id`, `name`, `mime`, `size`, `storage_path`, `text_excerpt`(추출 텍스트 앞부분), `created_at`.
- `assistant_usage`: (`user_id`, `day` KST) 기본키, `turns`, `input_tokens`, `output_tokens`, `model_turns`(jsonb), `masked`. 턴마다 upsert. 하루 상한 계산과 관리자 집계에 쓴다.

버킷 `chat`(비공개): `chat/<user_id>/<conversation_id>/<attachment_id>`.

### 1.3 도구 실행 위치

도구 정의에 `location`을 붙인다.

- `server`: Teams·Confluence·SharePoint(기존 `SERVER_TOOLS`). 서버가 바로 실행.
- `device`: 아마란스·일정 등 앱 도구. 앱에서 대화할 때만 목록에 들어간다.
- `desktop-relay`: 웹에서의 아마란스 **읽기** 도구. 사용자의 데스크톱 앱이 살아 있을 때만 목록에 들어간다. 없으면 시스템 프롬프트에 "아마란스는 데스크톱 앱이 켜져 있어야 함" 한 줄만 넣는다.

### 1.4 API

- `POST /api/chat/turn` — 입력: `conversationId?`(없으면 새로 만듦), (`text`·`attachmentIds`) 또는 `actions`(확인 카드 답·앱 도구 결과 `{id, approve?|result?, isError?}`) 또는 `retry` 중 하나, `model`, `client`(web|app), `ephemeral?`, `desktopOnline`. 출력: SSE(`conversation`, `text`, `tool`(running→ok·error, 요약), `masked`, `needs_action`(확인·앱 실행이 필요한 호출 — 서버가 조회한 `target`, 앱 기능 쓰기는 서버가 만든 카드 줄 `card`), `done`, `error`). (구현하며 `tool_call`·`tool_summary`는 `tool`로, `needs_client_tool`은 `needs_action`으로 합쳤다.)
- `GET /api/chat/conversations`, `GET·PATCH·DELETE /api/chat/conversations/[id]` — 목록(ephemeral 제외)·본문·이름 바꾸기·삭제.
- `POST /api/chat/attachments` — 업로드, 텍스트 추출, 첨부 ID 반환.
- 중지: 별도 API 없이 클라이언트가 연결을 끊으면 받은 데까지 `stopped`로 저장한다.
- 기존 `POST /api/assistant/turn`·`/execute`는 앱이 새 API로 옮겨 갈 때까지 유지하고, 옮긴 뒤 걷어 낸다.

## 2. 거버넌스 집행 지점

모든 집행은 `/api/chat/turn` 한 곳에서 이 순서로 한다.

1. **인증·권한**: user 이상, 페이지 키 `assistant`. 관리자 스위치 `assistant_enabled`가 꺼져 있으면 중단. 키 추가 시 DB 함수 `valid_page_permissions`·`has_page_access` 키 목록도 갱신(새 SQL 파일).
2. **하루 상한**: `assistant_usage`의 오늘(KST) `turns`가 `assistant_daily_turns` 이상이면 429 "오늘 한도를 다 썼습니다". `turns`는 **Claude 호출 1회 = 1**로 센다(서버 도구 왕복이 있으면 한 질문에 최대 4). 실패한 호출은 세지 않는다.
3. **모델 확인**: 허용 목록(settings `assistant_models`, 기본 Sonnet 5.5·Opus 5.5) 밖이면 Sonnet으로 바꾼다(구현은 상한 다음 — 둘 다 거절 전 단계라 순서 영향 없음).
4. **마스킹**: 사용자 입력, 첨부 추출 텍스트, 도구 결과를 Claude에 보내기 직전에 가린다.
   - 주민번호: `\d{6}-?[1-8]\d{6}` + 앞 6자리 날짜 검증(뒷자리 5~8 외국인등록번호 포함).
   - 카드번호: 13~19자리(하이픈·공백 허용) + Luhn.
   - 계좌번호: 하이픈이 있는 은행 형식(`\d{2,6}-\d{2,6}-\d{2,7}` 계열, 카드·주민·전화와 겹치지 않는 것)만.
   - 휴대전화: `01[016789]`·`+82 1[016789]` + 하이픈·공백·점 구분. **사내 조직도 도구 결과는 제외**.
   - 치환: `[주민번호]`, `[카드번호]`, `[계좌번호]`, `[전화번호]`. DB에는 가린 뒤 본문만 저장. 메시지에 "개인정보 N건 가림" 배지.
   - 이미지·스캔 PDF는 가릴 수 없다 → 첨부 시 안내 문구.
5. **도구 목록 계산**: 1.3의 위치 조건 + 도구별 페이지 권한(Teams 도구는 `teams_chat` 등).
6. **기록**: `assistant_usage` upsert, `action_history`에 "비서 턴"(도구 이름·모델·토큰·가린 건수, 본문 없음).

### 보존과 삭제

- `expires_at = last_message_at + 보존일`(settings `assistant_retention_days`, 기본 90).
- 매일 크론 `/api/cron/chat-purge`가 만료 대화와 첨부(버킷 객체 포함)를 지운다.
- 사용자 삭제는 즉시. 감사 로그와 사용량은 남는다.
- 저장 안 함(`ephemeral`) 대화는 목록에 안 보이고 `expires_at = last_message_at + 24시간`.

### 관리자

- `/admin/settings` 비서 카드에 보존일·허용 모델 추가(켜기·하루 상한은 기존).
- 사용량 화면: 사용자·팀별 턴·토큰·모델 비율·가린 건수(팀은 `company_directory` 이메일 조인). 본문 열람 기능은 없다.

### 실패 처리

- Claude 호출 실패 → 메시지 `failed` 저장, [다시 시도].
- 앱·데스크톱 도구 무응답(제한 시간 초과) → 결과 자리에 "앱 응답 없음"을 넣고 모델이 이어서 답한다.

## 3. 웹 채팅 화면 `/chat`, `/chat/[id]`

- 왼쪽 대화 목록(새 대화, 저장 안 함 체크, 오늘·어제·지난 7일·이전), 좁은 폭에서는 서랍.
- 상단: 모델 선택, 연결 상태 띠(서버 도구·데스크톱 앱·Microsoft·Atlassian). 데스크톱 앱이 꺼져 있으면 "아마란스 메일·결재는 데스크톱 앱이 켜져 있어야 합니다 [앱 받기]".
- 메시지: `react-markdown`(이미 설치) 렌더링, SSE 스트리밍, [중지]. 도구 호출은 접힌 칩 한 줄("메일 3통 읽음 · 아마란스(데스크톱 앱)"), 펼치면 summary.
- 쓰기 도구: 앱과 같은 확인 카드(대상·내용 미리보기, [실행]/[취소]). 웹의 쓰기는 서버 도구만.
- 빈 대화: 추천 질문 칩 4개(오늘 일정 정리, 안 읽은 메일 요약, Confluence에서 찾기, 주간보고 초안).
- 제목: 첫 질문 앞 30자 자동. 이름 바꾸기·삭제.
- 입력: Enter 전송, Shift+Enter 줄바꿈.

### 파일 첨부

- 📎 버튼·끌어 놓기·붙여 넣기. 메시지당 5개, 파일당 10MB.
- 문서(docx·pdf·pptx·xlsx·hwp·txt): 서버가 텍스트 추출(이노봇 SharePoint 읽기 코드 재사용, pptx는 ppt-service `/extract`) → 마스킹 → 전송.
- 이미지, 텍스트가 비어 있는 PDF: 원본 블록으로 전송, "이미지 안의 개인정보는 가려지지 않습니다" 안내.
- 이어지는 턴에서는 서버가 버킷에서 다시 읽어 넘긴다. 보존·삭제는 대화를 따른다.

## 4. 홈과 정보구조

### 웹 홈(위에서 아래로)

1. `DesktopAppCard`(조건부, 기존) → `DailyGreeting` → 큰 채팅 입력창("무엇을 도와드릴까요?", 📎, 모델 선택). 보내면 새 대화를 만들고 `/chat/<id>`로 이동.
2. 추천 질문 칩, 최근 대화 3개.
3. 업무 현황: Teams 답장 대기·Jira·Confluence 멘션·SharePoint 카드(기존 컴포넌트) 한 줄.
4. 바로가기: 기존 큰 카드 묶음을 작은 아이콘 격자로, 업무 → AI → 일상 순.

### 메뉴

- `PAGES`에 `{ key: "assistant", href: "/chat", label: "이노봇", group: "ai", minRole: "user" }`를 AI 그룹 맨 앞에.
- 상단 바에 항상 보이는 "이노봇" 버튼.
- AI 그룹 사용량 페이지 이름을 "Claude Code 사용량"처럼 뜻이 드러나게.

### 앱

- 이노봇이 새 API(`/api/chat/*`)를 쓰도록 옮긴다. 대화는 서버에서 이어진다(앱 메모리 `assistant_session.dart`는 화면 상태만).
- 이노봇 시트 위쪽에 🕘 기록 버튼 → 서버 대화 목록. 웹에서 시작한 대화를 앱에서 이어 갈 수 있다.
- 하단 바·이노봇 버튼은 그대로.

### 문서

- 매뉴얼 `lib/manual/sections.ts`에 이노봇 채팅 절.
- `CLAUDE.md` 페이지·API·테이블 목록, 런북 `docs/mobile-app.md` §비서 갱신.

## 5. 테스트

- 단위(vitest): 마스킹(각 유형 양성·음성, 조직도 예외), 상한 계산, 도구 목록 계산(위치·연결·권한 조합), SSE 파서, 보존 만료일 계산, 첨부 추출 분기.
- 컴포넌트: 도구 칩 상태 변화, 확인 카드, 마스킹 배지.
- E2E(Playwright) 1개: 새 대화 → 답변 → 목록에 보임 → 삭제.
- 앱(flutter test): 새 API 클라이언트, 기록 목록, 앱 도구 결과 회신.

## 6. 위험과 대응

- **도구 결과를 저장하지 않아 이어지는 질문의 맥락이 약해짐** → summary를 충분히 구체적으로 만들고, 모델이 필요하면 다시 부르게 한다.
- **계좌 마스킹 오탐·미탐** → 하이픈 형식만 잡는 보수적 규칙. 오탐 사례가 나오면 규칙을 고친다.
- **Vercel 함수 시간 제한과 긴 스트림** → 서버 도구 루프 최대 3회, 함수 `maxDuration` 설정.
- **앱 이전 중 두 API 공존** → 기존 무상태 API는 앱 이전 릴리스가 퍼진 뒤 제거.
