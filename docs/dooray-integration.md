# Dooray 연동 가이드

## 개요

NHN Dooray! API를 활용하여 프로젝트 구성원 가져오기, 메신저 DM 전송, 채널 알림(Webhook) 기능을 제공합니다.

## 인증

**방식**: API 토큰 (Bearer)

```
Authorization: dooray-api {TOKEN}
Content-Type: application/json
```

**토큰 발급**: Dooray > 개인 설정 > API > 개인 인증 토큰 발급

**설정 위치**: 앱 내 어드민 > 시스템 설정 > Dooray API 토큰 / 프로젝트 ID

---

## 사용 중인 API 엔드포인트

Base URL: `https://api.dooray.com`

### 프로젝트 구성원 조회

```
GET /project/v1/projects/{projectId}/members?page={n}&size=100
```

- 페이지네이션: `page=0`부터 시작, `size=100` 단위
- 응답에서 `organizationMemberId` 추출
- `result.length < 100`이면 마지막 페이지

### 구성원 상세 조회

```
GET /common/v1/members/{memberId}
```

- 이름(`result.name`), ID 조회
- 10개씩 배치 병렬 호출

### 메신저 DM 전송

```
POST /messenger/v1/channels/direct-send
```

```json
{
  "text": "메시지 내용",
  "organizationMemberId": "멤버 ID"
}
```

- "오늘 뭐 먹지" 결정 시 선택된 멤버에게 DM 전송

### Incoming Webhook (채널 알림)

```
POST {dooray_hook_url}
```

```json
{
  "botName": "봇 이름",
  "botIconImage": "https://static.dooray.com/static_images/dooray-bot.png",
  "text": "메시지 내용"
}
```

- 팀 구성 결과, 점심 결정 결과 등을 채널에 전송
- Webhook URL은 Dooray 프로젝트 설정에서 발급

### 조직/부서 조회 (디버그용)

```
GET /common/v1/organizations/-/departments?page=0&size=100
GET /common/v1/members/{memberId}/departments
GET /project/v1/projects/{projectId}/member-groups?page=0&size=100
```

- `/api/dooray/debug` 엔드포인트에서만 사용 (운영 미사용)

### 프로젝트 목록 조회 (미구현)

```
GET /project/v1/projects?type={type}
```

- `type` 파라미터: `public` 또는 `private` (선택)
- 인증된 사용자가 접근 가능한 프로젝트 목록 반환
- **구현 시 활용**: 설정 페이지에서 프로젝트 ID를 수동 입력하는 대신, 드롭다운으로 선택 가능

### 프로젝트 태그 조회 (미구현)

```
GET /project/v1/projects/{projectId}/tags
```

### 구성원 검색 (미구현)

```
GET /common/v1/members?externalEmailAddresses={email}
```

### 태스크(포스트) 관리 (미구현)

```
GET  /project/v1/projects/{projectId}/posts?tagIds={tagId}
POST /project/v1/projects/{projectId}/posts
GET  /project/v1/projects/{projectId}/posts/{postId}
PUT  /project/v1/projects/{projectId}/posts/{postId}
```

- 워크플로우, 마일스톤, 태그, 담당자 등으로 필터링 가능

---

## 아키텍처

### 데이터 흐름

```
[사용자] → "Dooray에서 가져오기" 클릭
    ↓
[클라이언트] → GET /api/dooray/members?projectId=X
               (x-dooray-token 헤더)
    ↓
[API Route] → Dooray API 호출 (서버 사이드, CORS 우회)
    ↓
  ┌─ 성공 → DB에 캐시 저장 (dooray_members) → 멤버 목록 반환
  └─ 실패 → DB fallback (GET /api/dooray/members/db) → 캐시된 목록 반환
```

### API 라우트 구조

```
src/app/api/dooray/
├── members/
│   ├── route.ts      — Dooray API 프록시 + DB 저장
│   └── db/
│       └── route.ts  — DB fallback (캐시된 멤버)
└── debug/
    └── route.ts      — API 테스트/탐색용
```

### 관련 파일

| 파일 | 역할 |
|------|------|
| `src/lib/dooray.ts` | Dooray API 클라이언트 (멤버 조회 로직) |
| `src/components/shared/DoorayImportButton.tsx` | 가져오기 버튼 + fallback 처리 |
| `src/components/settings/DooraySettings.tsx` | 토큰/프로젝트 ID 설정 UI |
| `src/hooks/useSettings.ts` | 설정 로드/저장 훅 |
| `src/app/api/food/decide/route.ts` | DM 전송 + Webhook |
| `src/app/api/team-notify/route.ts` | 팀 구성 Webhook |
| `src/types/dooray.ts` | TypeScript 타입 정의 |

### DB 테이블

| 테이블 | 용도 |
|--------|------|
| `dooray_members` | 캐시된 구성원 (id, name, updated_at) |
| `app_settings` | API 토큰, 프로젝트 ID 등 설정값 |

---

## 알려진 이슈

### Vercel 환경에서 구성원 가져오기 실패

**증상**: Vercel에 배포된 환경에서 "Dooray에서 가져오기" 실행 시 API 호출이 실패함.

**원인 추정**:
- **Serverless Function 타임아웃**: 구성원이 많은 경우 페이지네이션 + 상세 조회(배치 10개)로 시간이 오래 걸림. Vercel Hobby 플랜 기본 타임아웃 10초, Pro 플랜 60초 제한.
- **IP 제한**: Dooray API가 특정 IP 대역만 허용하는 경우, Vercel Serverless Function의 동적 IP가 차단될 수 있음.
- **네트워크 제한**: NHN 내부 네트워크에서만 접근 가능한 API일 가능성.

**현재 대응**:
- DB fallback 구현 완료 — 로컬 환경에서 한 번이라도 가져오기 성공 시 `dooray_members` 테이블에 캐시됨
- Vercel에서는 자동으로 DB 캐시에서 조회하여 "두레이 연결이 되지 않아, 저장된 리스트를 사용합니다." 메시지와 함께 동작

**근본 해결 방안** (미적용):
1. Dooray API 호출을 외부 서비스(NHN 내부 서버 등)로 분리하여 허용된 IP에서 호출
2. Vercel Function 타임아웃 증가 (`maxDuration` 설정, Pro 플랜 필요)
3. 주기적으로 멤버 동기화하는 Cron Job 구성 (로컬/내부 서버에서 실행)

---

## 설정값 참조

| 설정 키 | 용도 | 예시 |
|---------|------|------|
| `dooray_token` | API 인증 토큰 | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `dooray_project_id` | 프로젝트 ID | `1234567890` |
| `dooray_messenger_url` | 메신저 채널 URL (링크용) | `https://nhninjeinc.dooray.com/messenger/...` |
| `dooray_hook_url` | Incoming Webhook URL | `https://hook.dooray.com/services/...` |
