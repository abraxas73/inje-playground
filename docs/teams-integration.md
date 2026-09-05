# Microsoft Teams 연동 가이드 (Dooray 대체 선택)

앱은 세 축(채널 알림 A · 멤버 가져오기 B · 개인 DM C)마다 Dooray ↔ Teams provider를 관리자 설정에서 선택한다.
기본값은 Dooray. 설계: `docs/superpowers/specs/2026-08-20-teams-integration-provider-design.md`.

## 1. 관리자 설정 (앱 > 관리 > 시스템 설정)

| 카드 | 키 | 값 |
|---|---|---|
| 연동 채널 선택 | `notify_provider` / `dm_provider` | `dooray` 또는 `teams` (축별 독립) |
| | `member_source_provider` | `dooray` / `users`(앱 사용자 명단, 권장) / `teams`(Graph 또는 멤버 목록 웹훅) |
| Microsoft Teams | `teams_notify_webhook_url` | A. 채널 게시 워크플로 HTTP POST URL |
| | `teams_dm_webhook_url` | C. 개인 DM 워크플로 HTTP POST URL |
| | `teams_members_webhook_url` | B(대안). Power Automate 멤버 목록 흐름 HTTP POST URL — 설정되면 Graph 대신 사용(§3-B) |
| | `teams_tenant_id` | Entra 테넌트 ID |
| | `teams_graph_client_id` | Graph 앱(클라이언트) ID |
| | `teams_group_id` | 멤버를 가져올 팀의 Microsoft 365 그룹 ID |

**환경변수(서버 전용·비밀, Graph 방식일 때만)**: `TEAMS_GRAPH_CLIENT_SECRET` — 로컬 `frontend/.env.local`, 운영 Vercel Environment Variables. settings 테이블에 저장하지 않는다. §3-B 웹훅 방식을 쓰면 불필요 — 단, RFP 분석 SharePoint 업로드(§3-C 위임 OAuth)를 쓰면 다시 필수이고 `MS_TOKEN_ENC_KEY`(64자 hex)도 함께 둔다.

권장 조합: `dm=teams`이면 멤버 소스는 `users` 또는 `teams`(이메일 보유), `dm=dooray`이면 멤버 소스는 `dooray`(멤버 ID 보유). 어긋나면 점심 DM을 보낼 수 없다(가이드 답변 DM은 로그인 이메일이라 무관). **표준 라이선스 기본 구성: notify=teams, member=users, dm=teams.**

## 2. 알림·DM 흐름 (표준 라이선스 — Teams 웹후크 트리거)

Power Automate의 **"HTTP 요청을 받은 경우" 트리거와 "응답" 작업은 프리미엄**이라 M365 기본 라이선스로는 쓸 수 없다. 대신 Microsoft Teams 커넥터(표준)의 **"Teams 웹후크 요청을 받은 경우"(When a Teams webhook request is received)** 트리거를 쓴다(Office 365 Incoming Webhook의 공식 후속). 이 트리거는 본문으로 **Adaptive Card 봉투**만 받으므로 앱은 아래 형식으로 보낸다.

앱이 보내는 본문(채널 알림):
```json
{ "type": "message",
  "attachments": [{ "contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": null,
    "content": { "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.4",
      "msteams": { "width": "Full" },
      "body": [
        { "type": "TextBlock", "text": "팀 구성 결과", "weight": "Bolder", "size": "Medium", "wrap": true },
        { "type": "TextBlock", "text": "👥 팀 구성 결과\n\n**1팀** (2명): 홍길동(법카), 김철수", "wrap": true } ] } } ] }
```
개인 DM은 `body[0]`이 숨김 수신자 블록 `{ "type": "TextBlock", "id": "recipientEmail", "text": "<수신자 이메일>", "isVisible": false }`, `body[1]`이 본문이다(흐름이 고정 위치로 읽음).

### 2.1 A. 채널 알림 — Teams 워크플로 템플릿(가장 쉬움)
1. Teams → 알림 받을 **채널** 이름 옆 `…` → **워크플로** → 템플릿 **"웹후크 요청을 받으면 채널에 게시"**(Post to a channel when a webhook request is received) 선택.
2. 이름 확인 → 다음 → 팀/채널 확인 → **워크플로 추가**.
3. 표시되는 **웹후크 URL**을 복사해 `teams_notify_webhook_url`에 입력.
- Power Automate에서 직접 만들 경우: 트리거 "Teams 웹후크 요청을 받은 경우"(흐름을 트리거할 수 있는 사용자 = **누구나**) → Microsoft Teams "**채팅 또는 채널에 적응형 카드 게시**": 게시자 Flow bot, 게시 위치 Channel, 팀/채널 선택, 적응형 카드 = 식 `triggerBody()?['attachments'][0]['content']`.

