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

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/app/admin/chat-history/page.tsx` | 신규 — 어드민 질의/응답 관리 페이지 |
| `frontend/src/app/api/admin/chat-history/route.ts` | 신규 — 전체 사용자 채팅 기록 API |
| `frontend/src/components/guide/CitationsSection.tsx` | 신규 — 참고 자료 공통 컴포넌트 |
| `frontend/src/components/guide/ChatPanel.tsx` | CitationsSection 공통 컴포넌트로 교체 |
| `frontend/src/app/admin/layout.tsx` | 질의/응답 관리 네비게이션 탭 추가 |

## 커밋 이력

| 커밋 | 메시지 |
|------|--------|
| `103d06e` | feat: 어드민 질의/응답 관리 페이지 추가 |
| `e698268` | fix: 어드민 질의/응답 AI 응답에 ReactMarkdown 적용 |
