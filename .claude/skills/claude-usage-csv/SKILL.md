---
name: claude-usage-csv
description: claude.ai Team 조직 7개의 멤버 활동 CSV를 Chrome 확장으로 내보내고 /admin/claude-usage에 업로드한다. "CSV 수집해", "클로드 사용량 CSV 갱신" 요청 시 사용.
---

# Claude 사용량 CSV 수집 (반자동)

전제: Chrome에 Claude in Chrome 확장이 연결돼 있고, claude.ai에 7개 조직의 소유자 계정(seunguk.kang@innogrid.com)으로 로그인돼 있다. 연결이 안 되면(`tabs_context_mcp` 오류) 사용자에게 `/mcp` → claude-in-chrome 재연결을 요청하고 중단한다. Cloudflare 확인·로그인 화면이 나오면 사용자가 직접 처리하도록 요청한다(자동 통과 금지).

대상 조직(순서대로): Innogrid-ax, Innogrid_AIMS클라우드, Innogrid_AIPaaS, Innogrid_AI반도체Cloud, Innogrid_S1, Innogrid_S2, Innogrid_자율행동체.

## 절차
1. `tabs_context_mcp` → 새 탭 → `https://claude.ai/analytics/overview` 이동. `get_page_text`로 "개요" 아래 조직명을 읽어 현재 조직을 확인한다.
2. 조직 전환: 좌측 하단 계정/조직 메뉴(현재 조직명이 표시된 버튼)를 `find`로 찾아 클릭 → 조직 목록에서 대상 조직 클릭 → 다시 `https://claude.ai/analytics/overview`로 이동 → 개요의 조직명이 대상과 일치하는지 확인(불일치면 재시도 1회 후 사용자에게 보고).
3. 멤버 카드의 **"모두 보기"** 클릭(`find` → ref 클릭; 대화상자가 안 열리면 스크린샷 좌표로 클릭) → 대화상자 기간 콤보가 **30일**인지 확인(기본값) → **"CSV 내보내기"** 클릭 → 2초 대기 → `ls -t ~/Downloads/members-analytics-*.csv | head -1`로 새 파일 생성 확인(파일명의 조직 ID가 이전 조직과 다른지 확인). Escape 2회로 대화상자 닫기.
4. 7개 조직 반복. 실패한 조직은 건너뛰고 마지막에 목록으로 보고한다.
5. 업로드: `./frontend/scripts/claude-usage-upload.sh 1` 실행 → 출력의 ✓/✗ 줄을 그대로 보고.
6. 확인: 사용자에게 `/admin/claude-usage` 채팅·Cowork 탭에서 "조직별 최신 업로드"가 오늘 날짜 기간으로 갱신됐는지 안내. 사용한 탭은 `tabs_close_mcp`로 닫는다.

## 주의
- 다운로드 버튼 클릭은 파일 다운로드이므로 이 스킬을 사용자가 명시적으로 호출한 경우에만 수행한다.
- 관리자 멤버 CSV(관리자 설정 > 멤버)는 필요 없다(활동 CSV에 Role/Seat Tier 포함).
- 조직 ID는 파일명에서 자동 인식되므로 조직 이름 매핑은 `/admin/claude-usage` 조직·설정 탭에서 1회만 지정한다.
