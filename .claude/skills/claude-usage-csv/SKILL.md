---
name: claude-usage-csv
description: claude.ai Team 조직 7개의 멤버 활동 CSV를 Chrome 확장으로 내보내고 /admin/claude-chat에 업로드한다. "CSV 수집해", "클로드 사용량 CSV 갱신" 요청 시 사용.
---

# Claude 사용량 CSV 수집 (반자동)

전제: Chrome에 Claude in Chrome 확장이 연결돼 있고, claude.ai에 7개 조직의 소유자(Primary Owner) 계정으로 로그인돼 있다. 연결이 안 되면(`tabs_context_mcp` 오류) 사용자에게 `/mcp` → claude-in-chrome 재연결을 요청하고 중단한다. Cloudflare 확인·로그인 화면이 나오면 사용자가 직접 처리하도록 요청한다(자동 통과 금지).

대상 조직(순서대로): Innogrid-ax, Innogrid_AIMS클라우드, Innogrid_AIPaaS, Innogrid_AI반도체Cloud, Innogrid_S1, Innogrid_S2, Innogrid_자율행동체.

## 절차
1. `tabs_context_mcp` → 새 탭 → `https://claude.ai/analytics/overview` 이동. `get_page_text`로 "개요" 아래 조직명을 읽어 현재 조직을 확인한다.
2. 조직 전환: 좌측 하단 계정/조직 메뉴(현재 조직명이 표시된 버튼)를 `find`로 찾아 클릭 → 조직 목록에서 대상 조직 클릭 → 다시 `https://claude.ai/analytics/overview`로 이동 → 개요의 조직명이 대상과 일치하는지 확인(불일치면 재시도 1회 후 사용자에게 보고).
3. 멤버 카드의 **"모두 보기"** 클릭(`find` → ref 클릭; 대화상자가 안 열리면 스크린샷 좌표로 클릭) → 대화상자 기간 콤보가 **30일**인지 확인(기본값) → **"CSV 내보내기"** 클릭 → 2초 대기 → `ls -t ~/Downloads/members-analytics-*.csv | head -1`로 새 파일 생성 확인(파일명의 조직 ID가 이전 조직과 다른지 확인). Escape 2회로 대화상자 닫기.
4. 7개 조직 반복. 실패한 조직은 건너뛰고 마지막에 목록으로 보고한다.
4b. **멤버·초대 상태 스크랩(조직마다, CSV와 같은 순회에서)**: `https://claude.ai/admin-settings/members`로 이동 → 활성 탭 표를 JS로 수집(각 행: 이름|이메일, 역할, 티어; "N개 중 1–M 표시" 페이지네이션이 있으면 다음 버튼으로 끝까지) → "대기 중" 탭(span 텍스트 '대기 중'에 dispatchEvent) 클릭 후 동일 수집(대기 행은 이메일만일 수 있음; "대기 중인 초대가 없습니다."면 0명) → `POST /api/admin/claude-usage/org-members`(Bearer 수집 토큰, body `{org_id, members:[{email,name,role,seat_tier,status:'active'|'pending'}]}`, 조직 단위 교체). 대시보드 "멤버 · 초대" 탭에 반영된다. 상태 구분: **대기 중 = 초대 미수락**(노는 시트=활성+30일 사용 0과 다른 축).
5. 업로드: `./frontend/scripts/claude-usage-upload.sh 1` 실행 → 출력의 ✓/✗ 줄을 그대로 보고.
6. 확인: 사용자에게 `/admin/claude-chat` 채팅·Cowork 탭 "업로드 이력"의 **마지막 CSV 수집** 시각이 지금이고 조직 수가 7인지 안내. 새 조직 ID가 등록됐으면 `/admin/directory` 조직·설정 탭에서 이름·시트를 지정(또는 `orgs` PATCH). 사용한 탭은 `tabs_close_mcp`로 닫는다.

## 주의
- 다운로드 버튼 클릭은 파일 다운로드이므로 이 스킬을 사용자가 명시적으로 호출한 경우에만 수행한다.
- 관리자 멤버 CSV(관리자 설정 > 멤버)는 필요 없다(활동 CSV에 Role/Seat Tier 포함).
- 조직 ID는 파일명에서 자동 인식되므로 조직 이름 매핑은 `/admin/directory` 조직·설정 탭에서 1회만 지정한다(2026-08-31 메뉴 개편: 채팅·Cowork 탭은 `/admin/claude-chat`, 멤버·초대/조직·설정 탭은 `/admin/directory`).

