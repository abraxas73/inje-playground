# Microsoft Teams 연동 가이드 (Dooray 대체 선택)

앱은 세 축(채널 알림 A · 멤버 가져오기 B · 개인 DM C)마다 Dooray ↔ Teams provider를 관리자 설정에서 선택한다.
기본값은 Dooray. 설계: `docs/superpowers/specs/2026-08-20-teams-integration-provider-design.md`.

## 1. 관리자 설정 (앱 > 관리 > 시스템 설정)

| 카드 | 키 | 값 |
|---|---|---|
| 연동 채널 선택 | `notify_provider` / `member_source_provider` / `dm_provider` | `dooray` 또는 `teams` (축별 독립) |
| Microsoft Teams | `teams_notify_webhook_url` | A. 채널 게시 워크플로 HTTP POST URL |
| | `teams_dm_webhook_url` | C. 개인 DM 워크플로 HTTP POST URL |
| | `teams_members_webhook_url` | B(대안). Power Automate 멤버 목록 흐름 HTTP POST URL — 설정되면 Graph 대신 사용(§3-B) |
| | `teams_tenant_id` | Entra 테넌트 ID |
| | `teams_graph_client_id` | Graph 앱(클라이언트) ID |
| | `teams_group_id` | 멤버를 가져올 팀의 Microsoft 365 그룹 ID |

**환경변수(서버 전용·비밀, Graph 방식일 때만)**: `TEAMS_GRAPH_CLIENT_SECRET` — 로컬 `frontend/.env.local`, 운영 Vercel Environment Variables. settings 테이블에 저장하지 않는다. §3-B 웹훅 방식을 쓰면 불필요.

권장 조합: 멤버(B)와 DM(C)은 같은 provider로. `member=dooray + dm=teams`면 Dooray 멤버에 이메일이 없어 점심 DM을 보낼 수 없다(가이드 답변 DM은 로그인 이메일이라 무관).

## 2. Power Automate 워크플로 2개

### 2.1 A. 채널 알림 — "When an HTTP request is received" → "Post message in a chat or channel"
- 트리거 요청 본문 JSON 스키마:
  ```json
  {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "text":  { "type": "string" },
      "html":  { "type": "string" }
    },
    "required": ["title", "text"]
  }
  ```
- 게시 단계: Post as = Flow bot, Post in = Channel, Team/Channel 선택, Message = `@{triggerBody()?['html']}` (HTML 본문; 마크다운 카드를 쓰려면 `text`).
- 저장 후 생성되는 **HTTP POST URL**을 `teams_notify_webhook_url`에 입력.
- 앱이 보내는 본문 예: `{"title":"팀 구성 결과","text":"👥 팀 구성 결과\n\n**1팀** (2명): 홍길동(법카), 김철수","html":"👥 팀 구성 결과<br><br><b>1팀</b> (2명): 홍길동(법카), 김철수"}`

### 2.2 C. 개인 DM — "When an HTTP request is received" → "Post message in a chat or channel"
- 스키마:
  ```json
  {
    "type": "object",
    "properties": {
      "recipientEmail": { "type": "string" },
      "text": { "type": "string" },
      "html": { "type": "string" }
    },
    "required": ["recipientEmail", "text"]
  }
  ```
- 게시 단계: Post as = Flow bot, Post in = Chat with Flow bot, Recipient = `@{triggerBody()?['recipientEmail']}`, Message = `@{triggerBody()?['html']}`.
- URL을 `teams_dm_webhook_url`에 입력.
- 라이선스: Teams 커넥터/HTTP 트리거가 프리미엄으로 분류될 수 있음 — 조직 Power Automate 라이선스 확인.

### 2.3 테스트
```bash
curl -X POST "$TEAMS_NOTIFY_WEBHOOK_URL" -H "Content-Type: application/json" \
  -d '{"title":"테스트","text":"**굵게** 줄1\n줄2","html":"<b>굵게</b> 줄1<br>줄2"}'
```
202 Accepted면 정상.

## 3. 멤버 가져오기 — 방식 A: Microsoft Graph (앱 권한, 테넌트 관리자 동의 필요)

> Graph **애플리케이션 권한**의 테넌트 동의는 Privileged Role Administrator/Global Administrator만 할 수 있다(Application Administrator·앱 소유자 불가). 동의를 받을 수 없으면 §3-B 웹훅 방식을 쓴다. `teams_members_webhook_url`이 설정돼 있으면 앱은 항상 웹훅을 우선한다.

1. Entra 관리 센터 > 앱 등록 > (Supabase Azure 로그인에 쓰는 앱 재사용) > API 권한 > **Microsoft Graph > 애플리케이션 권한 > `GroupMember.Read.All`** 추가 > **관리자 동의 부여**.
2. 인증서 및 암호 > 새 클라이언트 암호 → 값(한 번만 표시)을 `TEAMS_GRAPH_CLIENT_SECRET`에 저장.
3. Teams 팀의 그룹 ID: Teams 관리 센터 > 팀 > 해당 팀 > 그룹 ID, 또는 Graph Explorer `GET /groups?$filter=displayName eq '팀이름'&$select=id`.
4. 앱이 호출하는 API:
   - `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (client_credentials, scope `https://graph.microsoft.com/.default`) — 토큰은 서버 메모리 캐시(만료 60초 전 갱신)
   - `GET https://graph.microsoft.com/v1.0/groups/{groupId}/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName&$top=999` (+ `@odata.nextLink`)
   - 이메일 = `mail` → 없으면 `userPrincipalName`
