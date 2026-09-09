# RFP 분석 런북

설계: `docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md`(1단계) · `docs/superpowers/specs/2026-09-04-rfp-analyzer-phase2-design.md`(2단계) · `docs/superpowers/specs/2026-09-05-rfp-analyzer-phase3-design.md`(3단계) · `docs/superpowers/specs/2026-09-06-rfp-analyzer-phase4-design.md`(4단계) · 계획: `docs/superpowers/plans/2026-09-03-rfp-analyzer-phase1.md` · `docs/superpowers/plans/2026-09-04-rfp-analyzer-phase2.md` · `docs/superpowers/plans/2026-09-05-rfp-analyzer-phase3.md` · `docs/superpowers/plans/2026-09-06-rfp-analyzer-phase4.md`

## 구성

> 구현 전체 설명(파서·추출·카탈로그·매핑 단위·근거·데이터 모델·한계)은 [아키텍처 문서 `docs/rfp-analyzer-architecture.md`](./rfp-analyzer-architecture.md).
- 화면 `/rfp`(목록·업로드), `/rfp/[id]`(개요·요구사항 표). user 역할 이상.
- API `/api/rfp/*`. 파일은 브라우저가 Storage 버킷 `rfp`에 서명 URL로 직접 올린다(Vercel 4.5MB 제한 회피).
- 추출은 `after()`로 응답 뒤 실행(`maxDuration 300`). 표준 양식(첫 셀 "요구사항분류"/"요구사항구분"인 7행 표)은 규칙, 비표준만 Claude.
- 테이블 `rfp_projects`·`rfp_files`·`rfp_requirements` — SQL `docs/sql/2026-09-03-rfp-analyzer.sql`.

- **2단계(솔루션 매핑)**: 어드민 `/admin/rfp-catalog`에서 솔루션(SECloudit·Devopsit·AICubeit·TabCloudit·Openstackit 시드)마다 Confluence 페이지 URL을 등록해 "가져오기" → 서버가 페이지 id로 REST 조회 → Claude가 기능 목록 정리 → 카탈로그 병합(사람이 고친 ✎ 항목은 덮어쓰지 않음). 상세 화면 "솔루션 매핑 실행" → `after()`에서 카탈로그를 시스템 프롬프트(캐싱)로 넣고 요구사항 20건씩(동시 3) Claude 호출 → 요구사항별 0~N행(솔루션·기능·판정 충족/부분충족/설계·구축영역/해당없음·설명·근거 URL). 사람이 고친 행(✎)이 있는 요구사항은 재실행에서 제외. 테이블 `rfp_solutions`·`rfp_solution_sources`·`rfp_solution_features`·`rfp_requirement_mappings` + `rfp_projects.mapping_*` — SQL `docs/sql/2026-09-04-rfp-solution-mapping.sql`.

- **3단계(SharePoint 등록)**: 사용자가 `/settings`(또는 상세)에서 **Microsoft 계정을 연결**(OAuth 위임, 스코프 `offline_access User.Read Files.ReadWrite.All Sites.Read.All`, 앱 권한·관리자 동의 불필요) → 서버가 refresh 토큰을 AES-256-GCM(`MS_TOKEN_ENC_KEY`)으로 암호화해 `ms_connections`에 보관. 상세 화면 "SharePoint 등록" 섹션에서 Teams/SharePoint 폴더의 **'링크 복사' 값을 붙이면** Graph `shares/{u!…}/driveItem`으로 해석해 `rfp_projects.sharepoint_folder`에 저장(프로젝트 속성). "SharePoint에 업로드" → xlsx 다운로드와 같은 `buildProjectWorkbook` 결과를 그 폴더에 PUT(`conflictBehavior=replace`, 파일명 날짜 KST → 같은 날 덮어쓰기·SharePoint 버전 이력) → `rfp_sharepoint_uploads`에 이력 → `notify_provider=teams` 웹후크가 있으면 채널에 링크 알림(실패해도 업로드는 성공). 라이브러리 `frontend/src/lib/ms/`(crypto·oauth·config·origin·connections·graph-drive) + `lib/rfp/sharepoint.ts`. API `/api/ms/{connect,callback,connection}`, `/api/rfp/projects/[id]/sharepoint{,/folder,/upload}`. SQL `docs/sql/2026-09-05-rfp-sharepoint.sql`.

