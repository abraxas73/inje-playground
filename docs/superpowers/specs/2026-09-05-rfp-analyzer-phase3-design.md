# RFP 분석 — 3단계(SharePoint 등록) 설계

> 2026-09-05 초안. 1단계(요구사항 표·xlsx)와 2단계(솔루션 매핑)가 만든 **요구사항 검토 xlsx를 사용자가 지정한 SharePoint(Teams 팀 파일) 폴더에 올리고**, Teams 채널에 알린다. 업로드는 사용자가 연결한 Microsoft 계정의 **위임 권한**으로 실행한다(앱 권한·글로벌 관리자 동의 불필요).
> 선행 스펙: `2026-09-03-rfp-analyzer-phase1-design.md`, `2026-09-04-rfp-analyzer-phase2-design.md`. Teams 연동 런북: `docs/teams-integration.md`.

## 1. 목표와 범위

**사용자 흐름(3단계)**
1. `/settings`(또는 프로젝트 상세)에서 "Microsoft 계정 연결"을 한 번 한다. 서버가 refresh 토큰을 암호화해 저장한다.
2. `/rfp/[id]`의 SharePoint 섹션에 Teams/SharePoint에서 복사한 **폴더 링크**를 붙인다. 서버가 링크를 해석해 드라이브·폴더 id를 프로젝트에 저장한다(프로젝트 공유 설정).
3. "SharePoint에 업로드"를 누르면 서버가 xlsx 다운로드와 같은 파일을 만들어 그 폴더에 올리고, 이력을 남기고, Teams 채널(설정돼 있으면)에 링크를 알린다.
4. 상세 화면에서 마지막 업로드 파일·이력을 보고 "파일 열기"로 SharePoint를 연다.

**3단계에 포함하지 않는 것**
- 사이트·폴더 탐색 UI(링크 붙이기로 대체). 관리자 기본 폴더.
- 앱 권한(`Sites.Selected` 등) 업로드, OneDrive 개인 저장.
- 프로젝트 목록(`/rfp`) 열 추가, 업로드 자동 실행(매핑 완료 시 자동 등).
- Supabase Azure 로그인 토큰 재사용(Google 로그인 사용자가 다수라 별도 연결 흐름을 쓴다).

**브레인스토밍에서 확정한 결정**

| 결정 | 선택 |
|---|---|
| 저장 위치 | 프로젝트별로 사용자가 폴더를 지정(Teams 팀 파일 등 어디든) |
| 권한 모델 | 사용자가 Microsoft 계정을 연결(OAuth 위임, refresh 토큰 서버 저장). 앱 권한·GA 동의 불필요 |
| 폴더 지정 | 폴더 링크 붙이기 → Graph `shares` API로 해석 |
| 재업로드 | 파일명에 날짜(KST)가 있어 같은 날은 덮어쓰기(`conflictBehavior=replace`, SharePoint 버전 이력), 날짜가 다르면 새 파일 |
| 알림 | 업로드 성공 후 기존 Teams 채널 웹후크(`notify_provider=teams`)로 링크 알림. 실패해도 업로드는 성공 |

## 2. 아키텍처

```
/settings 'Microsoft 계정' 카드 ──GET /api/ms/connect?returnTo=/settings──▶ 302 login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
   ◀── /api/ms/callback?code&state ── state 검증 → code→token 교환 → GET /me → ms_connections upsert(refresh 암호화) → 302 returnTo
   GET/DELETE /api/ms/connection ── 상태 조회·해제

/rfp/[id] 'SharePoint' 섹션
   ├─ PUT /api/rfp/projects/[id]/sharepoint/folder {url}
   │     사용자 access 토큰(refresh로 발급) → GET graph/shares/{u!base64url(url)}/driveItem → 폴더 검증 → rfp_projects.sharepoint_folder
   ├─ POST /api/rfp/projects/[id]/sharepoint/upload
   │     검사(ready·폴더·연결) → 토큰 → buildProjectWorkbook(1단계 xlsx와 동일 버퍼·파일명)
   │     → 4MB 미만 PUT …:/{name}:/content?conflictBehavior=replace / 이상 createUploadSession + 10MiB 청크
   │     → rfp_sharepoint_uploads insert → getNotifier("notify").sendChannel(링크) → {upload, notified, notifyError?}
   └─ GET /api/rfp/projects/[id]/sharepoint ── {folder, lastUpload, uploads[20]}
```