5. 확인: 로그인 상태에서 `GET /api/teams/members` → `{ members: [{id, name, email}], source: "graph" }`. `502` 응답 본문에 `Authorization_RequestDenied`(Graph 403)가 보이면 관리자 동의 누락.

## 3-B. 멤버 가져오기 — 방식 B: Power Automate 멤버 목록 흐름 (관리자 동의 불필요)

흐름 소유자(관리자 본인)의 위임 권한으로 Office 365 Groups 커넥터가 구성원을 조회하므로 Entra 앱 권한·시크릿이 필요 없다. 채널/DM 흐름과 같은 HTTP 트리거를 쓴다.

1. Power Automate → 만들기 → 인스턴트 클라우드 흐름 → 트리거 **"HTTP 요청을 받은 경우"**. 요청 본문 JSON 스키마:
   ```json
   { "type": "object", "properties": { "groupId": { "type": "string" } } }
   ```
   "흐름을 트리거할 수 있는 사용자" = 누구나(URL에 서명 포함).
2. 새 단계 → **Office 365 Groups → "그룹 구성원 나열"**(List group members): Group Id = 드롭다운에서 팀의 그룹 선택(또는 식 `@{triggerBody()?['groupId']}`로 앱 설정 `teams_group_id`를 그대로 사용), Top = `999`. 구성원이 1,000명을 넘으면 작업 설정에서 **페이지네이션** 켜기.
3. 새 단계 → **"응답"**(Response): 상태 코드 `200`, 헤더 `Content-Type: application/json`, 본문 = 동적 콘텐츠에서 "그룹 구성원 나열"의 **body** 선택(식 `@{body('그룹_구성원_나열')}`). 가공 불필요 — 커넥터 출력 `{"value":[{"id","displayName","mail","userPrincipalName",…}]}`을 그대로 돌려주면 된다.
4. 저장 → 트리거의 **HTTP POST URL**을 `teams_members_webhook_url`에 입력.

- 앱이 보내는 요청: `POST <URL>` 본문 `{"groupId":"<teams_group_id>"}`.
- 앱이 받는 응답: `{"value":[…]}`(권장) 또는 `{"members":[{"id","name","email"}]}`/배열. 이름 없는 항목 제외, 이메일 = `mail` → `userPrincipalName` 폴백, 이름순 정렬.
- 테스트:
  ```bash
  curl -s -X POST "$TEAMS_MEMBERS_WEBHOOK_URL" -H "Content-Type: application/json" -d '{"groupId":"<그룹ID>"}' | head -c 600
  ```
  `{"value":[{"id":…,"displayName":…` 가 보이면 정상. 앱에서는 `GET /api/teams/members` → `{ members: [...], source: "webhook" }`.
- 주의: 흐름 소유자 계정의 권한으로 조회된다(소유자가 해당 팀을 볼 수 있어야 함). 소유자 퇴사·연결 만료 시 흐름이 멈추므로 가능하면 공용/서비스 계정 소유로 만든다. HTTP 트리거/응답은 Power Automate 프리미엄 기능(채널·DM 흐름과 동일 조건).

## 4. 코드 구조

| 파일 | 역할 |
|---|---|
| `frontend/src/lib/providers.ts` | provider 타입/키/파서 |
| `frontend/src/lib/notify/` | `Notifier`(채널/DM) — `dooray.ts`, `teams.ts`, 팩토리 `index.ts`, 메시지 `messages.ts` |
| `frontend/src/lib/members/` | `MemberSource`(클라이언트) — `dooray.ts`(브리지), `teams.ts`(라우트) |
| `frontend/src/lib/teams-graph.ts` | Graph app-only 토큰·그룹 멤버(서버), `normalizeGraphUsers` |
| `frontend/src/lib/teams-members-webhook.ts` | Power Automate 멤버 목록 웹훅 호출·응답 정규화(서버) |
| `frontend/src/app/api/teams/members/route.ts` | `GET` 그룹 멤버 |
| `frontend/src/hooks/useProviderSettings.ts` | 클라이언트 provider 조회 |
| `frontend/src/components/settings/ProviderSettings.tsx`, `TeamsSettings.tsx` | 관리자 UI |

## 5. 알려진 제약
- Teams 멤버 import는 `user_members`에 이름만 저장한다(`dooray_member_id`는 null). 재-DM 식별은 점심 모달이 Graph에서 이메일을 다시 읽어 해결한다.
- 가이드 답변 DM(Teams)은 로그인 이메일로 간다 — 개인 설정의 "Dooray 본인 선택"은 Dooray DM에만 쓰인다.
- `GET /api/settings`는 비admin에게 웹훅 URL을 숨긴다. `dooray_token`은 브라우저 확장 브리지 때문에 계속 노출된다(기존과 동일).