### 2.2 C. 개인 DM — Power Automate(표준 트리거·작업만)
1. https://make.powerautomate.com → 만들기 → **자동화된 클라우드 흐름** → 트리거 검색 `웹후크` → **"Teams 웹후크 요청을 받은 경우"** 선택 → 만들기.
2. 트리거 카드: "흐름을 트리거할 수 있는 사용자" = **누구나**(앱 서버는 테넌트 토큰이 없음; URL 자체에 서명 포함).
3. 새 단계 → Microsoft Teams → **"채팅 또는 채널에 적응형 카드 게시"**:
   - 게시자 = **Flow bot**, 게시 위치 = **Chat with Flow bot**
   - 받는 사람 = 식(fx) `triggerBody()?['attachments'][0]['content']['body'][0]['text']`
   - 적응형 카드 = 식(fx) `triggerBody()?['attachments'][0]['content']`
4. 저장 → 트리거 카드를 다시 열어 **HTTP POST URL** 복사 → `teams_dm_webhook_url`.
- 숨김 TextBlock(`isVisible:false`)은 카드에 표시되지 않는다. 수신자는 같은 테넌트 사용자여야 한다.

### 2.3 테스트
```bash
# A 채널
curl -i -X POST "$TEAMS_NOTIFY_WEBHOOK_URL" -H "Content-Type: application/json" -d '{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","contentUrl":null,"content":{"$schema":"http://adaptivecards.io/schemas/adaptive-card.json","type":"AdaptiveCard","version":"1.4","body":[{"type":"TextBlock","text":"테스트","weight":"Bolder","size":"Medium","wrap":true},{"type":"TextBlock","text":"**굵게** 줄1\n\n줄2","wrap":true}]}}]}'
# C DM (본인 이메일)
curl -i -X POST "$TEAMS_DM_WEBHOOK_URL" -H "Content-Type: application/json" -d '{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","contentUrl":null,"content":{"$schema":"http://adaptivecards.io/schemas/adaptive-card.json","type":"AdaptiveCard","version":"1.4","body":[{"type":"TextBlock","id":"recipientEmail","text":"본인@innogrid.com","isVisible":false},{"type":"TextBlock","text":"DM 테스트","wrap":true}]}}]}'
```
`202 Accepted` + Teams에 카드가 뜨면 정상. 실패 시 Power Automate → 내 흐름 → 실행 기록에서 빨간 단계의 오류를 확인.

## 3. 멤버 가져오기 — 소스 선택

| `member_source_provider` | 방식 | 필요 조건 |
|---|---|---|
| `users` (**권장**) | 앱 사용자 명단 — `user_profiles`에서 역할이 guest가 아닌 구성원(`GET /api/members/users`) | 없음 |
| `teams` + `teams_members_webhook_url` | Power Automate 멤버 목록 흐름(§3-B) | Power Automate **프리미엄** |
| `teams` (웹훅 URL 비움) | Microsoft Graph app-only(§3-A) | Graph 앱 권한 **테넌트 관리자 동의** + env 시크릿 |

### 3.1 앱 사용자 명단(`users`)
- 이 앱에 한 번이라도 로그인한 구성원이 역할 `user`/`admin`이면 포함된다(신규 인원은 첫 로그인 후 등장). 이름은 로그인 프로필 표시명, 없으면 이메일 로컬파트. 이메일을 항상 가지므로 Teams DM과 조합 가능.
- 명단 관리: 관리자 > 사용자 관리에서 역할을 `guest`로 바꾸면 제외된다.
- 외부 연동·라이선스·관리자 동의가 전혀 필요 없다. Dooray 멤버 ID는 없으므로 `dm_provider=dooray`와는 조합 불가(관리자 화면 경고).

