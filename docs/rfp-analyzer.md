# RFP 분석 런북

설계: `docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md`(1단계) · `docs/superpowers/specs/2026-09-04-rfp-analyzer-phase2-design.md`(2단계) · `docs/superpowers/specs/2026-09-05-rfp-analyzer-phase3-design.md`(3단계) · 계획: `docs/superpowers/plans/2026-09-03-rfp-analyzer-phase1.md` · `docs/superpowers/plans/2026-09-04-rfp-analyzer-phase2.md` · `docs/superpowers/plans/2026-09-05-rfp-analyzer-phase3.md`

## 구성
- 화면 `/rfp`(목록·업로드), `/rfp/[id]`(개요·요구사항 표). user 역할 이상.
- API `/api/rfp/*`. 파일은 브라우저가 Storage 버킷 `rfp`에 서명 URL로 직접 올린다(Vercel 4.5MB 제한 회피).
- 추출은 `after()`로 응답 뒤 실행(`maxDuration 300`). 표준 양식(첫 셀 "요구사항분류"/"요구사항구분"인 7행 표)은 규칙, 비표준만 Claude.
- 테이블 `rfp_projects`·`rfp_files`·`rfp_requirements` — SQL `docs/sql/2026-09-03-rfp-analyzer.sql`.

- **2단계(솔루션 매핑)**: 어드민 `/admin/rfp-catalog`에서 솔루션(SECloudit·Devopsit·AICubeit·TabCloudit·Openstackit 시드)마다 Confluence 페이지 URL을 등록해 "가져오기" → 서버가 페이지 id로 REST 조회 → Claude가 기능 목록 정리 → 카탈로그 병합(사람이 고친 ✎ 항목은 덮어쓰지 않음). 상세 화면 "솔루션 매핑 실행" → `after()`에서 카탈로그를 시스템 프롬프트(캐싱)로 넣고 요구사항 20건씩(동시 3) Claude 호출 → 요구사항별 0~N행(솔루션·기능·판정 충족/부분충족/설계·구축영역/해당없음·설명·근거 URL). 사람이 고친 행(✎)이 있는 요구사항은 재실행에서 제외. 테이블 `rfp_solutions`·`rfp_solution_sources`·`rfp_solution_features`·`rfp_requirement_mappings` + `rfp_projects.mapping_*` — SQL `docs/sql/2026-09-04-rfp-solution-mapping.sql`.

- **3단계(SharePoint 등록)**: 사용자가 `/settings`(또는 상세)에서 **Microsoft 계정을 연결**(OAuth 위임, 스코프 `offline_access User.Read Files.ReadWrite.All Sites.Read.All`, 앱 권한·관리자 동의 불필요) → 서버가 refresh 토큰을 AES-256-GCM(`MS_TOKEN_ENC_KEY`)으로 암호화해 `ms_connections`에 보관. 상세 화면 "SharePoint 등록" 섹션에서 Teams/SharePoint 폴더의 **'링크 복사' 값을 붙이면** Graph `shares/{u!…}/driveItem`으로 해석해 `rfp_projects.sharepoint_folder`에 저장(프로젝트 속성). "SharePoint에 업로드" → xlsx 다운로드와 같은 `buildProjectWorkbook` 결과를 그 폴더에 PUT(`conflictBehavior=replace`, 파일명 날짜 KST → 같은 날 덮어쓰기·SharePoint 버전 이력) → `rfp_sharepoint_uploads`에 이력 → `notify_provider=teams` 웹후크가 있으면 채널에 링크 알림(실패해도 업로드는 성공). 라이브러리 `frontend/src/lib/ms/`(crypto·oauth·config·origin·connections·graph-drive) + `lib/rfp/sharepoint.ts`. API `/api/ms/{connect,callback,connection}`, `/api/rfp/projects/[id]/sharepoint{,/folder,/upload}`. SQL `docs/sql/2026-09-05-rfp-sharepoint.sql`.