- **4단계(규칙 기반 카탈로그·매핑, LLM 폴백)**: `ANTHROPIC_API_KEY` 없이 동작한다. 어드민 소스는 **Confluence 페이지 URL**(규칙 파서: 표의 기능명 열·h2~h4 제목·글머리 `이름: 설명`)과 **SharePoint xlsx 기능명세서 링크**(가져오기 실행자의 Microsoft 위임 토큰으로 Graph에서 내려받아 exceljs로 헤더 탐지 — 기능명/설명/키워드 열) 두 종류이고, "Confluence에서 찾기" 패널로 제목 검색(CQL) 뒤 한 번에 등록할 수 있다. 가져오기는 기본 "규칙", 키가 있으면 "Claude로 보강". 기능마다 **키워드**(이름 토큰 + 설명 토큰 10개, 어드민 편집·↻ 재생성)를 둔다. 상세 "솔루션 매핑 실행" 다이얼로그에서 엔진(규칙 기본 / Claude)을 고른다. 규칙 엔진은 키워드 일치(이름 키워드 2, 나머지 1; 활성 기능의 5%를 넘게 쓰인 키워드는 제외) + 문자 bigram cosine 유사도(`|A∩B|/√(|A|·|B|)`)로 점수(`0.15×가중치 + 0.7×유사도`, 후보 조건 가중치≥2 또는 유사도≥0.5 — 운영 튜닝 2026-09-07)를 매겨 요구사항당(2026-09-07 이후 세부 항목당) 상위 N(어드민 설정 1~5, 기본 5·솔루션당 2)을 판정 **"후보"**(`candidate`)로 저장한다. 사람이 후보를 충족/부분충족 등으로 확정하고, 나중에 Claude로 다시 실행하면 후보는 교체되고 확정 행(✎)은 남는다. 매핑 행에 `engine`(rules|llm|manual)·`score`. 전체 목록에서 행을 펼치면 요구사항 정의·세부 내용·산출정보·관련 요구사항이 매핑 편집기 위에 함께 보인다(후보 확인용). SQL `docs/sql/2026-09-06-rfp-rules-mapping.sql`. 라이브러리 `lib/rfp/catalog/{source-kind,extract-rules,xlsx-features,keywords,confluence-search}.ts`, `lib/rfp/mapping/{tokenize,rules,engine}.ts`, `lib/ms/graph-drive.ts`(resolveItem·downloadFile), `lib/ms/route-token.ts`.

## 환경 변수
| 이름 | 용도 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 기존. DB·Storage 서버 접근 |
| `ANTHROPIC_API_KEY` | 비표준 RFP LLM 폴백 + 카탈로그 "Claude로 보강" + 매핑 엔진 "Claude". **선택** — 없으면 규칙 엔진만 동작하고 Claude 관련 버튼·엔진 선택이 화면에 나오지 않는다 |
| `RFP_LLM_MODEL` | 기본 `claude-opus-5` |
| `ATLASSIAN_SITE`·`ATLASSIAN_EMAIL`·`ATLASSIAN_API_TOKEN` | 기존(성과 지표와 공유). 카탈로그 Confluence 가져오기·Confluence 검색 패널. 없으면 가져오기·검색 400 |
| `MS_TOKEN_ENC_KEY` | 3단계. refresh 토큰 암호화 키(64자 hex, `openssl rand -hex 32`). 없으면 연결·업로드 500. **교체하면 모든 연결이 복호화 실패 → 재연결 안내**. (4단계) xlsx 소스 등록·가져오기에도 사용 |
| `MS_ALLOWED_ORIGINS` | 3단계(선택). OAuth 리디렉션 오리진 허용 목록(쉼표). 기본 `https://inje-playground.vercel.app,http://localhost:3003`. Entra 앱 리디렉션 URI와 짝을 맞춘다 |
| `TEAMS_GRAPH_CLIENT_SECRET` | 기존(Teams 멤버 Graph 방식과 공유). 3단계 토큰 교환·갱신에 필수. settings `teams_tenant_id`·`teams_graph_client_id`도 함께 필요. (4단계) xlsx 소스 등록·가져오기에도 사용 |

## 최초 설치
1. SQL 실행(Supabase SQL Editor 또는 Management API) → 테이블 3개 + 버킷 `rfp`(private, 50MB).
2. Vercel env에 `ANTHROPIC_API_KEY` 추가(선택).
3. 배포: `git push` 후 `vercel --prod`(자동 배포 아님).
4. (2단계) `docs/sql/2026-09-04-rfp-solution-mapping.sql` 실행 → 테이블 4개 + 시드 5건. Vercel env에 `ANTHROPIC_API_KEY`가 있어야 가져오기·매핑이 동작한다.
5. (2단계) 어드민 `/admin/rfp-catalog`에서 솔루션별 Confluence 페이지 URL 등록 → 가져오기 → 기능 표 검토(이름·설명 정리, 회의록성 항목 비활성).
6. (3단계) Entra 앱 등록(기존 Teams 앱) → 인증 → 플랫폼 "웹" 리디렉션 URI `https://inje-playground.vercel.app/api/ms/callback`, `http://localhost:3003/api/ms/callback` 추가. API 권한 → Microsoft Graph → **위임된 권한** `Files.ReadWrite.All`, `Sites.Read.All`, `User.Read`, `offline_access` 추가(관리자 동의 버튼은 누르지 않아도 된다. 테넌트가 사용자 동의를 막아 첫 연결에서 "관리자 승인 필요"가 뜨면 Application Administrator가 위임 권한에 동의 — 앱 권한과 달리 GA 불필요). 클라이언트 암호가 없으면 새로 만들어 `TEAMS_GRAPH_CLIENT_SECRET`에.
7. (3단계) `docs/sql/2026-09-05-rfp-sharepoint.sql` 실행 → `ms_connections`·`rfp_sharepoint_uploads` + `rfp_projects.sharepoint_folder`. Vercel env에 `MS_TOKEN_ENC_KEY`·`TEAMS_GRAPH_CLIENT_SECRET` 추가 후 재배포. 관리자 시스템 설정에 `teams_tenant_id`·`teams_graph_client_id` 확인.
8. (3단계) Teams 알림을 받으려면 `notify_provider=teams` + `teams_notify_webhook_url`(기존 채널 웹후크). 없어도 업로드는 되고 화면에 "Teams 알림 미설정"으로 표시된다.
9. (4단계) `docs/sql/2026-09-06-rfp-rules-mapping.sql` 실행 → `rfp_solution_features.keywords`, `rfp_solution_sources.kind|drive_id`, `rfp_requirement_mappings.verdict`에 candidate·`engine`·`score`(기존 자동 행은 `llm`으로 백필). 재배포.
10. (4단계) 어드민에서 등록된 소스 "가져오기(규칙)" → 기능 표에서 회의록성 항목 비활성·키워드 보강 → SharePoint xlsx 기능명세서 링크 등록·가져오기(등록자 Microsoft 계정 연결 필요) → 상세에서 "규칙" 매핑 → 후보 검토. 키가 들어오면 "Claude로 보강"·엔진 Claude로 재실행.

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