### 3.2 내 팀 구성 (개인별 명단, 2026-08-21 추가)
- 멤버 소스는 "후보 명단"일 뿐이고, **누가 내 팀인지는 각 사용자가 직접 고른다**. 저장소는 기존 `user_members`(사용자별)에 `email`, `external_id` 칼럼을 추가해 사용.
- 진입점: `/settings` "내 팀 구성원" 카드의 **구성원 선택**, 또는 `/ladder`·`/team`의 **"내 팀 구성원 선택"** 버튼(Dooray 외 소스일 때). 모달에서 검색·체크·"직접 추가(이름+이메일)" 후 저장 → 기존 목록 교체(법카 표시는 이름 기준 보존).
- **Teams 이메일 수정**: 앱 사용자 명단의 이메일은 *로그인 계정*이라 Google 로그인 사용자는 gmail 등 개인 메일일 수 있다(Teams DM 불가, 모달에 "개인 메일" 경고). 행의 이메일(연필)을 눌러 회사 Teams 이메일로 덮어쓰면 `user_members.email`에 저장되고, 재진입 시 `external_id`로 같은 사람에 매칭되어 덮어쓴 값이 복원된다.
- 사용처: `/ladder`·`/team`의 "내 구성원" 버튼, `/food` 구성원 선택은 **내 팀이 기본 목록**(전체 명단 보기 토글). 점심 DM 수신자는 `user_members.email`.
- Dooray 모드는 기존 동작 그대로("Dooray에서 가져오기" = 프로젝트 전체 교체).
- DB 마이그레이션: `alter table public.user_members add column if not exists email text, add column if not exists external_id text;`

## 3-A. 멤버 가져오기 — Microsoft Graph (앱 권한, 테넌트 관리자 동의 필요)

> Graph **애플리케이션 권한**의 테넌트 동의는 Privileged Role Administrator/Global Administrator만 할 수 있다(Application Administrator·Cloud Application Administrator·앱 소유자 불가; 관리자 동의 요청 워크플로의 "검토자"로 지정돼도 Graph 앱 권한은 GA만 승인 가능). 동의를 받을 수 없으면 §3-B 웹훅 방식 또는 §3.1 `users`를 쓴다. `teams_members_webhook_url`이 설정돼 있으면 앱은 항상 웹훅을 우선한다.

### 3-A.0 관리자 동의 받는 프로세스 (앱 소유자가 GA에게 1클릭 요청)

역할을 올려 받는 것보다 GA가 한 번 클릭해 주는 것이 정석이다.

1. **사전(앱 소유자)**: Entra 관리 센터 > 앱 등록 > 해당 앱 > 개요에서 테넌트 ID·클라이언트 ID 확인. API 권한에 `GroupMember.Read.All`(애플리케이션)이 추가돼 있고 상태가 "동의 필요"인지 확인.
2. **관리자(GA/PRA)**: 같은 앱의 API 권한 화면에서 **"<조직>에 대한 관리자 동의 부여"** 클릭 → 상태가 초록 체크로 변경. 또는 관리자 브라우저에서 `https://login.microsoftonline.com/<테넌트ID>/adminconsent?client_id=<클라이언트ID>` 열고 "수락".
3. **사후(앱 소유자)**: 위 §3-A 2번부터 진행(클라이언트 암호 → env → 설정 → 확인).

관리자에게 보낼 요청문 템플릿:

> 제목: 워크샵 앱 Entra 앱 등록에 Graph 애플리케이션 권한 1건 관리자 동의 요청
>
> 앱: *(앱 이름)* / 클라이언트 ID: `<클라이언트ID>` / 소유자: seunguk.kang@innogrid.com
> 권한: Microsoft Graph → 애플리케이션 권한 → **GroupMember.Read.All** (읽기 전용: 그룹 구성원 목록)
> 용도: 사내 워크샵 앱(사다리/팀 나누기/점심)의 구성원 목록을 Dooray 대신 지정한 Teams 팀 1개의 구성원(이름·이메일)으로 자동 동기화. 서버에서만 호출하며 쓰기 권한·메일·파일 접근 없음. 시크릿은 Vercel 환경변수에만 저장.
> 조치: Entra 관리 센터 → 앱 등록 → 해당 앱 → API 권한 → "관리자 동의 부여" 클릭(1분 소요). 또는 `https://login.microsoftonline.com/<테넌트ID>/adminconsent?client_id=<클라이언트ID>` 접속 후 "수락".

- `GroupMember.Read.All`은 테넌트 전체 그룹의 구성원을 읽을 수 있는 권한이라 거부될 수 있다. 최소 권한 대안은 Teams 앱 RSC(`TeamMember.Read.Group`, 특정 팀 1개 한정·팀 소유자 동의)지만 Teams 앱 매니페스트 패키징이 필요해 별도 작업이다. 동의를 못 받는 동안은 §3.1 `users` + 내 팀 구성(이메일 수정)으로 운영한다.