## 환경 변수
| 이름 | 용도 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 기존. DB·Storage 서버 접근 |
| `ANTHROPIC_API_KEY` | 비표준 RFP LLM 폴백 + 2단계 카탈로그 가져오기·솔루션 매핑. 없으면 표준 양식 추출만 동작 |
| `RFP_LLM_MODEL` | 기본 `claude-opus-5` |
| `ATLASSIAN_SITE`·`ATLASSIAN_EMAIL`·`ATLASSIAN_API_TOKEN` | 기존(성과 지표와 공유). 카탈로그 Confluence 가져오기. 없으면 가져오기 400 |
| `MS_TOKEN_ENC_KEY` | 3단계. refresh 토큰 암호화 키(64자 hex, `openssl rand -hex 32`). 없으면 연결·업로드 500. **교체하면 모든 연결이 복호화 실패 → 재연결 안내** |
| `MS_ALLOWED_ORIGINS` | 3단계(선택). OAuth 리디렉션 오리진 허용 목록(쉼표). 기본 `https://inje-playground.vercel.app,http://localhost:3003`. Entra 앱 리디렉션 URI와 짝을 맞춘다 |
| `TEAMS_GRAPH_CLIENT_SECRET` | 기존(Teams 멤버 Graph 방식과 공유). 3단계 토큰 교환·갱신에 필수. settings `teams_tenant_id`·`teams_graph_client_id`도 함께 필요 |

## 최초 설치
1. SQL 실행(Supabase SQL Editor 또는 Management API) → 테이블 3개 + 버킷 `rfp`(private, 50MB).
2. Vercel env에 `ANTHROPIC_API_KEY` 추가(선택).
3. 배포: `git push` 후 `vercel --prod`(자동 배포 아님).
4. (2단계) `docs/sql/2026-09-04-rfp-solution-mapping.sql` 실행 → 테이블 4개 + 시드 5건. Vercel env에 `ANTHROPIC_API_KEY`가 있어야 가져오기·매핑이 동작한다.
5. (2단계) 어드민 `/admin/rfp-catalog`에서 솔루션별 Confluence 페이지 URL 등록 → 가져오기 → 기능 표 검토(이름·설명 정리, 회의록성 항목 비활성).
6. (3단계) Entra 앱 등록(기존 Teams 앱) → 인증 → 플랫폼 "웹" 리디렉션 URI `https://inje-playground.vercel.app/api/ms/callback`, `http://localhost:3003/api/ms/callback` 추가. API 권한 → Microsoft Graph → **위임된 권한** `Files.ReadWrite.All`, `Sites.Read.All`, `User.Read`, `offline_access` 추가(관리자 동의 버튼은 누르지 않아도 된다. 테넌트가 사용자 동의를 막아 첫 연결에서 "관리자 승인 필요"가 뜨면 Application Administrator가 위임 권한에 동의 — 앱 권한과 달리 GA 불필요). 클라이언트 암호가 없으면 새로 만들어 `TEAMS_GRAPH_CLIENT_SECRET`에.
7. (3단계) `docs/sql/2026-09-05-rfp-sharepoint.sql` 실행 → `ms_connections`·`rfp_sharepoint_uploads` + `rfp_projects.sharepoint_folder`. Vercel env에 `MS_TOKEN_ENC_KEY`·`TEAMS_GRAPH_CLIENT_SECRET` 추가 후 재배포. 관리자 시스템 설정에 `teams_tenant_id`·`teams_graph_client_id` 확인.
8. (3단계) Teams 알림을 받으려면 `notify_provider=teams` + `teams_notify_webhook_url`(기존 채널 웹후크). 없어도 업로드는 되고 화면에 "Teams 알림 미설정"으로 표시된다.

## 운영 메모
- 지원 형식: hwp(5.x, 암호화·배포용 제외), hwpx, docx. 스캔 이미지 문서는 요구사항이 나오지 않는다.
- 중복 판단: 파일 sha256(서버가 Storage에서 내려받은 바이트로 계산하며, 등록 요청에 클라이언트가 보낸 값은 없다) 또는 정규화한 사업명+발주기관 일치. 사업명 정규화는 공백·기호·괄호 문자만 제거하고 괄호 안 내용은 유지하며(재공고·차수 등 접미어는 유사 판단에서만 별도로 제거), 발주기관 정규화는 괄호 안 내용(예: "(이하 OO)")과 법인 표기를 제거한다. 유사하면 화면에서 사용자 확인.
- 유사 확인창에서 "취소"하면 Storage `uploads/…`에 고아 파일이 남는다. 주기적으로 `rfp_files.storage_path`에 없는 객체를 지운다(수동).
- 추출이 3분 넘게 `extracting`이면 화면이 안내한다. 6분 넘게 `extracting`이면(after()가 5분 제한에 걸려 죽었다고 보고) 재추출 버튼이 다시 활성화되며, 재추출 API도 같은 기준으로 409 없이 재시도를 받아준다.
- 요구사항은 프로젝트당 수백 건이라 Supabase 1000행 상한에 걸리지 않는다. 넘길 가능성이 생기면 `selectAll` 사용.