- (4단계) 규칙 엔진 상수는 `lib/rfp/mapping/rules.ts`의 `RULES`, 불용어는 `lib/rfp/mapping/tokenize.ts`의 `STOPWORDS`. 후보가 너무 많으면 임계값을 올리고, 너무 적으면 기능 키워드를 보강한다(어드민 기능 표 "키워드" 열). 후보는 판정일 뿐 확정이 아니므로 xlsx에도 "후보"로 나간다.
- (4단계) xlsx 소스는 **가져오기를 누른 사람**의 Microsoft 토큰으로 읽는다(3단계 업로드와 같은 권한 규칙). 미연결이면 400 + `/settings` 링크, 파일이 지워졌으면 그 소스만 "파일이 없습니다(삭제·이동)". 20MB 초과 파일은 등록이 거부된다. Confluence 검색은 제목만(`title ~`) 본다.
- (4단계) 규칙 파서는 표·제목·글머리에서 기능을 뽑기 때문에 회의록·일정 항목이 섞일 수 있다. 기능이 아닌 항목은 삭제 대신 비활성으로 두면 다음 가져오기가 다시 만들지 않는다(`name_norm` 유니크로 병합됨). `edited=false` 기능은 가져오기마다 키워드가 다시 시드된다. 버전 문자열(`v2.6`)·코드(`SEC-001`)만인 셀은 이름·설명에서 제외된다.

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