1. Entra 관리 센터 > 앱 등록 > (Supabase Azure 로그인에 쓰는 앱 재사용) > API 권한 > **Microsoft Graph > 애플리케이션 권한 > `GroupMember.Read.All`** 추가 > **관리자 동의 부여**.
2. 인증서 및 암호 > 새 클라이언트 암호 → 값(한 번만 표시)을 `TEAMS_GRAPH_CLIENT_SECRET`에 저장.
3. Teams 팀의 그룹 ID: Teams 관리 센터 > 팀 > 해당 팀 > 그룹 ID, 또는 Graph Explorer `GET /groups?$filter=displayName eq '팀이름'&$select=id`.
4. 앱이 호출하는 API:
   - `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (client_credentials, scope `https://graph.microsoft.com/.default`) — 토큰은 서버 메모리 캐시(만료 60초 전 갱신)
   - `GET https://graph.microsoft.com/v1.0/groups/{groupId}/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName&$top=999` (+ `@odata.nextLink`)
   - 이메일 = `mail` → 없으면 `userPrincipalName`
5. 확인: 로그인 상태에서 `GET /api/teams/members` → `{ members: [{id, name, email}], source: "graph" }`. `502` 응답 본문에 `Authorization_RequestDenied`(Graph 403)가 보이면 관리자 동의 누락.

## 3-B. 멤버 가져오기 — Power Automate 멤버 목록 흐름 (관리자 동의 불필요, **프리미엄 라이선스 필요**)

흐름 소유자(관리자 본인)의 위임 권한으로 Office 365 Groups 커넥터가 구성원을 조회하므로 Entra 앱 권한·시크릿이 필요 없다. 단, "HTTP 요청을 받은 경우" 트리거와 "응답" 작업이 **프리미엄**이라 M365 기본 라이선스로는 만들 수 없다(그 경우 §3.1 `users` 사용).

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
- **잘린 응답 거부**: 응답에 `@odata.nextLink`가 있으면(Top 미설정·페이지네이션 꺼짐으로 일부만 반환) 앱은 목록을 쓰지 않고 `502 "Teams 멤버 웹훅 응답이 잘렸습니다…"`를 돌려준다 → 2단계의 Top=999·페이지네이션을 확인.
- 테스트:
  ```bash
  curl -s -X POST "$TEAMS_MEMBERS_WEBHOOK_URL" -H "Content-Type: application/json" -d '{"groupId":"<그룹ID>"}' | head -c 600
  ```
  `{"value":[{"id":…,"displayName":…` 가 보이면 정상. 앱에서는 `GET /api/teams/members` → `{ members: [...], source: "webhook" }`.
- 주의: 흐름 소유자 계정의 권한으로 조회된다(소유자가 해당 팀을 볼 수 있어야 함). 소유자 퇴사·연결 만료 시 흐름이 멈추므로 가능하면 공용/서비스 계정 소유로 만든다. HTTP 트리거/응답은 Power Automate 프리미엄 기능(채널·DM 흐름과 동일 조건).

## 3-C. RFP 분석 SharePoint 업로드 — Microsoft Graph 위임 권한 (관리자 동의 불필요)

> 3-A의 앱 권한과 달리 **위임된 권한**은 사용자가 스스로 동의한다. 테넌트가 사용자 동의를 막아 "관리자 승인 필요"가 뜨더라도 Application Administrator가 동의할 수 있다(GA 불필요). 설계: `docs/superpowers/specs/2026-09-05-rfp-analyzer-phase3-design.md`, 런북: `docs/rfp-analyzer.md`.

