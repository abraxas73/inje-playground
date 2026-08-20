# Teams 연동 (Dooray 대체 선택) 설계

- 작성일: 2026-08-20
- 상태: 구현 완료 (계획: docs/superpowers/plans/2026-08-20-teams-integration-provider.md)
- 관련: `2026-08-08-innogrid-rebranding-gw-login-design.md` (MS/Entra 로그인 — 본 작업의 Entra 앱을 재활용)

## 1. 배경 · 목표

앱은 현재 Dooray(두레이)에 세 가지로 결합되어 있다: (A) 채널 알림, (B) 멤버 데이터 소스, (C) 개인 1:1 DM. 조직이 Microsoft Teams 중심으로 이동함에 따라, **관리자가 각 축마다 Dooray ↔ Teams 중 활성 provider를 선택**할 수 있게 한다. Dooray는 제거하지 않고 기본값으로 유지하며, Teams를 선택 가능한 대안으로 추가한다.

### 목표
- 관리자 전역 설정으로 축별(A/B/C) provider를 선택.
- Dooray 기존 동작을 100% 보존(회귀 없음).
- Teams 도달 방식: **하이브리드** — 멤버(B)는 Microsoft Graph(app-only), 알림(A)·DM(C)은 Power Automate 워크플로 웹훅.

### 비목표 (이번 범위 아님)
- Dooray 연동 제거/마이그레이션.
- 사용자별(per-user) provider 선택. (전역 선택만; 필요 시 후속)
- 기존 멤버 캐시(`dooray_members`/`user_members`) 데이터 이관.
- MS 로그인 자체(별도 완료된 작업).

## 2. 확정된 결정

| 항목 | 결정 |
|---|---|
| 범위 | A(채널 알림) + B(멤버 가져오기) + C(개인 DM) 전부 |
| 선택 모델 | 관리자 전역, **축별** provider 스위치 |
| A 채널 알림 | Power Automate 웹훅 |
| B 멤버 소스 | Microsoft Graph, **app-only(client credentials)** + 관리자 동의 |
| C 개인 DM | Power Automate 웹훅 |
| Graph 시크릿 | **환경변수** (settings 노출 회피, 강제 규칙) |

## 3. 아키텍처: 추상화 계층

현재 Dooray는 전용 추상화 없이 문자열/URL/헤더가 여러 파일에 산재한다. 두 개의 provider 인터페이스를 세우고, provider별 구현을 팩토리로 주입한다. **메시지 조립(사람이 읽는 텍스트)은 provider 무관**하게 유지하고, 전송/페이로드만 분기한다.

### 3.1 Notifier 인터페이스 (`frontend/src/lib/notify/`)
```ts
export interface Notifier {
  sendChannel(msg: { title: string; text: string }): Promise<{ ok: boolean }>;
  sendDirect(recipient: { email?: string; memberId?: string }, msg: { text: string }): Promise<{ ok: boolean }>;
}
```
- `dooray.ts` — 기존 로직 추출: `sendChannel` = Incoming Hook URL POST(`{botName, botIconImage, text}`), `sendDirect` = `messenger/v1/channels/direct-send`(memberId 기준).
- `teams.ts` — `sendChannel` = `teams_notify_webhook_url`로 POST, `sendDirect` = `teams_dm_webhook_url`로 `{recipientEmail, text}` POST.
- `index.ts` — `getNotifier(axis: "notify" | "dm")`: settings에서 해당 provider 키를 읽어 구현 반환(서버 전용).

### 3.2 MemberSource 인터페이스 (`frontend/src/lib/members/`)
```ts
export interface Member { id: string; name: string; email?: string }
export interface MemberSource {
  listMembers(groupId?: string): Promise<Member[]>;
}
```
- `dooray.ts` — 기존 브리지/서버 조회를 래핑(`{id, name}`).
- `teams.ts` — Graph app-only로 `teams_group_id` 그룹의 멤버 조회(`{id, name, email}`).
- `index.ts` — `getMemberSource()`: settings `member_source_provider`로 구현 선택.

> 참고: 현재 서버측 `lib/dooray.ts`(410으로 봉인된 라우트용)와 브리지측 `lib/dooray-client.ts`가 공존한다. Notifier/MemberSource 추출 시 Dooray 구현은 이들을 재사용하되, 신규 인터페이스 뒤로 감춘다.

## 4. 설정(Config) 스키마

### 4.1 `settings` 테이블 (전역, admin/settings 편집) — 비밀 아님
| key | 값 | 용도 |
|---|---|---|
| `notify_provider` | `dooray`\|`teams` (기본 `dooray`) | A 채널 알림 provider |
| `member_source_provider` | `dooray`\|`teams`\|`users` | B 멤버 소스 provider (`users` = 앱 사용자 명단, 2026-08-21 추가) |
| `dm_provider` | `dooray`\|`teams` | C DM provider |
| `teams_notify_webhook_url` | URL | A용 워크플로 웹훅 |
| `teams_dm_webhook_url` | URL | C용 워크플로 웹훅 |
| `teams_members_webhook_url` | URL | (2026-08-21 추가) B 대안 — Power Automate 멤버 목록 흐름 웹훅. 설정 시 Graph보다 우선 |
| `teams_graph_client_id` | GUID | B Graph 앱 client id |
| `teams_tenant_id` | GUID | B Graph 테넌트 id |
| `teams_group_id` | GUID | B 멤버를 가져올 대상 팀/그룹(= Dooray project_id 대응) |