29. admin: 소스 입력에 SharePoint xlsx 링크 → 종류 `xlsx`·파일명 표시. Microsoft 미연결 계정으로는 400 문구 + "Microsoft 계정 연결" 링크. 폴더 링크는 "폴더 링크입니다" 400. 다른 호스트는 "Confluence 페이지 URL 또는 SharePoint 파일 링크만" 400.
30. "Confluence에서 찾기" → "기능명세서" 검색 → 결과 표 → "등록" → 소스 표에 추가되고 결과 행이 "등록됨"으로 바뀜.
31. "가져오기(규칙)" → 완료 → 기능 표에 기능·키워드, 소스 메모 "규칙 추출: 표 N·제목 M·글머리 K → 기능 X개"(xlsx는 "xlsx: 시트 N개 → 기능 X개"). 키 없으면 "Claude로 보강" 버튼이 표시되지 않는다.
32. 키워드 셀 편집(쉼표) → ✎ → 다시 가져오기 → 키워드 유지. ↻ → 이름·설명 기준으로 재생성(✎ 유지).
33. 상세 → "솔루션 매핑 실행" → 다이얼로그에 엔진 선택이 없고(키 없음 → 규칙 고정) "규칙(키워드) 엔진" 안내만 보임 → 실행 → 완료 → "후보 N" 칩, 행 펼침에 근거 "자동 매칭 — 일치 키워드: … · 유사도 0.xx"와 "자동(규칙) 0.xx".
34. 후보 행 판정을 충족으로 변경 → ✎ + "자동(규칙)" 유지 → "전체 다시 매핑"(규칙) → 그 요구사항은 그대로, 다른 요구사항의 후보는 교체.
35. xlsx 다운로드 → 판정 열 "후보", 개요 "후보 N건"과 솔루션 줄 "· 후보 K건", 요약 "SECloudit·IAM(후보)". SharePoint 업로드 파일도 같다.
36. (키 추가 후) "Claude로 보강" 버튼과 다이얼로그의 엔진 선택(규칙/Claude)이 나타남 → Claude로 매핑 실행 → 후보가 충족/부분충족/설계·구축영역/해당없음으로 교체, ✎ 행은 유지, 행 출처 "자동(Claude)".
37. 매핑이 끝난 프로젝트(mappingStatus ready 또는 매핑 행 있음)는 요구사항 ID 셀이 판정 색 버튼(요약 칩과 같은 색: 충족 초록·부분충족 노랑·후보 남색·설계·구축영역 하늘·해당없음 회색·미매핑 빨강) → 클릭하면 행이 펼쳐지고(다시 클릭 접힘, 펼친 버튼은 테두리 강조) ID 편집은 펼친 패널 헤더의 ID를 클릭. 매핑 전 프로젝트는 예전처럼 셀 클릭 편집. 개인용 화면(/rfp, /rfp/[id], /usage/*)은 어드민처럼 전체 너비.
38. 행 펼침 → 매핑 행의 근거가 URL 입력이 아니라 문서 카드(소스 페이지 제목 › 기능명, 기능 요약 2줄, 끝에 "바로가기")로 보임. 링크 아이콘을 누르면 URL 입력이 펼쳐지고 고친 뒤 blur로 저장, 체크 아이콘으로 닫힘. 기능이 없는 행(설계·구축영역·해당없음)은 URL 입력 그대로. 기능 이름·요약에 `&middot;` 같은 엔티티가 보이면 `docs/sql/2026-09-07-rfp-features-decode-entities.sql`이 적용되지 않은 것.
39. 구분 탭에 코드 옆 회색 분류명(총괄표의 "요구사항 구분"에서 괄호·끝의 "요구사항"을 뗀 것 — "CSR-MSA 클라우드 서비스 4"). `ECR-OOO-000`처럼 세부 자리를 O로 비운 부여규칙은 ECR-IFR·ECR-HWA·ECR-SWA 모두에 붙는다. 검색창에 "클라우드 서비스"나 영문명 "Cloud Service"를 치면 그 구분의 요구사항이 걸린다. 총괄표가 없는 문서는 요구사항 행의 구분 셀로 대체, 그것도 없으면 코드만.
40. 총괄표 건수 경고가 `총괄표 ECR-OOO 64건, 추출 64건`처럼 와일드카드 단위로 합산 비교된다(이전엔 ECR-OOO를 코드로 오해해 "총괄표에 없는 구분 ECR-IFR" 경고가 났다). 새 업로드·재추출은 `rfp_projects.category_summary`에 총괄표를 저장(SQL `2026-09-07-rfp-category-summary.sql`); 기존 프로젝트는 로컬 백필로 채웠다.
41. 구분 탭(열 10개)에서 표가 옆으로 스크롤되지 않는다(열 폭이 rem 비율 → %, 상세 시트 위치 셀은 break-all). 매핑 행은 **항상 2줄** — ① 판정·솔루션·기능 선택 + 그 줄 끝의 회색 요약("일치 키워드 … 유사도", 클릭하면 설명 편집 칸이 열린다) ② 소스 문서 카드. 창이 좁아지면 줄이 늘지 않고 기능 선택·요약이 잘린다(선택 줄은 flex-nowrap + overflow-hidden). 창 폭 1200px 미만에서 요약이 둘째 줄로 밀려 3줄이 되던 문제를 2026-09-07에 고쳤다.
42. 어드민 `/admin/rfp-catalog` 왼쪽 "솔루션 매핑 설정" 카드에서 요구사항당 최대 후보를 1~5로 지정(기본 5, 전역 settings 키 `rfp_mapping_max_candidates`, admin만 저장). 값을 바꾸면 다음 매핑 실행부터 적용되고 이미 만든 매핑은 그대로다. 상세 화면 "솔루션 매핑 실행" 다이얼로그의 규칙 엔진 설명에 그 값이 "요구사항당 후보를 최대 N개"로 표시된다. 빈 값·범위 밖·숫자 아님은 모두 기본 5로 보정(`lib/rfp/mapping/settings.ts` `parseMaxCandidates`). 같은 솔루션에서는 최대 2개까지만 고르므로 상한 5는 최소 3개 솔루션이 있어야 다 채워진다.
43. **엑셀 요건표(xlsx)**: `/rfp`에 견적요청서형 엑셀을 올리면 요건표 시트(헤더에 `항목`·`요구사항`·`검토항목` 열이 있는 시트)를 읽어 **한 행 = 한 요구사항**으로 등록한다. `구분` 열은 세로 병합돼 있어도 아래 행까지 채워지고, 코드는 라틴 문자 그대로(IaaS→IAAS, GPU→GPU) 또는 관용어(공통→COM)·표준 분류(보안→SEC)·한글 초성 순으로 만든다. `No.` 열이 있으면 `IAAS-001`처럼 그 번호를 쓴다. `답변`·`비고` 열은 **산출정보** 칸에 "답변: …/비고: …"로 모아 두는데, 이 칸은 매핑 입력에 쓰이지 않아 우리 답변이 후보 매칭을 흐리지 않는다. 요건표가 아닌 시트(물량·호환성 목록 등)는 건너뛰고 경고에 이름이 남는다. 엑셀은 표지가 없어 사업명은 파일명 폴백(개요에서 수정) — 셀 안 인용어를 사업명으로 잡지 않는다. 개요 배지는 "엑셀 요건표(규칙 추출)". 이후 xlsx 다운로드·솔루션 매핑·SharePoint 등록은 hwp와 동일하다. 숨긴 시트는 읽지 않는다. SQL `2026-09-07-rfp-xlsx-source.sql`(format·extraction_method 체크 제약에 xlsx 추가).
44. 상세 "솔루션 매핑 실행" 다이얼로그 맨 위에 **대상 솔루션 체크박스**(활성 기능이 있는 활성 솔루션, 옆에 활성 기능 수). 기본은 모두 체크이고 다이얼로그를 열 때마다 전체로 되돌아간다. "모두 해제/모두 선택" 링크, 0개면 실행 버튼이 잠긴다. 일부만 고르면 그 솔루션만 후보로 나오고(규칙·Claude 공통) 매핑 경고 첫 줄에 "대상 솔루션 2/5개: SECloudit, Openstackit"이 남는다. 전체 선택이면 코드를 보내지 않아 서버 기본값(활성 전체)을 쓴다. API `POST …/mapping {solutions: ["secloudit", …]}` — 없는 코드만 주면 400, 고른 솔루션에 활성 기능이 없으면 400.
45. **세부 항목 단위 매핑**(2026-09-07): 요구사항의 세부 내용이 목록이면 1단 항목마다 매핑한다(2depth면 하위 줄을 1단 항목에 묶어 한 단위). 목록이 아니면 예전처럼 요구사항 전체 한 단위(`detail_key` null). 규칙은 `lib/rfp/mapping/detail-items.ts` `parseDetailUnits` — 1단 글머리(○ ● □ ◇ ▶ ①… / "1)" "1." "가.")가 2개 이상이면 그 줄들이 단위, 1단이 없고 하위 글머리(- • · ※)만 2개 이상이면 그것을 1단으로 본다. 들여쓰기는 보지 않는다(hwp·엑셀 추출에서 줄마다 trim됨). 상한 30단위.
46. 판정 조합 규칙(충족/부분충족 vs 설계·구축영역/해당없음, 5행 상한)은 **단위마다 따로** 적용된다 — 항목1은 충족, 항목2는 해당없음이 공존할 수 있다. 매핑 후보 상한(어드민 1~5)도 단위마다다. 매핑 경고에 "세부 항목 N개는 매핑 결과 없음"이 남고, 요구사항 표 "당사 솔루션" 칸에는 "세부 3/8"이 노란색으로 붙는다(전부 채우면 회색).
47. **매핑 근거**: 규칙 엔진이 기능 설명에서 요구 텍스트와 가장 많이 겹치는 문장을 뽑아 `evidence_text`에 저장하고, 행 펼침의 문서 카드 둘째 줄에 "근거 …"로 보여준다. Claude 엔진은 프롬프트에서 인용 문장(`evidence`)과 세부 항목 번호(`detail`)를 함께 받는다. xlsx 솔루션_매핑 시트에 "세부 항목"·"근거 문장" 열이 추가됐다(SQL `2026-09-07-rfp-mapping-detail.sql`).
48. 매핑 편집기는 세부 항목별로 묶여 보인다 — 항목 번호·라벨 헤더 + 그 항목의 행 + 항목별 "행 추가"(수동 추가도 `detailKey`로 그 항목에 붙는다). 세부 내용을 나중에 고쳐 키가 사라진 행은 "(세부 내용이 바뀐 뒤 남은 매핑)"으로 따로 보이고 지워지지 않는다.
49. `/rfp` 목록은 한 페이지 10건이고 표 아래에 "1–10 / 24건"과 이전·페이지 번호·다음 버튼이 나온다(검색어를 바꾸면 1페이지로). 그 아래 "동작 방식과 매핑 정보 소스" 안내에 4단계 흐름·카탈로그 규모(활성 솔루션·기능 수)·후보 상한·근거·한계가 적히고, 숫자와 Claude 엔진 문구는 `GET /api/rfp/catalog` 응답에서 채운다. 업로드 영역은 한 줄(아이콘 + 문구 2줄)로 줄였다.
50. **원본 최신 여부 표시**(2026-09-07): 카탈로그 가져오기는 스냅샷이라 원본이 바뀌면 다시 가져와야 한다. 어드민 소스 표에 "원본 대비" 열이 생겨 화면을 열 때 자동으로 확인한다 — Confluence는 저장된 `page_version`과 현재 페이지 버전을, xlsx는 파일 `lastModifiedDateTime`과 `imported_at`을 비교한다(본문·파일은 내려받지 않는다). 상태는 최신(초록 체크) · 갱신 필요/가져오기 필요(주황 배지, 툴팁에 v3→v5나 수정 시각) · 확인 불가(권한·env 없음·Microsoft 미연결). 바뀐 소스가 있으면 제목 옆에 "원본이 바뀐 소스 N개 — 다시 가져오세요"가 뜨고, "최신 확인" 버튼으로 다시 확인한다. 가져오기가 끝나면 자동으로 재확인한다. API `GET /api/admin/rfp-catalog/solutions/[code]/sources/freshness`(동시 4개), 판정 규칙은 `lib/rfp/catalog/freshness.ts`.
51. **실행 레이어에서 후보 상한 지정**(2026-09-07): "솔루션 매핑 실행" 레이어에 "세부 항목당 최대 후보" 입력이 생겼다. 어드민 설정값이 기본으로 들어오고(옆에 "기본 N" 표시) 1~5로 바꿔 그 실행에만 적용한다(어드민 설정은 바뀌지 않는다). 레이어는 열 때마다 마운트되므로 대상 솔루션·엔진·상한이 항상 기본값으로 초기화된다. 범위 밖 값은 서버가 1~5로 보정한다.
52. **요구사항·세부 항목 단위 재실행**: 행 펼침의 매핑 편집기 헤더에 "다시 매핑"(그 요구사항 전체), 세부 항목 그룹 헤더마다 "다시 매핑"(그 항목만)이 있다. 같은 실행 레이어를 쓰고 대상만 다르다 — API `POST …/mapping {requirementIds:[…], detailKey?}`. 스코프 실행은 (1) edited 요구사항 제외 규칙을 적용하지 않고(사용자가 콕 집었으므로) 확인 다이얼로그도 뜨지 않으며, (2) 삭제·교체 범위가 스코프 안의 **자동 행**뿐이라 사람이 고친 행(✎)과 다른 세부 항목은 그대로 남는다. 매핑 경고 첫 줄에 "세부 항목 2만 다시 매핑"·"요구사항 1건만 다시 매핑"이 기록된다. `detailKey`는 요구사항을 한 건만 지정했을 때만 유효하다(아니면 400). 프로젝트 매핑이 실행 중이면 버튼이 잠긴다.
53. **"가져오기(규칙)"의 범위**: 등록된 소스만 다시 읽는다(Confluence를 새로 검색하지 않는다). 소스를 더 모으려면 "Confluence에서 찾기"를 쓴다 — 2026-09-07부터 (1) "본문까지 검색" 체크로 제목뿐 아니라 본문에 솔루션 이름이 있는 페이지까지 최대 50건 찾고, (2) "미등록 N개 모두 등록"으로 한꺼번에 소스로 등록하고(이미 등록된 pageId는 건너뜀, API `POST …/sources/bulk {urls[]}` 최대 50), (3) "등록 후 전체 가져오기(규칙) 실행"이 켜져 있으면 이어서 전체 소스를 가져온다. 본문 검색은 회의록·주간보고가 섞이니 결과를 보고 등록하고, 잡음 기능은 기능 표에서 비활성으로 돌린다.
54. **세부 매핑 가시성**(2026-09-07): 세부 항목 하나가 카드 하나다 — 헤더(순번 배지 + 항목 라벨 + 행 수 + 항목별 다시 매핑·행 추가)와 그 아래 행들이 한 테두리 안에 들어가고, 왼쪽 4px 강조선이 그 항목의 **가장 좋은 판정 색**(행이 없으면 미매핑 분홍)이라 어느 항목이 비었는지 먼저 보인다. 판정 선택 상자도 요약 칩·요구사항 ID 버튼과 같은 색(`VERDICT_CLASS`)을 쓴다. 근거 줄은 카드 속 카드를 만들지 않고 왼쪽 선으로만 들여쓰며, 근거 문장을 본문색으로·소스 문서 제목을 보조색으로 뒤집어 판단 근거가 먼저 읽힌다. 색 상수는 `components/rfp/MappingSummary.tsx`(`VERDICT_CLASS`·`VERDICT_ACCENT`) 한 곳뿐이다.
55. **xlsx 매핑 위치**(2026-09-07): 매핑은 요구사항 목록 시트가 아니라 **구분별 상세 시트**에 붙는다(화면 매핑 편집기와 같은 단위). 상세 시트는 매핑이 있으면 16열 — 요구사항(연번·ID·명칭·정의·산출정보·관련요구사항) → 세부 항목(항목 번호·세부 내용) → 매핑(판정·솔루션·기능·매핑 설명·근거 문장·근거 URL·비고·수정) 순서이고, 세부 항목마다 줄이 펼쳐지며 한 항목에 후보가 2개면 두 줄이다. 요구사항 칸은 그 요구사항의 모든 줄, 항목 칸은 그 항목의 매핑 줄만큼 **세로 병합**된다. 매핑이 없는 세부 항목도 판정 "미매핑" 한 줄로 남아 빈칸이 보인다. 요구사항 목록 시트는 요약만 — "당사 솔루션"은 세부 항목 단위 요구사항이면 롤업("충족 1건 · 후보 26건 — SECloudit, Devopsit", `mappingRollup`), 한 덩어리면 예전처럼 행 나열(`mappingSummary`)이고, "세부 항목 매핑"은 3/5(화면 배지와 같은 값). 화면 표의 "당사 솔루션" 칸도 같은 규칙이며 검색은 여전히 전체 요약(기능명 포함)을 훑는다. 마지막 `{n}.솔루션_매핑` 시트는 병합 없는 한 줄 = 한 매핑이라 필터·피벗용이다. 개요 시트에는 "세부 항목 매핑 2/3개 항목 (목록형 요구사항 1건)" 한 줄이 붙는다. 매핑을 아직 안 돌린 프로젝트의 상세 시트는 1단계와 같은 7열. 그룹핑은 `lib/rfp/mapping/detail-groups.ts` `groupRowsByDetail` 하나로 화면·시트가 공유한다.
56. **매핑 메모(비고)**(2026-09-07): 매핑 행 오른쪽 📝 버튼으로 행마다 메모를 적는다(2000자, 빈 값이면 지워짐). 적힌 메모는 접어도 행 아래 "비고" 줄로 보이고, 클릭하면 다시 편집된다. 메모는 엑셀 상세 시트와 솔루션_매핑 시트의 **"비고" 열**로 나간다. 자동 매핑은 이 칸을 채우지 않으며(판정 이유는 "매핑 설명"), 메모를 저장하면 그 행이 edited=true가 되어 다시 매핑해도 지워지지 않는다. API `PATCH /api/rfp/mappings/[id] {note}`, DB `rfp_requirement_mappings.note` — SQL `docs/sql/2026-09-07-rfp-mapping-note.sql`(운영 적용 완료).
57. **업로드 주체와 개인 설정**(2026-09-08): SharePoint 업로드는 항상 **누른 사람의 Microsoft 계정**(위임 권한)으로 이뤄진다 — `uploadProjectXlsx`가 `getAccessTokenForUser(admin, userId, …)`로 그 사용자의 refresh 토큰을 쓰므로 SharePoint의 "수정한 사람"도 그 사용자다(관리자 계정·앱 권한은 쓰지 않는다). 그래서 폴더도 사람마다 다를 수 있어 개인 설정에 **SharePoint 업로드 기본 폴더**를 둔다(`/settings`, user_settings `rfp_sharepoint_folder`): 프로젝트에 폴더가 지정돼 있으면 그것이 우선, 없으면 기본 폴더로 올라가고 상세 화면이 "프로젝트 폴더가 없어 내 기본 폴더로 올라갑니다 — 폴더명"으로 알려 준다. 둘 다 없으면 예전처럼 `no_folder`로 막는다. 링크 해석·검증은 프로젝트 폴더와 같은 코드(`lib/ms/folder-route.ts`).
58. **개인 알림 채널**(2026-09-08): `/settings`의 "알림 채널(개인 워크플로우 URL)"에 Teams 워크플로우 트리거 URL을 넣으면 **내가 만든 알림**(RFP SharePoint 업로드·팀 구성 결과)이 관리자 전역 채널 대신 그 채널로 간다(`personalNotifyOverrides` — 개인 URL이 있으면 provider도 teams로 덮어쓴다). "테스트 전송"으로 한 건 보내 확인할 수 있고, 해제하면 전역 채널로 돌아간다. URL은 https 공개 주소만 받고 사내망·로컬·메타데이터 주소(127.*·10.*·192.168.*·169.254.*·*.internal 등)는 거부한다(`lib/notify/url-guard.ts`, 서버가 그 주소로 POST하므로 SSRF 방지). 감사 로그에는 URL 대신 호스트만 남는다.
59. **2026-09-08 리뷰 반영(6건)**: 전문 에이전트 6개(아키텍처·보안·오류처리·성능·테스트·프론트엔드)로 전반 리뷰한 뒤 다음을 고쳤다.
    1. **글머리 문자 집합**: `◦`(U+25E6)·`ㅇ`·`►`를 1단 글머리에, `▫`·`・`를 하위 글머리에 추가(`mapping/detail-items.ts`). 이 문자가 빠져 있어 `◦`를 쓰는 제안요청서는 세부 항목이 분해되지 않고 요구사항 단위로 퇴화했다(운영 실측: 한 프로젝트 124건 중 123건, 매핑 560행 전부 `detail_key` null). 같은 리포의 `overview.ts`·`extract-xlsx.ts`는 이미 이 문자를 글머리로 취급하고 있었다. **이미 만들어진 요구사항 단위 매핑 행은 그대로 남아 "요구사항 전체" 그룹으로 보이므로, 해당 프로젝트는 세부 항목 매핑을 다시 실행해야 한다.**
    2. **업로드 경로 검증**(보안): 등록 라우트가 `uploads/` 접두사만 보던 것을 `UPLOAD_PATH_RE`(`uploads/{uuid}/{uuid}.{ext}`)로 고정(`lib/rfp/parse.ts`, `registerProject`에도 이중 검사). 접두사만 검사하면 `uploads/../../<다른 버킷>/x.docx`가 통과하고 URL 정규화가 `..`·`%2e%2e`를 접어 service role로 다른 버킷 객체를 읽고 서명 URL까지 발급할 수 있었다.
    3. **개인 설정 우회 차단**(보안): `PUT /api/users/settings`에 키 화이트리스트(dooray 5개)를 두고 검증이 필요한 키(`teams_notify_webhook_url`·`rfp_sharepoint_folder`)는 전용 라우트만 쓰게 했다. 또 Teams notifier가 원격 응답 본문을 오류 문구에 담지 않도록 바꿔(서버 로그에만) 개인 웹훅을 통한 응답 반사를 없애고, 발송 직전에 URL을 한 번 더 검사하며(`personalNotifyOverrides`), `redirect: "manual"`로 리다이렉트 추종을 막았다. URL 가드는 IP 리터럴(IPv4·IPv6 전부)·점 없는 단일 라벨·사설 접미사를 거부하는 규칙으로 바꿨다(`[::ffff:127.0.0.1]`·후행 점 우회 차단).
    4. **판정 규칙의 형제 범위**: `loadDetailSiblings`(`mapping/siblings.ts`)를 만들어 행 추가(POST)와 수정(PATCH)이 **같은 세부 항목의 행만** 형제로 보게 통일했다. 그전에는 PATCH가 요구사항 전체를 형제로 봐서, 항목마다 후보가 깔린 정상 상태에서 "해당없음" 확정이나 다른 항목과 같은 기능의 "충족" 확정이 400으로 거부됐다.
    5. **재추출의 매핑 손실**: 요구사항을 교체하면 매핑 행이 FK cascade로 사라지므로 `runExtraction`이 `mapping_status`를 `none`으로 되돌린다(전에는 행 0건인데 "매핑 완료"로 표시). 확인 문구도 매핑 행 수·직접 확정 행 수를 세어 "재추출하면 편집한 요구사항 N건, 솔루션 매핑 M행(직접 확정 K행 포함)이 사라진다"로 바꿨고, 매핑 실행 중에는 재추출을 서버·화면 양쪽에서 막는다(요구사항이 갈리면 유령 행이 남는다).
    6. **청크 부분 실패**: 한 청크가 실패하면 `mapping_status`를 `failed`로 끝내고(끝난 청크의 행은 유지) 어떤 요구사항이 미매핑으로 남았는지 오류 문구에 남긴다. 실패 문구는 경고 배열 맨 앞에 모아 200건 절단에서 살아남게 했다. 전에는 한 청크만 성공해도 "매핑 완료"였고, 실패 청크의 요구사항은 삭제만 되고 새 행이 없어 조용히 미매핑이 됐다.
    남은 리뷰 지적(미착수): 상세 API payload 얕게(1.74MB), LLM 엔진 동시성 역산(241건에서 300초 초과), `selectAll` 미적용 4곳(`rfp_files` 우선), 카탈로그 편집 검증의 전량 조회, 가져오기 N+1 UPDATE, `detail_key` 위치 기반 오배치, stale running 상태 보정, 화면 스냅샷 갱신(lost update)·저장 실패 시 입력 소실·`EditableCell` 키보드 접근성, `runMapping`/`runImport` 잡 본체 테스트.
60. **공유 링크**(2026-09-09): 프로젝트를 등록한 사람(또는 admin)이 상세 화면 "공유 링크" 카드에서 읽기 전용 링크를 만든다. 만들 때 공개 범위를 고른다 — **공개(public)**는 로그인 없이 열리고(사외 공유용), **사내(private)**는 링크가 있어도 우리 계정으로 로그인해야 열린다(라우트가 401 `{code:"login_required"}`을 주고 화면이 로그인 버튼을 보여 준다). 만들면 링크가 클립보드에 복사되고, 목록에 열람 횟수·최근 열람 시각이 표시되며, **폐기**하면 그 링크는 즉시 열리지 않는다(행 삭제). 프로젝트당 10개까지.
    - 열람 화면 `/rfp/shared/{token}`: 개요·판정 요약 칩·요구사항 목록(검색·행 펼침)·세부 항목별 매핑을 본다. 편집·업로드·원본 다운로드·xlsx는 없다 — 서버 payload(`toSharedProject`)에 파일·SharePoint·소유자 정보가 아예 없다.
    - **공개 링크는 근거 URL(사내 Confluence 주소)과 비고(내부 메모)를 감춘다.** 사내 링크는 둘 다 보여 준다.
    - 토큰은 URL 자체가 열람 권한(capability URL)이라 감사 로그·서버 로그에 남기지 않는다(감사에는 링크 id와 공개 범위만: "공유 링크 생성"·"공유 링크 폐기"). 열람은 링크 행의 카운터로만 센다.
    - 경로 공개는 proxy의 `PUBLIC_PREFIXES`에 `/rfp/shared`를 넣어 처리한다(로그인 리다이렉트·역할 검사 모두 건너뜀 — guest 계정도 공개 링크를 볼 수 있어야 한다). 링크 URL 오리진은 `MS_ALLOWED_ORIGINS` 허용 목록으로 고정한다(`x-forwarded-host`를 그대로 믿지 않는다).
    - API: `GET·POST /api/rfp/projects/[id]/shares`(소유자·admin), `DELETE /api/rfp/shares/[shareId]`(소유자·admin), `GET /api/rfp/shared/[token]`(**인증 없음**, `Cache-Control: no-store`). DB `rfp_share_links` + RPC `rfp_share_link_viewed` — SQL `docs/sql/2026-09-09-rfp-share-links.sql`(운영 적용 완료).