- 매핑 프롬프트에는 UUID 대신 `S{n}`/`F{n}` 별칭을 쓰고 서버가 되돌린다. 없는 별칭·청크에 없는 ID는 버리고 `mapping_warnings`에 남는다.
- 매핑은 청크마다 즉시 저장한다. `running`이 6분 넘으면(after()가 300초 제한에 죽었다고 보고) 버튼이 다시 살아나며 "미매핑만"으로 이어서 할 수 있다. 가져오기도 소스 단위로 같은 규칙.
- 카탈로그 기능·솔루션은 매핑이 참조하면 삭제(409) 대신 비활성으로 바꾼다. 비활성 기능은 콤보에서 사라지지만 기존 매핑 표시는 `[비활성]`으로 남는다.
- Confluence URL은 `ATLASSIAN_SITE` 호스트의 `/wiki/spaces/{KEY}/pages/{id}`·`/wiki/pages/viewpage.action?pageId=`·`/wiki/pages/{id}`만 받는다. 짧은 링크(`/wiki/x/…`)는 페이지를 열어 전체 URL을 복사한다.
- xlsx: `1.요구사항_목록`에 매핑 5열(솔루션·기능·판정·매핑 설명·근거 URL, 여러 행은 셀 안 줄바꿈), `0.개요`에 "3. 솔루션 매핑 요약", 마지막 시트 `{n}.솔루션_매핑`(매핑 1행 = 1줄, 미매핑 포함, 수정 표시). 상세 시트 번호는 1단계 그대로.
- 비용 감: 카탈로그 ~1만 토큰 캐시 + 청크 7회(124건). 프로젝트당 1달러 미만 추정. 상세 화면에는 비용을 표시하지 않는다.

- (3단계) 연결은 사용자당 1행. 다른 계정으로 다시 연결하면 교체된다. 해제해도 프로젝트의 폴더 설정과 업로드 이력은 남는다. 업로드 권한은 Graph가 **업로더 계정** 기준으로 판정하므로, 다른 사람이 지정한 폴더라도 내 계정에 쓰기 권한이 없으면 403.
- (3단계) refresh 실패 코드(`invalid_grant`·`interaction_required`·`consent_required`)와 복호화 실패(`decrypt`)는 `ms_connections.last_error`에 남고 화면은 "다시 연결"을 띄운다. 그 외 Azure 오류는 502. Graph 429·503은 Retry-After(기본 2초, 최대 5초) 뒤 1회 재시도하고, 그래도 실패하면 502 "SharePoint 응답 오류(NNN)". 서버 로그에는 오류 코드·상태·`request-id`만 남는다(토큰·시크릿·error_description은 클라이언트에 나가지 않는다).
- (3단계) 폴더 링크는 `https://`만, 파일 링크는 "폴더 링크가 아닙니다" 400. 폴더가 삭제·이동되면 업로드 404 "폴더가 없습니다(삭제·이동)" — 폴더 설정은 그대로 두고 다시 지정한다. 파일이 열려 잠겨 있으면(423) 409 "파일이 열려 있어 덮어쓸 수 없습니다".
- (3단계) 파일명 날짜가 KST로 바뀌어 xlsx 다운로드도 함께 KST를 쓴다(Vercel UTC에서 밤 시간대 하루 어긋남 해소). 4MiB 미만은 단순 PUT, 이상은 업로드 세션(10MiB 청크). 업로드 라우트 `maxDuration 60`.

## 수동 회귀 체크리스트
1. user 계정으로 `/rfp` 진입, 내비·홈 카드 노출.
2. 샘플 `제안요청서.hwp` 업로드 → 상세 이동 → 완료, 124건, 경고 없음, 추출 방식 "표준 양식".
3. 같은 파일 재업로드 → "이미 등록된 프로젝트" → 상세 이동.
4. 사업명만 살짝 바꾼 hwpx/docx(있으면) 업로드 → 유사 확인창 → 새로 등록 / 기존 이동.
5. 개요 셀·요구사항 셀 편집 → 새로고침 후 유지. 잘못된 ID는 오류 후 복귀.
6. 행 추가(자동 번호)·삭제 → 건수 반영.
7. 재추출(편집 있음) → 확인창 → 완료 후 편집 사라짐.
8. xlsx 다운로드 → 시트 `0.개요, 1.요구사항_목록, 2.SER … 18.COR`.
9. 등록자 아닌 user로 삭제 버튼이 안 보이고, admin은 보임.
10. `.doc`·`.pdf`·60MB 파일은 업로드 단계에서 거부 메시지.