- **위임 토큰만 쓴다.** 서버는 사용자별 refresh 토큰을 AES-256-GCM으로 암호화해 `ms_connections`에 두고, 요청마다 refresh로 access 토큰을 받아 Graph를 부른다(서버 메모리 5분 캐시). access·refresh 토큰은 클라이언트·로그에 절대 내보내지 않는다.
- **Entra 앱은 기존 것 재사용**: settings `teams_graph_client_id`·`teams_tenant_id`, env `TEAMS_GRAPH_CLIENT_SECRET`(Graph 멤버 조회와 공용). 위임 권한 4개(`Files.ReadWrite.All`, `Sites.Read.All`, `User.Read`, `offline_access`)만 추가하면 되고 관리자 동의는 필요 없다(테넌트가 사용자 동의를 막았다면 Application Administrator가 위임 권한에 동의 가능 — 앱 권한과 달리 GA 불필요).
- **순수 로직은 `frontend/src/lib/ms/`·`frontend/src/lib/rfp/sharepoint.ts`** 에 두고 vitest 대상이다. Graph·Azure 호출은 `fetch` 주입으로 모킹한다. 라우트는 얇다.

```
frontend/src/lib/ms/
  crypto.ts        encryptSecret/decryptSecret(AES-256-GCM, env MS_TOKEN_ENC_KEY), signState/verifyState(HMAC-SHA256)
  oauth.ts         MS_SCOPES, buildAuthorizeUrl, exchangeCode, refreshAccessToken, fetchMe, OAuthError(code) (fetch 주입)
  connections.ts   getConnection, saveConnection, deleteConnection, getAccessTokenForUser(5분 캐시), ReconnectRequiredError
  graph-drive.ts   encodeShareUrl, resolveFolder, uploadFile(small/large 분기), GraphError(status, code, requestId), 재시도
  origin.ts        resolveRedirectOrigin(request) — 허용 오리진 목록(env MS_ALLOWED_ORIGINS) 검사
frontend/src/lib/rfp/sharepoint.ts   buildProjectWorkbook(admin, projectId), uploadProjectXlsx(...), buildUploadNotice(...)
frontend/src/app/api/ms/{connect,callback,connection}/route.ts
frontend/src/app/api/rfp/projects/[id]/sharepoint/route.ts            GET
frontend/src/app/api/rfp/projects/[id]/sharepoint/folder/route.ts     PUT·DELETE
frontend/src/app/api/rfp/projects/[id]/sharepoint/upload/route.ts     POST
frontend/src/components/settings/MicrosoftAccountCard.tsx
frontend/src/components/rfp/SharePointSection.tsx
frontend/src/types/ms.ts, frontend/src/types/rfp.ts(확장)
docs/sql/2026-09-05-rfp-sharepoint.sql
```

## 3. Microsoft 계정 연결

### 3.1 OAuth 흐름 (`lib/ms/oauth.ts`, `/api/ms/connect`, `/api/ms/callback`)