## 실행 노하우 (2026-08-26 1회차·08-27 2회차·08-28 3회차에서 확인)
- **멤버·초대 스크랩(5회차 추가)**: 조직 전환용 계정 메뉴(`button[aria-label="계정 메뉴"]`)는 **analytics 페이지에만 있다**(`/new`·admin-settings에는 없음) → 전환은 항상 `/analytics/overview`에서. 티어 표기는 조직마다 한글(스탠다드)·영문(Premium)이 섞여 있고 "할당되지 않음"도 있으니 정규식에 모두 포함. 대기 탭 수집분은 활성 이메일과 dedupe(탭 클릭 실패 대비). 대용량 조직은 body를 `<pre>DUMP_BEGIN…DUMP_END</pre>`로 교체 후 `get_page_text`로 회수(클립보드는 Document not focused로 실패), 소형 조직은 locals+예외만 JS 결과로 반환해 오전 스냅샷과 조인. 멤버 상태는 스냅샷이므로 CSV만 다시 받으면 낡는다 — **CSV 재수집 때 반드시 같이 갱신**.
- **5회차(08-31)**: ① Chrome이 연속 다운로드 3번째부터 조용히 차단할 수 있다(주소창의 차단 아이콘에서 사용자가 "허용"해야 함 — `ls`로 파일 미생성 확인되면 즉시 사용자에게 요청) ② "모두 보기" 카드 순서가 조직·시점마다 다르다(스킬 카드가 먼저 오기도) → **버튼 조상 4단계 innerText가 '멤버'로 시작하는 버튼을 찾되, 카드가 늦게 렌더되므로 0.5초 간격 최대 8초 폴링** ③ 창 1580×984(캡처 1394×868)에서 멤버 대화상자 내보내기 아이콘은 (1111,103).
- **수집 시각은 09:00 KST 이후로**: 분석 창의 끝 날짜는 "UTC 기준 어제"다(08-28 08:47 KST에 받은 파일은 ~08-26, 09:01에 받은 파일은 ~08-27). 09:00 KST(UTC 자정) 전에 받으면 전날과 같은 기간 파일이 나와 교체만 된다. 스킬 시작 시 `TZ=Asia/Seoul date`를 확인하고 09:00 전이면 기다린다.
- **좌표는 매 실행 스크린샷에서 읽는다**: 창 크기가 바뀌면(1372×896 → 1394×868) 멤버 "모두 보기"(1138,797 → 1134,772)·내보내기 아이콘(1112,107 → 1109~1115,100~104) 좌표가 함께 움직이고, 대화상자 위치도 조직마다 몇 px 다르다. **대화상자가 열린 것을 JS로 확인한 뒤** 스크린샷/zoom으로 아이콘 위치를 읽고 클릭한다. 대화상자 없이 아이콘 좌표를 누르면 헤더가 눌려 `/new`(새 채팅)로 튕긴 사례가 있다.
- 3회차에서 가장 안정적이었던 열기 방법: `navigate` → `computer wait 4`(클라이언트 리다이렉트가 끝나기 전에 JS를 돌리면 "navigated" 오류) → JS로 `innerText==='모두 보기'`인 **첫 버튼** `.click()` → `[role=dialog]` 중 "모든 멤버"+"활동 중인 멤버 N명" 대기. 좌표 클릭보다 첫 시도 성공률이 높았다(6/6).
- 조직 규모 08-28: Innogrid-ax 80석·S1 47석(주간 활성 25)·S2 79석(주간 활성 56) — S1·S2가 빠르게 늘고 있어 매번 시트 수를 확인해 `orgs` PATCH로 갱신한다.
- **4회차(08-29, 창 1456×822)**: 조직당 배치 1회로 끝났다(7/7, 실패 0) — `navigate` → `wait 4` → JS(첫 "모두 보기" `.click()` + 대화상자 대기 + 개요의 `총 N 석 중`으로 시트 수 읽기) → `zoom [940,75,1150,115]`(아이콘 확인) → `left_click (1124,95)` → `wait 7~8` → `zoom` → `Escape` → JS 조직 전환. 같은 창 크기에선 아이콘 좌표가 조직 간 동일했다. 시트 08-29: ax 81·S1 71·S2 93·AI반도체 7(모두 증가) → 업로드 후 `orgs` PATCH.