11. admin으로 `/admin/rfp-catalog` 진입 → 5개 솔루션 보임 → SECloudit 선택 → 설명 인라인 편집 → 새로고침 후 유지.
12. Confluence 페이지 URL 추가(다른 호스트·`/x/` 링크는 400 문구) → "전체 가져오기" → 상태 "가져오는 중" → 완료 → 기능 표에 항목, 소스 행에 제목·버전·기능 수.
13. 기능 이름 수정(✎ 표시) → 다시 가져오기 → 수정한 이름 유지, 소스 메모 "사람이 고친 기능 N개는 유지".
14. 기능 비활성 토글 → 상세 화면 콤보에서 사라짐. 매핑이 참조하는 기능 삭제 → 409 안내.
15. 샘플 프로젝트 상세 → "솔루션 매핑 실행" → 배지 "매핑 중" → 완료 → 판정 칩 건수 합 = 요구사항 수, 목록 "매핑 완료".
16. 행 펼침 → 판정 변경·기능 변경·설명 입력 → 새로고침 후 유지, ✎ 표시. build/na로 바꾸면 솔루션·기능 비활성화.
17. 행 추가(부분충족 → 솔루션 → 기능 고르면 추가) → 같은 기능 중복 추가 시 400 문구. build 행이 있는 요구사항에 충족 추가 시 400 문구.
18. "솔루션 매핑 실행" 다시 → 다이얼로그 "전체 다시 매핑 / 미매핑 N건만" → 전체 → 확인창(사람이 고친 요구사항 건너뜀) → 완료 후 ✎ 행 그대로.
19. 판정 칩 클릭 → 표 필터, 다시 클릭 → 해제. 검색에 솔루션명 입력 → 매핑 요약으로도 걸러짐.
20. xlsx 다운로드 → 목록 시트 11열, 마지막 시트 `19.솔루션_매핑`(샘플은 상세 17개), 개요 "3. 솔루션 매핑 요약".

21. `/settings` → "Microsoft 계정" 카드 → "Microsoft 계정 연결" → Azure 로그인·동의 → `/settings?ms_connected=1`로 복귀, 카드에 계정 이름·UPN·연결 시각, 주소에서 쿼리가 사라짐. `GET /api/ms/connection` 응답에 토큰 필드 없음.
22. 동의 화면에서 "취소" → `ms_error=연결이 취소되었습니다.` 문구 표시. `state`를 고쳐 콜백을 열면 "연결 요청이 만료되었습니다".
23. 샘플 프로젝트 상세 → "SharePoint 등록" 섹션 → 파일 링크를 붙이면 400 "폴더 링크가 아닙니다"; 폴더 '링크 복사' 값을 붙이면 폴더명·"폴더 열기"(새 탭) 표시. 새로고침 후 유지. 다른 사용자로 열어도 같은 폴더가 보인다(프로젝트 속성).
24. "SharePoint에 업로드" → 스피너 → "업로드 완료 — (발주기관) 사업명_요구사항 검토_YYYYMMDD.xlsx" + Teams 알림 문구. SharePoint 폴더에 파일이 있고, 열면 xlsx 다운로드와 같은 시트 구성(매핑 시트 포함).
25. 같은 날 다시 업로드 → 파일이 하나(덮어쓰기), SharePoint 버전 기록 +1, 이력은 2건. 날짜가 바뀌면(서버 날짜를 바꾸거나 다음 날) 새 파일.
26. Teams 채널에 "[RFP] {사업명} 요구사항 검토 파일을 SharePoint에 올렸습니다 — {이름} · {폴더명}" 카드 + 파일명 + 링크. `teams_notify_webhook_url`을 비우면 "Teams 알림 미설정(웹후크 없음)"이지만 업로드는 성공.
27. `/settings`에서 "해제" → 상세 업로드 행이 "Microsoft 계정 연결" 버튼으로 바뀜(`not_connected`); 폴더 설정·이력은 그대로. 상세에서 연결하면 상세 경로로 복귀(`returnTo`).
28. Vercel env `MS_TOKEN_ENC_KEY`를 다른 값으로 바꾼 뒤(테스트 환경) 업로드 → 409 "연결이 만료되었습니다" + "다시 연결" 버튼, `last_error=decrypt`. 되돌리고 재연결하면 정상.