- 스코프 상수 `MS_SCOPES = ["offline_access", "User.Read", "Files.ReadWrite.All", "Sites.Read.All"]`.
- `GET /api/ms/connect?returnTo=/settings` — `requireUser()`. `returnTo`는 같은 오리진 경로(`/`로 시작, `//`·`http` 거부)만, 기본 `/settings`. 서버가 `state = signState({ u: userId, n: nonce(16B), r: returnTo, e: now+600s })`를 만들고 `buildAuthorizeUrl({ tenantId, clientId, redirectUri, state })`로 302한다. authorize URL: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?client_id=…&response_type=code&redirect_uri=…&response_mode=query&scope=…&state=…&prompt=select_account`.
- `redirect_uri = ${origin}/api/ms/callback`. `origin`은 `lib/ms/origin.ts`의 `resolveRedirectOrigin(request)`: `request.nextUrl.origin`이 env `MS_ALLOWED_ORIGINS`(쉼표 구분, 기본 `https://inje-playground.vercel.app,http://localhost:3003`)에 있을 때만 통과, 아니면 400 "허용되지 않은 오리진". Entra 앱에는 같은 두 URI를 등록한다.
- `GET /api/ms/callback?code&state` — `requireUser()`. `verifyState(state)` → 서명·만기 확인, `u`가 세션 사용자와 같아야 함(다르면 400). Azure가 `error`를 돌려주면(`access_denied` 등) 토큰 교환 없이 `returnTo?ms_error=연결이 취소되었습니다` 로 복귀. `exchangeCode({ tenantId, clientId, clientSecret, code, redirectUri })` → `{ accessToken, refreshToken, expiresIn, scope }`. `refreshToken`이 없으면(offline_access 미동의) 400 "오프라인 접근 권한이 필요합니다". `fetchMe(accessToken)` → `{ userPrincipalName, displayName, mail }`. `saveConnection(admin, { userId, refreshToken, accountUpn, accountName, scopes })` 후 `returnTo?ms_connected=1`로 302.
- 토큰 엔드포인트 `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`(x-www-form-urlencoded). 응답 오류 `{error, error_description}`는 `OAuthError(code, description)`로 던진다. `error_description`은 서버 로그에만 남기고 클라이언트에는 코드 기반 한국어 문구만 준다.

### 3.2 토큰 저장·사용 (`lib/ms/crypto.ts`, `lib/ms/connections.ts`)

- `MS_TOKEN_ENC_KEY`: 64자 hex(32바이트). 없거나 길이가 다르면 연결·업로드 라우트가 500 "MS_TOKEN_ENC_KEY가 설정되지 않았습니다"(서버 로그에도).
- `encryptSecret(plain)` → `v1.{iv}.{tag}.{cipher}`(각 base64url, iv 12B, tag 16B). `decryptSecret` — 형식·태그 불일치는 `Error("토큰 복호화 실패")`. 키 파생: 암호화 키 = hex 디코드 바이트, HMAC 키 = `sha256("state:" + hex)`.
- `signState(payload)` → `base64url(json) + "." + base64url(hmac)`; `verifyState(token)` — 상수 시간 비교(`timingSafeEqual`), 만기 지나면 `null`.
- `getAccessTokenForUser(admin, userId, deps)`:
  1. `ms_connections` 행이 없으면 `NotConnectedError`.
  2. 메모리 캐시(`Map<userId, {token, exp}>`, 만기 60초 전까지 유효, 최대 5분) 히트면 반환.
  3. `refreshAccessToken({ tenantId, clientId, clientSecret, refreshToken })` → 성공: 캐시 저장, 응답에 새 `refresh_token`이 있으면 재암호화해 교체, `last_used_at=now`, `last_error=null`.
  4. `OAuthError` 코드가 `invalid_grant`·`interaction_required`·`consent_required`면 `last_error`에 코드를 쓰고 `ReconnectRequiredError`. 그 외는 그대로 던진다(라우트가 502).
- `deleteConnection`은 행 삭제 + 캐시 제거. 연결을 해제해도 이미 올라간 파일·프로젝트의 폴더 설정은 남는다.

## 4. 폴더 지정 (`lib/ms/graph-drive.ts`, `/api/rfp/projects/[id]/sharepoint/folder`)

- `encodeShareUrl(url)` = `"u!" + base64url(utf8(url))`(패딩 제거, `+`→`-`, `/`→`_`) — Graph shares API 규격.
- `resolveFolder(token, url, fetchImpl)` → `GET https://graph.microsoft.com/v1.0/shares/{enc}/driveItem?$select=id,name,webUrl,folder,parentReference`. 응답에 `folder`가 없으면 `FolderResolveError("폴더 링크가 아닙니다. 파일이 아닌 폴더의 링크를 붙여 주세요.")`. 404/400/403은 `FolderResolveError("링크를 해석할 수 없습니다. 폴더의 '링크 복사'를 사용하세요.")`(403은 "이 폴더를 볼 권한이 없습니다"). 결과 `{ driveId: parentReference.driveId, itemId: id, name, webUrl }`.
- `PUT …/sharepoint/folder {url}` — `requireUser()`; `url`은 `https://` 필수, 2000자 이하; 프로젝트 존재 확인; 사용자 토큰으로 해석; `rfp_projects.sharepoint_folder = { url, driveId, itemId, name, webUrl, setBy: userId, setAt: now }`. 응답 `{ folder }`. 다시 PUT하면 교체.
- `DELETE …/sharepoint/folder` → `sharepoint_folder = null`, 204. 이력은 남는다.
- 폴더는 **프로젝트 속성**이다. 누가 지정했든 연결된 사용자 누구나 그 폴더로 업로드할 수 있다(업로드 권한은 Graph가 업로더 계정 기준으로 판정).