### 4.2 환경변수 (서버 전용·비밀)
| 이름 | 용도 |
|---|---|
| `TEAMS_GRAPH_CLIENT_SECRET` | Graph app-only 클라이언트 시크릿 |

`settings` GET(`api/settings/route.ts`)은 모든 key/value를 인증 사용자에게 반환하므로, **진짜 크리덴셜(Graph client secret)은 절대 settings에 저장하지 않는다.** 오직 env로만 서버에서 읽는다.

## 5. 축별 상세 설계

### 5.1 A. 채널 알림 (Teams = 웹훅)
- 대상 라우트: `api/team-notify/route.ts`, `api/food/decide/route.ts`(채널 발송부).
- 변경: 인라인 Dooray Hook POST → `getNotifier("notify").sendChannel({title, text})`.
- Teams 구현: `teams_notify_webhook_url`로 JSON POST. ~~기본 계약 `{ "title": string, "text": string }`~~ → **(2026-08-21 변경)** Power Automate "HTTP 요청을 받은 경우" 트리거가 프리미엄이라 표준 라이선스용 **Teams 웹후크 트리거**를 쓰며, 이 트리거가 요구하는 **Adaptive Card 봉투** `{type:"message", attachments:[{contentType:"application/vnd.microsoft.card.adaptive", content:{…body:[제목, 본문]}}]}`를 보낸다. 관리자는 Teams 워크플로 템플릿 "웹후크 요청을 받으면 채널에 게시"로 URL을 만든다.
- 관리자 준비(2026-08-21 변경): Teams에서 채널 `…` → 워크플로 → 템플릿 "웹후크 요청을 받으면 채널에 게시"로 웹후크 URL 생성 → `teams_notify_webhook_url`에 저장(표준 라이선스, 프리미엄 불필요).

### 5.2 B. 멤버 가져오기 (Teams = Graph app-only)
- 신규 서버 라우트: `GET /api/teams/members`
  - 토큰: `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (`grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default`, `client_id`=settings, `client_secret`=env). **메모리 캐시**로 만료(≈60분) 전 재사용.
  - 조회: `GET https://graph.microsoft.com/v1.0/groups/{teams_group_id}/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName`. `@odata.nextLink` 페이지네이션 처리. 이메일은 `mail` 없으면 `userPrincipalName` 폴백.
  - 반환: `Member[] = {id, name: displayName, email}`.
  - 권한: Entra 앱에 **`GroupMember.Read.All`(app) + 관리자 동의**. 로그인용 Entra 앱을 재활용하되 app 권한을 추가 동의.
  - **기본 대안(2026-08-21 추가, 채택)**: `member_source_provider=users` — 앱 사용자 명단(`user_profiles`에서 guest 제외)을 `GET /api/members/users`로 제공. 외부 연동·라이선스·관리자 동의 불필요, 이메일 보유로 Teams DM 가능. 제약: 로그인한 적 있는 구성원만 포함.
  - **대안(2026-08-21 추가, 프리미엄 필요)**: Graph 앱 권한의 테넌트 동의는 Privileged Role/Global Administrator만 가능해 실무상 막힐 수 있다. `teams_members_webhook_url`(Power Automate: HTTP 트리거 → Office 365 Groups "그룹 구성원 나열" → 응답)을 설정하면 `/api/teams/members`가 Graph 대신 웹훅에 `{groupId}`를 POST 하고, 커넥터 출력 `{value:[…]}`을 그대로 받아 동일한 `Member[]`로 정규화한다(웹훅 우선, 비우면 Graph). 흐름 소유자의 위임 권한으로 동작하므로 앱 등록 동의·시크릿 불필요.
- UI 변경: `DoorayImportButton`/`DoorayProjectSelect`를 provider-aware로.
  - `member_source_provider === "teams"`: 크롬 확장 브리지 대신 `/api/teams/members` 호출. 그룹은 관리자 설정(`teams_group_id`)에 고정 → **프로젝트 선택 UI 생략**, 바로 import.
  - `=== "dooray"`: 기존 브리지 흐름 유지.
- 가져온 멤버 → 기존 `user_members`/`dooray_members` 캐시 재사용(이름 기준). 외부 식별자(Teams id/email) 저장은 Phase 4의 데이터 모델 항목 참조.

