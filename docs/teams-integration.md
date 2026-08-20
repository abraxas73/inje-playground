# Microsoft Teams 연동 가이드 (Dooray 대체 선택)

앱은 세 축(채널 알림 A · 멤버 가져오기 B · 개인 DM C)마다 Dooray ↔ Teams provider를 관리자 설정에서 선택한다.
기본값은 Dooray. 설계: `docs/superpowers/specs/2026-08-20-teams-integration-provider-design.md`.

## 1. 관리자 설정 (앱 > 관리 > 시스템 설정)

| 카드 | 키 | 값 |
|---|---|---|
| 연동 채널 선택 | `notify_provider` / `member_source_provider` / `dm_provider` | `dooray` 또는 `teams` (축별 독립) |
| Microsoft Teams | `teams_notify_webhook_url` | A. 채널 게시 워크플로 HTTP POST URL |
| | `teams_dm_webhook_url` | C. 개인 DM 워크플로 HTTP POST URL |
| | `teams_tenant_id` | Entra 테넌트 ID |
| | `teams_graph_client_id` | Graph 앱(클라이언트) ID |
| | `teams_group_id` | 멤버를 가져올 팀의 Microsoft 365 그룹 ID |

**환경변수(서버 전용·비밀)**: `TEAMS_GRAPH_CLIENT_SECRET` — 로컬 `frontend/.env.local`, 운영 Vercel Environment Variables. settings 테이블에 저장하지 않는다.

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

## 3. Microsoft Graph (멤버 가져오기)

1. Entra 관리 센터 > 앱 등록 > (Supabase Azure 로그인에 쓰는 앱 재사용) > API 권한 > **Microsoft Graph > 애플리케이션 권한 > `GroupMember.Read.All`** 추가 > **관리자 동의 부여**.
2. 인증서 및 암호 > 새 클라이언트 암호 → 값(한 번만 표시)을 `TEAMS_GRAPH_CLIENT_SECRET`에 저장.
3. Teams 팀의 그룹 ID: Teams 관리 센터 > 팀 > 해당 팀 > 그룹 ID, 또는 Graph Explorer `GET /groups?$filter=displayName eq '팀이름'&$select=id`.
4. 앱이 호출하는 API:
   - `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (client_credentials, scope `https://graph.microsoft.com/.default`) — 토큰은 서버 메모리 캐시(만료 60초 전 갱신)
   - `GET https://graph.microsoft.com/v1.0/groups/{groupId}/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName&$top=999` (+ `@odata.nextLink`)
   - 이메일 = `mail` → 없으면 `userPrincipalName`
5. 확인: 로그인 상태에서 `GET /api/teams/members` → `{ members: [{id, name, email}] }`. `403 Authorization_RequestDenied`면 관리자 동의 누락.

## 4. 코드 구조

| 파일 | 역할 |
|---|---|
| `frontend/src/lib/providers.ts` | provider 타입/키/파서 |
| `frontend/src/lib/notify/` | `Notifier`(채널/DM) — `dooray.ts`, `teams.ts`, 팩토리 `index.ts`, 메시지 `messages.ts` |
| `frontend/src/lib/members/` | `MemberSource`(클라이언트) — `dooray.ts`(브리지), `teams.ts`(라우트) |
| `frontend/src/lib/teams-graph.ts` | Graph app-only 토큰·그룹 멤버(서버) |
| `frontend/src/app/api/teams/members/route.ts` | `GET` 그룹 멤버 |
| `frontend/src/hooks/useProviderSettings.ts` | 클라이언트 provider 조회 |
| `frontend/src/components/settings/ProviderSettings.tsx`, `TeamsSettings.tsx` | 관리자 UI |

## 5. 알려진 제약
- Teams 멤버 import는 `user_members`에 이름만 저장한다(`dooray_member_id`는 null). 재-DM 식별은 점심 모달이 Graph에서 이메일을 다시 읽어 해결한다.
- 가이드 답변 DM(Teams)은 로그인 이메일로 간다 — 개인 설정의 "Dooray 본인 선택"은 Dooray DM에만 쓰인다.
- `GET /api/settings`는 비admin에게 웹훅 URL을 숨긴다. `dooray_token`은 브라우저 확장 브리지 때문에 계속 노출된다(기존과 동일).