## 5. 업로드·알림 (`lib/rfp/sharepoint.ts`, `/api/rfp/projects/[id]/sharepoint/upload`)

### 5.1 공용 워크북 빌더
- `buildProjectWorkbook(admin, projectId)` → `{ buffer: Buffer; fileName: string; project: XlsxProject & { id, name, mappingStatus } }`. 현재 `GET …/xlsx` 라우트의 본문(프로젝트·요구사항·매핑·카탈로그 로드 → `buildWorkbook` → `xlsxFileName`)을 이 함수로 옮기고 라우트는 호출만 한다. 프로젝트가 없으면 `null`. 동작은 바뀌지 않는다(기존 `rfp-xlsx.test.ts` 7개 그대로).

### 5.2 업로드 절차 (`uploadProjectXlsx(admin, supabase, projectId, userId, deps)`)
1. 프로젝트 조회: 없음 → 404, `status !== "ready"` → 400 "요구사항 추출이 끝난 뒤 업로드할 수 있습니다", `sharepoint_folder` 없음 → 400 `{code:"no_folder"}`.
2. `getAccessTokenForUser` — `NotConnectedError` → 400 `{code:"not_connected"}`, `ReconnectRequiredError` → 409 `{code:"reconnect"}`.
3. `buildProjectWorkbook` → 버퍼·파일명(`xlsxFileName`은 KST 날짜를 쓰도록 `new Date()`를 KST로 보정 — 1단계는 서버 로컬 시간을 썼는데 Vercel은 UTC이므로 `Intl` 기준 `Asia/Seoul` 날짜로 통일한다. xlsx 라우트도 같은 함수를 쓰므로 함께 바뀐다).
4. `uploadFile(token, { driveId, itemId, fileName, buffer, fetchImpl })`:
   - `buffer.length < 4 * 1024 * 1024` → `PUT /drives/{driveId}/items/{itemId}:/{encodeURIComponent(fileName)}:/content?@microsoft.graph.conflictBehavior=replace`, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
   - 이상 → `POST /drives/{driveId}/items/{itemId}:/{name}:/createUploadSession` body `{ item: { "@microsoft.graph.conflictBehavior": "replace", name } }` → `uploadUrl`에 10MiB 청크를 `Content-Range: bytes a-b/total`로 순서대로 PUT(인증 헤더 없음), 마지막 응답(200/201)의 driveItem 사용.
   - 응답 driveItem `{ id, name, webUrl, size }`.
   - 429·503은 `Retry-After`(없으면 2초, 최대 5초) 후 1회 재시도.
5. `rfp_sharepoint_uploads` insert `{ project_id, drive_id, item_id, file_name, web_url, size_bytes, uploaded_by }`.
6. 알림: `getNotifier(supabase, "notify")` → `channelConfigured`가 false면 `notified=false`(오류 아님). true면 `sendChannel(buildUploadNotice({ projectName, userName, folderName, webUrl, fileName }))` → `ok`면 `notified=true`, 아니면 `notified=false, notifyError=error`. 문구:
   - title `RFP 분석`
   - text `[RFP] {사업명} 요구사항 검토 파일을 SharePoint에 올렸습니다 — {사용자 이름} · {폴더명}\n{파일명}\n{webUrl}`
7. 응답 200 `{ upload: RfpSharepointUpload, notified, notifyError? }`. 라우트 `maxDuration = 60`, `runtime = "nodejs"`.

