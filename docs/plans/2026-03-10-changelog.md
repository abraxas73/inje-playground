# 2026-03-10 구현 변경 사항

## 1. 어드민 — 질의/응답 관리 (`/admin/chat-history`)

- **페이지**: `frontend/src/app/admin/chat-history/page.tsx`
- **API**: `frontend/src/app/api/admin/chat-history/route.ts`
- 전체 사용자의 가이드 Q&A 질의/응답 기록을 관리자가 조회할 수 있는 어드민 메뉴 추가
- 기능:
  - 통계 카드: 총 질의 수, 질의 사용자 수(현재 페이지 기준), 사용된 노트북 수
  - 노트북별 필터링 (Select 드롭다운)
  - 이메일 검색 (ilike 부분 일치)
  - 질의 목록: 질문 내용, 사용자 이메일, 노트북명, 일시 표시
  - 접기/펼치기로 AI 응답 확인 (ReactMarkdown 렌더링 + prose 스타일)
  - 응답 완료/응답 없음 배지 표시
  - 페이지네이션 (20건 단위)
- API 동작:
  - `nlm_chat_messages` 테이블에서 `role = 'user'`인 질의만 조회
  - `conversation_id`로 대응하는 assistant 응답 자동 매칭
  - `nlm_notebooks`에서 노트북 제목 병합
  - admin 권한 체크 (user_profiles 테이블)
- 어드민 네비게이션에 "질의/응답 관리" 탭 추가 (MessageSquare 아이콘)

## 2. CitationsSection 공통 컴포넌트 분리

- **파일**: `frontend/src/components/guide/CitationsSection.tsx`
- 기존 `ChatPanel.tsx`에 있던 참고 자료(citations) 렌더링 로직을 공통 컴포넌트로 추출
- 적용 위치:
  - 사용자 가이드 Q&A 채팅 (`ChatPanel.tsx`)
  - 어드민 질의/응답 관리 (`/admin/chat-history`)
- 로직:
  - 빈 텍스트, 5자 미만, "출처 N" 패턴 필터링
  - `cited_text` 기준 중복 제거
  - 접기/펼치기 UI (BookOpen 아이콘, 출처 번호 배지)

## 3. 어드민 AI 응답 마크다운 렌더링

- 어드민 질의/응답 페이지의 AI 응답 본문에 `ReactMarkdown` 적용
- 사용자 페이지(`ChatPanel`)와 동일한 `prose prose-sm` 스타일 클래스 사용
- 볼드, 리스트, 코드블록 등 마크다운 포매팅 정상 표시

## 4. NLM 서비스 자동 종료 (auto-shutdown)

학습(소스 업로드) 완료 후 NLM 서비스를 자동으로 종료하여 비용을 절감하는 기능.

### 4-1. fly.toml — auto_stop (안전망)

- `auto_stop_machines` 값을 `'off'` → `'stop'`으로 변경
- 트래픽이 없으면 fly.io가 자동으로 머신 중지
- `auto_start_machines = true` 유지 → 요청이 오면 자동 재시작
- 역할: 소스 업로드 후 명시적 shutdown이 실패해도 유휴 상태에서 자동 종료되는 안전망

### 4-2. NLM shutdown API (명시적 종료)

- **파일**: `frontend/src/app/api/guide/nlm/shutdown/route.ts`
- `POST /api/guide/nlm/shutdown` — Fly Machines REST API로 머신 직접 중지
- admin 권한 체크 후 실행
- 동작:
  1. `GET /v1/apps/{app}/machines` — 머신 목록 조회
  2. `state = 'started'`인 머신에 대해 `POST .../stop` 호출
  3. 중지된 머신 ID 반환
- 환경변수 필요:
  - `FLY_API_TOKEN` — Fly.io API 토큰 (Vercel에 설정 필요)
  - `FLY_APP_NAME` — 앱 이름 (기본값: `inje-nlm-service`)

### 4-3. SourceManager — 소스 추가 후 자동 호출