### 5.3 C. 개인 DM (Teams = 웹훅)
- 대상 라우트: `api/food/decide/route.ts`(direct-send부), `api/guide/chat/route.ts`(`sendGuideDM`).
- 변경: 인라인 direct-send → `getNotifier("dm").sendDirect(recipient, {text})`.
- Teams 구현: `teams_dm_webhook_url`로 ~~`{ "recipientEmail": string, "text": string }`~~ → **(2026-08-21 변경)** 같은 Adaptive Card 봉투를 보내되 `body[0]`에 숨김 TextBlock(`id:"recipientEmail"`, `isVisible:false`)으로 수신자 이메일을 싣는다. 흐름(Teams 웹후크 트리거 → "적응형 카드 게시", Chat with Flow bot, 받는 사람 = `triggerBody()?['attachments'][0]['content']['body'][0]['text']`)이 1:1 발송.
- 수신자 식별: **이메일** 기준.
  - 가이드 답변 DM: 로그인 사용자 본인 이메일 → 항상 해석 가능.
  - 점심 DM: 선택된 멤버들의 이메일 필요 → **Teams 멤버 소스일 때 이메일 보유**.
- 관리자 준비(2026-08-21 변경): Power Automate에서 "Teams 웹후크 요청을 받은 경우"(표준) → "채팅 또는 채널에 적응형 카드 게시"(Chat with Flow bot, 받는 사람 = `triggerBody()?['attachments'][0]['content']['body'][0]['text']`) 워크플로 생성 → URL을 `teams_dm_webhook_url`에 저장.

## 6. 관리자 UI (`app/admin/settings/page.tsx`)
- provider 셀렉트 3개(`notify_provider`, `member_source_provider`, `dm_provider`).
- Teams 설정 입력폼: `teams_notify_webhook_url`, `teams_dm_webhook_url`, `teams_graph_client_id`, `teams_tenant_id`, `teams_group_id`.
- Graph client secret은 env라 UI에 없음 — "환경변수 `TEAMS_GRAPH_CLIENT_SECRET`로 설정" 안내 문구만.
- 기존 `DooraySettings` 컴포넌트와 나란히 `TeamsSettings` 컴포넌트 추가.

## 7. 보안
- **Graph client secret = 환경변수 강제.** settings 저장 금지.
- 웹훅 URL 2종은 settings 저장(기존 `dooray_hook_url`과 동일한 노출 프로필: 인증 사용자에게 GET 노출). 사내 한정·내부 신뢰 환경 가정하에 수용.
- **선택적 하드닝(권장)**: `api/settings` GET에서 민감 키(`*_webhook_url`, `dooray_hook_url`, `dooray_token`, `dooray_messenger_url`)를 응답에서 제외하고, 서버 라우트는 DB에서 직접 읽도록 분리. 이는 기존 Dooray 노출까지 함께 개선. (범위 확정 시 Phase 1에 포함)

## 8. 제약 · 수용된 트레이드오프
- **혼합 provider 한계**: 멤버 소스와 DM provider가 다르면(`member_source=dooray`+`dm_provider=teams`: Dooray 멤버에 이메일 없음 / `member_source=teams`+`dm_provider=dooray`: Teams 멤버에 Dooray 멤버 ID 없음) 점심 DM 수신자 해석 불가. → 관리자에게 "DM/멤버 provider를 맞추라" 안내. 가이드 답변 DM(로그인 이메일)은 조합과 무관하게 동작.
- **Power Automate 라이선스**: 채널/DM 게시 워크플로가 프리미엄 커넥터를 요구할 수 있음(조직 라이선스 확인 필요).
- **Graph 관리자 동의**: `GroupMember.Read.All` app 권한에 테넌트 관리자 동의 1회 필요.

## 9. 데이터 모델 고려 (Phase 4)
- `user_members.dooray_member_id`는 Dooray 전용 식별자다. Teams 멤버의 재-DM/재식별을 위해 중립 식별자(`external_id` + `provider`, 또는 `email`) 컬럼 추가를 검토. 이번 범위에서는 이름 기준 import로 충분하며, 외부 식별자 저장은 Phase 4에서 필요 시 도입.

## 10. 사전 조건 · 순서
1. **선행(사용자 지시)**: 로그인 페이지에서 GW 버튼만 제거 → main 병합 → 정리된 main 위에서 Teams 작업. (GW 백엔드 코드는 잔존, 버튼만 제거)
2. 관리자 준비물(2026-08-21 개정): Teams 워크플로 웹후크 1개(A 채널, 템플릿) + Power Automate 표준 흐름 1개(C DM) + 멤버 소스 `users` 선택. (Graph 방식은 Entra 앱 `GroupMember.Read.All` app 권한+테넌트 관리자 동의, env `TEAMS_GRAPH_CLIENT_SECRET`이 필요하나 현재 조직에서는 불가.)

## 11. 구현 단계 (Dooray 무회귀 보장하며 점진)
1. **Phase 1 — 추상화 + 설정**: Notifier/MemberSource 인터페이스·Dooray 구현 추출, provider 설정 키·admin 셀렉트 추가, (선택)settings GET 하드닝. Teams 구현은 stub. Dooray 동작 동일함을 검증.
2. **Phase 2 — A 채널 알림 Teams**: 가장 쉬움, 빠른 가치. team-notify/food 채널 발송을 Teams로 전환 가능.
3. **Phase 3 — C DM Teams**: food/guide DM을 Teams 웹훅으로.
4. **Phase 4 — B 멤버 Graph**: `/api/teams/members` + UI provider 분기 + (필요 시)데이터 모델.