### 5.3 재업로드
같은 날(KST) 다시 올리면 파일명이 같아 `replace`로 덮어쓴다(SharePoint가 버전 이력을 보관). 날짜가 바뀌면 새 파일이 생긴다. 이력 표에는 매번 한 행이 남는다.

## 6. 데이터 모델 (`docs/sql/2026-09-05-rfp-sharepoint.sql`, 멱등)

```sql
create table if not exists public.ms_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_upn text,
  account_name text,
  refresh_token_enc text not null,                      -- v1.iv.tag.cipher (AES-256-GCM)
  scopes text not null,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
drop trigger if exists ms_connections_set_updated_at on public.ms_connections;
create trigger ms_connections_set_updated_at before update on public.ms_connections
  for each row execute function public.rfp_set_updated_at();

alter table public.rfp_projects add column if not exists sharepoint_folder jsonb;   -- {url, driveId, itemId, name, webUrl, setBy, setAt}

create table if not exists public.rfp_sharepoint_uploads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.rfp_projects(id) on delete cascade,
  drive_id text not null,
  item_id text not null,
  file_name text not null,
  web_url text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rfp_sharepoint_uploads_project_idx on public.rfp_sharepoint_uploads (project_id, created_at desc);
```
- RLS: 1·2단계와 같이 두 테이블 모두 켜고 관리자 읽기 정책만 둔다. `ms_connections`는 관리자 읽기 정책도 두지 않는다(토큰 컬럼 보호) — service role만 접근.
- `ms_connections`는 사용자당 1행(계정 하나). 다른 계정으로 다시 연결하면 upsert로 교체.

## 7. API

인증은 모두 `requireUser()`(user 이상). 응답 키 camelCase.

| 메서드·경로 | 요청 → 응답 |
|---|---|
| `GET /api/ms/connect?returnTo=` | 302 Azure authorize. 설정(`teams_graph_client_id`·`teams_tenant_id`·`TEAMS_GRAPH_CLIENT_SECRET`·`MS_TOKEN_ENC_KEY`) 누락 → 500 문구에 항목명; 오리진 불허 → 400 |
| `GET /api/ms/callback?code&state` | 검증·교환·저장 → 302 `returnTo?ms_connected=1`. 실패 → 302 `returnTo?ms_error=<한국어 문구>`(state 불일치·만기: "연결 요청이 만료되었습니다. 다시 시도하세요") |
| `GET /api/ms/connection` | `{connected:boolean, accountUpn, accountName, connectedAt, lastUsedAt, lastError, scopes}`(미연결이면 `{connected:false}`) |
| `DELETE /api/ms/connection` | 204 |
| `GET /api/rfp/projects/[id]/sharepoint` | `{folder: SharepointFolder\|null, lastUpload: RfpSharepointUpload\|null, uploads: RfpSharepointUpload[]}`(최근 20) |
| `PUT /api/rfp/projects/[id]/sharepoint/folder` | `{url}` → 해석 → `{folder}`. 400(형식·폴더 아님·해석 실패·`not_connected`), 403(볼 권한 없음), 409(`reconnect`) |
| `DELETE /api/rfp/projects/[id]/sharepoint/folder` | 204 |
| `POST /api/rfp/projects/[id]/sharepoint/upload` | → 200 `{upload, notified, notifyError?}`. 400(`no_folder`·`not_connected`·status), 409(`reconnect`·423 잠김), 403·404·502(§9) |
| `GET /api/rfp/projects/[id]` | 1·2단계 응답에 `sharepoint: {folder, lastUpload}` 추가 |

타입(`types/rfp.ts`): `SharepointFolder {url, driveId, itemId, name, webUrl, setBy, setAt}`, `RfpSharepointUpload {id, fileName, webUrl, sizeBytes, uploadedBy: {id, name}, createdAt}`, `SharepointResponse`, `UploadResponse`. `types/ms.ts`: `MsConnectionStatus`.

## 8. 화면