- **2회차(08-27)에서 확정된 가장 안정적인 루프(조직당 2~3회 호출)**: ① `navigate` → JS로 "모두 보기" 텍스트가 뜰 때까지 대기 + 2초 → 개요 아래 조직명 확인 ② 멤버 카드 "모두 보기"를 **스크린샷 좌표(1138,797; 캡처 1372×896 기준, 스크롤 0)** 로 `left_click` — **내비게이션 직후 첫 클릭은 거의 항상 무시되므로 3초 뒤 같은 좌표를 한 번 더 클릭**하고 JS로 `[role=dialog]` 중 "모든 멤버" 포함 + "활동 중인 멤버 N명" 텍스트로 열림 확인 ③ 내보내기 아이콘(대화상자 우상단, **좌표 (1112,107)**)을 `left_click` → 6~8초 대기 → `zoom [900,85,1140,125]`로 스피너가 다운로드 아이콘으로 돌아왔는지 확인 ④ `ls -t ~/Downloads/members-analytics-*.csv | head -1`로 새 조직 ID 확인 ⑤ Escape → JS 조직 전환. `find`로 얻은 ref를 `left_click(ref)`한 경우 다운로드가 발생하지 않은 적이 있어(자율행동체 1차) **좌표 클릭을 기본**으로 한다.
- Innogrid-ax처럼 "커넥터"·"스킬" 카드에도 "모두 보기"가 있다 → `innerText==='모두 보기'`인 **첫 버튼이 멤버**(DOM 순서: 멤버 → 스킬 → 커넥터). 잘못 열렸으면 우상단 X 또는 Escape로 닫고 다시.
- 조직 규모가 바뀐다: 08-27 기준 시트 Innogrid-ax 78·AIMS 13·AIPaaS 13·AI반도체 6·S1 39·S2 76·자율행동체 7. **S1·S2는 08-25부터 활동이 시작돼 내보내기가 가능**해졐고 조직 ID(S1 `3723fca1…`, S2 `7e5a2839…`)가 등록됐다. 새 조직 ID가 나오면 업로드 후 `/api/admin/claude-usage/orgs` PATCH(관리자 세션)로 이름·시트를 지정한다.
- 마지막 수집 시각은 `claude_csv_imports.created_at`에 남고, 대시보드 채팅·Cowork 탭 "업로드 이력"과 조직·설정 탭 "수집 상태"에 표시된다.
- 계정 메뉴 열기·조직 항목 클릭·"모두 보기"는 좌표/ref 클릭이 자주 무시된다 → `javascript_tool`로 `button[aria-label="계정 메뉴"]`에 pointerdown/mousedown/pointerup/mouseup/click을 dispatch하고, `[role="menuitemradio"]` 중 조직명이 포함된 항목에 같은 이벤트를 보내면 확실히 전환된다(전환 시 페이지가 이동해 JS 호출이 "navigated" 오류로 끝나는 것이 정상). "모두 보기"는 `innerText==='모두 보기'`인 첫 버튼을 `.click()`.
- **CSV 내보내기 버튼은 JS `.click()`으로는 다운로드가 발생하지 않는다** → 대화상자가 열린 뒤 `find`로 `button "CSV 내보내기"` ref를 얻어 `computer left_click(ref)` 또는 스크린샷 기준 좌표로 실제 클릭한다. JS `getBoundingClientRect` 좌표는 스크린샷 좌표와 다르므로(창 폭 ≠ 캡처 폭) 좌표는 반드시 스크린샷에서 읽는다.
- 대화상자 데이터가 로드될 때까지 2~3초 기다린 뒤 버튼 `disabled` 여부를 확인한다. 최근 30일 활동이 없는 조직(예: Innogrid_S1·S2)은 "활동 중인 멤버 0명"이고 버튼이 비활성 → 건너뛰고 보고한다.
- 다운로드 확인은 `ls -t ~/Downloads/members-analytics-*.csv | head -1`의 조직 ID가 바뀌었는지로 판단한다(조직당 2~3초).