1. Entra 앱 등록(3-A와 같은 앱) → 인증 → 플랫폼 "웹" 리디렉션 URI 추가: `https://inje-playground.vercel.app/api/ms/callback`, `http://localhost:3003/api/ms/callback` (다른 도메인을 쓰면 env `MS_ALLOWED_ORIGINS`에도 추가).
2. API 권한 → Microsoft Graph → **위임된 권한** → `Files.ReadWrite.All`, `Sites.Read.All`, `User.Read`, `offline_access` 추가. "관리자 동의 부여"는 누르지 않아도 된다.
3. 인증서 및 암호 → 클라이언트 암호(없으면 새로) → `TEAMS_GRAPH_CLIENT_SECRET`. `openssl rand -hex 32` → `MS_TOKEN_ENC_KEY`. 둘 다 Vercel env(+로컬 `.env.local`), settings에는 저장하지 않는다.
4. settings `teams_tenant_id`·`teams_graph_client_id`는 3-A와 공용.
5. 흐름: `/settings` "Microsoft 계정 연결" → `GET /api/ms/connect`(state HMAC 서명·10분) → `login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` → `GET /api/ms/callback`(state 검증·세션 사용자 일치 → 코드 교환 → `GET /me` → refresh 토큰 AES-256-GCM 암호화 → `ms_connections` upsert) → `returnTo?ms_connected=1`. 업로드 때마다 refresh로 access 토큰(서버 메모리 5분 캐시) → `GET /shares/{u!base64url(폴더 링크)}/driveItem`, `PUT /drives/{driveId}/items/{itemId}:/{파일명}:/content?@microsoft.graph.conflictBehavior=replace`(4MiB 이상은 `createUploadSession` + 10MiB 청크).
6. 확인: 연결 후 `GET /api/ms/connection` → `{connected:true, accountUpn, …}`(토큰 없음). 업로드 실패 502 로그의 `request-id`로 Microsoft 지원 문의. `invalid_grant`가 `ms_connections.last_error`에 남으면 사용자가 "다시 연결".

## 4. 코드 구조

| 파일 | 역할 |
|---|---|
| `frontend/src/lib/providers.ts` | provider 타입/키/파서 |
| `frontend/src/lib/notify/` | `Notifier`(채널/DM) — `dooray.ts`, `teams.ts`, 팩토리 `index.ts`, 메시지 `messages.ts` |
| `frontend/src/lib/members/` | `MemberSource`(클라이언트) — `dooray.ts`(브리지), `teams.ts`(라우트), `users.ts`(앱 사용자 명단) |
| `frontend/src/app/api/members/users/route.ts` | `GET` 앱 사용자 명단(user_profiles, guest 제외) |
| `frontend/src/lib/my-team.ts`, `components/shared/MyTeamPicker.tsx`, `components/settings/MyTeamCard.tsx` | 내 팀 구성(개인별 user_members 선택/수동 추가) |
| `frontend/src/lib/teams-graph.ts` | Graph app-only 토큰·그룹 멤버(서버), `normalizeGraphUsers` |
| `frontend/src/lib/teams-members-webhook.ts` | Power Automate 멤버 목록 웹훅 호출·응답 정규화(서버) |
| `frontend/src/app/api/teams/members/route.ts` | `GET` 그룹 멤버 |
| `frontend/src/hooks/useProviderSettings.ts` | 클라이언트 provider 조회 |
| `frontend/src/components/settings/ProviderSettings.tsx`, `TeamsSettings.tsx` | 관리자 UI |
| `frontend/src/lib/ms/` | 3-C 위임 OAuth — `crypto.ts`(AES-GCM·HMAC state), `oauth.ts`(authorize·토큰 교환/갱신·/me), `config.ts`(settings+env), `origin.ts`(리디렉션 오리진·returnTo), `connections.ts`(ms_connections·access 토큰 캐시), `graph-drive.ts`(shares 해석·업로드) |
| `frontend/src/app/api/ms/{connect,callback,connection}/route.ts` | 연결 시작·콜백·상태/해제 |
| `frontend/src/lib/rfp/sharepoint.ts`, `app/api/rfp/projects/[id]/sharepoint/**` | RFP xlsx SharePoint 업로드·폴더 지정·이력(런북 `docs/rfp-analyzer.md`) |
| `frontend/src/components/settings/MicrosoftAccountCard.tsx`, `components/rfp/SharePointSection.tsx`, `hooks/useMsCallbackQuery.ts` | 개인 설정 카드·상세 섹션·콜백 쿼리 처리 |

## 5. 알려진 제약
- Teams 멤버 import는 `user_members`에 이름만 저장한다(`dooray_member_id`는 null). 재-DM 식별은 점심 모달이 Graph에서 이메일을 다시 읽어 해결한다.
- 가이드 답변 DM(Teams)은 로그인 이메일로 간다 — 개인 설정의 "Dooray 본인 선택"은 Dooray DM에만 쓰인다.
- `GET /api/settings`는 비admin에게 웹훅 URL을 숨긴다. `dooray_token`은 브라우저 확장 브리지 때문에 계속 노출된다(기존과 동일).