- **`/settings` — `MicrosoftAccountCard`**: 기존 카드 아래에 "Microsoft 계정" 카드. `GET /api/ms/connection`으로 상태 표시(연결됨: 계정 이름·UPN·연결 시각·마지막 사용; `lastError`가 있으면 "연결이 만료되었습니다. 다시 연결하세요" 경고). 버튼: 미연결 → "Microsoft 계정 연결"(`window.location = /api/ms/connect?returnTo=/settings`), 연결됨 → "다시 연결"·"해제"(확인 다이얼로그 → DELETE). URL 쿼리 `ms_connected=1`이면 성공 토스트, `ms_error`면 오류 문구 표시 후 쿼리 제거(`router.replace`).
- **`/rfp/[id]` — `SharePointSection`**(OverviewCard 아래, 매핑 요약 위):
  - 폴더 행: 폴더가 없으면 입력 + "폴더 지정" 버튼(placeholder "Teams/SharePoint 폴더의 '링크 복사' 값을 붙이세요"); 있으면 폴더명·"폴더 열기"(`webUrl`, 새 탭)·"변경"(입력 다시 노출)·"해제".
  - 업로드 행: 연결 상태를 `GET /api/ms/connection`으로 확인. 미연결 → "Microsoft 계정 연결" 버튼(`returnTo`는 현재 상세 경로). 연결됨 → "SharePoint에 업로드" 버튼(폴더 없음·`status !== "ready"`·업로드 중이면 비활성, 스피너). 결과: 성공 시 "업로드 완료 — {파일명}" + "Teams 알림 전송됨" 또는 "Teams 알림 미설정(웹후크 없음)" 또는 "알림 실패: …"; `reconnect`면 "연결이 만료되었습니다" + 다시 연결 버튼.
  - 마지막 업로드: 파일명(링크)·시각·업로더. 이력 접이식(`<details>`) 최근 20건.
  - 이 섹션은 `GET /api/rfp/projects/[id]/sharepoint`를 마운트 시와 업로드·폴더 변경 후에 다시 읽는다. 상세 GET의 `sharepoint`는 초기 표시용.
- 모든 문구 한국어, 기존 shadcn(Card·Button·Input·Badge·AlertDialog).

## 9. 오류 처리

| 상황 | 처리 |
|---|---|
| 설정 누락(client id·tenant·secret·enc key) | connect/upload 500, 문구에 누락 항목명. 서버 로그 |
| 허용되지 않은 오리진 | connect 400 |
| state 위조·만기·사용자 불일치 | callback → `returnTo?ms_error=연결 요청이 만료되었습니다…` |
| Azure `access_denied`/사용자 취소 | `ms_error=연결이 취소되었습니다` |
| refresh_token 미발급 | `ms_error=오프라인 접근 권한이 필요합니다` |
| 미연결 | folder/upload 400 `{code:"not_connected"}` — 화면은 연결 버튼 |
| `invalid_grant`·`interaction_required` | 409 `{code:"reconnect"}`, `last_error` 기록 — 화면은 재연결 버튼 |
| 폴더 링크가 파일·해석 불가 | 400 문구(§4) |
| Graph 403 | 403 "이 폴더에 쓸 권한이 없습니다"(업로드) / "이 폴더를 볼 권한이 없습니다"(해석) |
| Graph 404(폴더 삭제·이동) | 404 "폴더가 없습니다(삭제·이동). 링크를 다시 지정하세요" — 폴더 설정은 그대로 두고 화면에 경고 |
| Graph 423(파일 잠김) | 409 "파일이 열려 있어 덮어쓸 수 없습니다. 잠시 뒤 다시 시도하세요" |
| Graph 429·5xx | Retry-After 후 1회 재시도, 그래도 실패 → 502 "SharePoint 응답 오류(NNN)" |
| 알림 실패·미설정 | 업로드는 성공, `notified=false`(+`notifyError`) |
| 토큰 복호화 실패(키 교체 등) | 409 `{code:"reconnect"}` + `last_error="decrypt"` |

Graph 오류는 `GraphError { status, code, message, requestId }`로 정규화하고 서버 로그에 `request-id` 헤더를 남긴다. 토큰·Authorization 헤더는 어떤 로그에도 쓰지 않는다.

## 10. 테스트 (vitest, `frontend/src/lib/__tests__/`)