- 소스 추가(텍스트/URL/파일) 성공 시 `shutdownNlmService()` 자동 호출
- 종료 상태 배너 표시 (amber 색상, 5초 후 자동 제거)
- fire-and-forget 방식으로 소스 추가 UX에 영향 없음

### 4-4. 동작 흐름

```
[관리자] 소스 추가 (텍스트/URL/파일)
  ↓
[SourceManager] NLM 서비스에 소스 등록 완료
  ↓
[SourceManager] POST /api/guide/nlm/shutdown 호출 (fire-and-forget)
  ↓
[shutdown API] Fly Machines API → 머신 stop
  ↓
[fly.io] 머신 stopped 상태 (과금 중지)
  ↓
[사용자] 가이드 Q&A 질문 시 → fly.io auto_start → 머신 자동 재시작
```

## 5. VM 스펙 업그레이드 검토

현재 NLM 서비스는 `shared-cpu-1x @ 1GB`로 운영 중.
학습 성능 향상을 위해 VM 스펙 업그레이드를 검토함.

### 현재 설정

| 항목 | 값 |
|------|-----|
| VM 타입 | shared-cpu-1x |
| CPU | shared 1코어 |
| RAM | 1GB |
| 리전 | nrt (도쿄) |
| 월 비용 | ~$7 (상시 가동 기준) |

### 검토 옵션

| 옵션 | CPU 종류 | 코어 | RAM | 월 비용 (IAD) | nrt 예상 | 비고 |
|------|----------|------|-----|--------------|----------|------|
| 현재 | shared | 1 | 1GB | $5.92 | ~$7 | |
| A | shared 2x | 2 | 2GB | $11.83 | ~$14 | 가벼운 업그레이드 |
| B | shared 4x | 4 | 4GB | $23.66 | ~$28 | 여유로운 shared |
| C | performance 1x | 1 | 2GB | $32.19 | ~$39 | 전용 CPU |
| D | performance 2x | 2 | 4GB | $64.39 | ~$77 | 고성능 |
| E | performance 4x | 4 | 8GB | $128.77 | ~$155 | |
| **F** | **performance 16x** | **16** | **32GB** | **~$500+** | **~$600+** | **최대 성능** |

### 비용 절감 포인트

- `auto_stop_machines = 'stop'` + 소스 업로드 후 자동 종료로 **실제 가동 시간만 과금**
- 예: performance-16x라도 하루 1시간만 가동 시 → 월 ~$20 수준
- 적용 명령: `fly scale vm performance-16x --memory 32768`

### 미적용 사항 (TODO)

- [ ] Vercel 환경변수 `FLY_API_TOKEN` 설정
- [ ] VM 스펙 변경 적용 (옵션 결정 후)
- [ ] fly.toml 배포 (`fly deploy`)

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/app/admin/chat-history/page.tsx` | 신규 — 어드민 질의/응답 관리 페이지 |
| `frontend/src/app/api/admin/chat-history/route.ts` | 신규 — 전체 사용자 채팅 기록 API |
| `frontend/src/app/api/guide/nlm/shutdown/route.ts` | 신규 — NLM 서비스 머신 중지 API |
| `frontend/src/components/guide/CitationsSection.tsx` | 신규 — 참고 자료 공통 컴포넌트 |
| `frontend/src/components/guide/ChatPanel.tsx` | CitationsSection 공통 컴포넌트로 교체 |
| `frontend/src/components/guide/SourceManager.tsx` | 소스 추가 후 자동 shutdown 호출 |
| `frontend/src/app/admin/layout.tsx` | 질의/응답 관리 네비게이션 탭 추가 |
| `nlm-service/fly.toml` | auto_stop_machines: off → stop |

## 커밋 이력

| 커밋 | 메시지 |
|------|--------|
| `103d06e` | feat: 어드민 질의/응답 관리 페이지 추가 |
| `e698268` | fix: 어드민 질의/응답 AI 응답에 ReactMarkdown 적용 |
| `d896bfd` | feat: 소스 업로드 후 NLM 서비스 자동 종료 |