- `ms-crypto.test.ts`: 암복화 왕복, 다른 키·변조된 태그·잘못된 형식 거부; state 서명 왕복, 만기 지난 state → null, 변조 → null, 사용자 불일치는 라우트 책임(순수 함수는 payload만 반환).
- `ms-oauth.test.ts`: `buildAuthorizeUrl` 파라미터(scope 4개·state·redirect_uri·prompt), `exchangeCode`/`refreshAccessToken` 요청 본문·성공 파싱·`OAuthError(invalid_grant)`(fetch 모킹), `fetchMe` 파싱.
- `ms-connections.test.ts`: 가짜 admin(간단한 in-memory 체인)으로 `getAccessTokenForUser` — 미연결 `NotConnectedError`, 캐시 히트(두 번째 호출은 fetch 안 함), 새 refresh 토큰 교체 저장, `invalid_grant` → `ReconnectRequiredError` + `last_error`.
- `ms-graph-drive.test.ts`: `encodeShareUrl`(규격 예시 `u!aHR0cHM6Ly8…` 패딩 없음), `resolveFolder` 폴더/파일/404/403, `uploadFile` 4MB 경계에서 small/large 선택·`conflictBehavior=replace` 쿼리·세션 청크 `Content-Range` 분할(예: 25MiB → 10/10/5), 429 재시도 1회.
- `ms-origin.test.ts`: 허용 목록 통과/거부, `returnTo` 검증(`/settings` OK, `//evil`·`https://` 거부).
- `rfp-sharepoint.test.ts`: `buildUploadNotice` 문구, `xlsxFileName` KST 날짜(UTC 15:30 = KST 다음날 00:30 경계).
- 기존 `rfp-xlsx.test.ts` 7개 유지(라우트 리팩터는 순수 함수 `buildWorkbook`을 그대로 씀).
- 라우트·화면은 런북 수동 체크리스트 21~28(연결 → 상태 → 폴더 지정(파일 링크 거부) → 업로드 → SharePoint에서 파일 확인 → 같은 날 재업로드 덮어쓰기 → Teams 알림 → 해제 후 업로드 시 연결 안내).

## 11. 환경 변수·설치·배포

- 새 env: `MS_TOKEN_ENC_KEY`(64자 hex, `openssl rand -hex 32`), `MS_ALLOWED_ORIGINS`(선택, 기본 운영 도메인+localhost:3003). 기존: `TEAMS_GRAPH_CLIENT_SECRET`(**현재 Vercel에 없음 — 추가 필요**), settings `teams_graph_client_id`·`teams_tenant_id`.
- Entra 앱(앱 소유자 작업): 인증 → 플랫폼 "웹" 리디렉션 URI `https://inje-playground.vercel.app/api/ms/callback`, `http://localhost:3003/api/ms/callback` 추가; API 권한 → Microsoft Graph → **위임된 권한** `Files.ReadWrite.All`, `Sites.Read.All`, `User.Read`, `offline_access` 추가(관리자 동의 버튼은 누르지 않아도 됨; 테넌트가 사용자 동의를 막아 첫 연결에서 "관리자 승인 필요"가 뜨면 Application Administrator가 동의).
- SQL `docs/sql/2026-09-05-rfp-sharepoint.sql`을 Management API로 적용(컨트롤러). 배포는 `git push` 후 `vercel --prod`.
- 런북 `docs/rfp-analyzer.md`에 3단계 구성·env·설치·운영 메모·체크리스트 21~28, `docs/teams-integration.md`에 위임 권한 추가 절, `CLAUDE.md`에 페이지·API·테이블·env·`lib/ms/` 추가.

## 12. 보안

- 토큰은 service role로만 접근하는 `ms_connections`에 암호화 저장, RLS 사용자 정책 없음. 응답·로그에 토큰 없음.
- state는 HMAC 서명 + 10분 만기 + 세션 사용자 일치. `returnTo`는 같은 오리진 경로만. redirect_uri는 허용 목록.
- 위임 권한이라 업로드는 사용자가 쓸 수 있는 폴더에만 된다. 다른 사용자가 지정한 폴더라도 내 계정에 쓰기 권한이 없으면 403.
- `MS_TOKEN_ENC_KEY` 교체 시 모든 연결이 복호화 실패 → 재연결 유도(§9). 키는 Vercel env에만.
