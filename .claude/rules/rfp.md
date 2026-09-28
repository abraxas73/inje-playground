---
paths:
  - "frontend/src/app/rfp/**"
  - "frontend/src/app/admin/rfp-catalog/**"
  - "frontend/src/app/api/rfp/**"
  - "frontend/src/app/api/admin/rfp-catalog/**"
  - "frontend/src/app/api/ms/**"
  - "frontend/src/lib/rfp/**"
  - "frontend/src/lib/ms/**"
  - "frontend/src/lib/__tests__/rfp-*"
  - "frontend/src/components/rfp/**"
  - "frontend/src/components/admin/rfp-catalog/**"
  - "frontend/src/types/rfp.ts"
  - "frontend/src/types/ms.ts"
  - "docs/rfp-analyzer*.md"
  - "docs/sql/*rfp*"
---
# RFP 분석 (기능 상세)

루트 CLAUDE.md의 기능별 보완 지침. 이 경로의 파일을 다룰 때 자동으로 로드된다. 런북 `docs/rfp-analyzer.md`, 아키텍처 `docs/rfp-analyzer-architecture.md`.

## 페이지
- `/rfp/shared/[token]` — 공유된 RFP 분석 결과(**로그인 불필요**, 읽기 전용): 개요·판정 요약·요구사항 목록·세부 항목별 매핑. 공개 링크는 근거 URL·비고를 감추고, 사내 링크는 로그인 후 열린다
- `/rfp/[id]/review` — **확정 작업**(리뷰 큐, user): 매핑 단위(요구사항 × 세부 항목)를 하나씩 넘기며 후보 중 하나를 충족/부분충족으로 확정하거나 설계·구축영역/해당없음으로 닫는다(키보드 j/k·1/2·b/n·←/→). 진행률 = 확정 단위/전체 단위. "이전 확정 제안" 카드가 다른 요구사항에서 사람이 확정한 매핑 중 문장이 비슷한 것을 보여주고 한 번에 적용한다. `components/rfp/ReviewQueue.tsx`, 단위·상태 정의는 `lib/rfp/mapping/review.ts`
- `/rfp`, `/rfp/[id]` — RFP 분석(user): 목록 10건 페이징 + 하단 "동작 방식과 매핑 정보 소스" 안내(`components/rfp/HowItWorks.tsx`, 카탈로그 규모·후보 상한은 `/api/rfp/catalog`에서), 제안요청서(hwp·hwpx·docx·**pdf** — PDF는 표 구조가 없어 괘선으로 표를 복원, 스캔 이미지 PDF는 거절) 또는 엑셀 요건표(xlsx — 견적요청서·기술검토표처럼 한 행 = 한 요구사항) 업로드 → 프로젝트 등록(중복 판단) → 요구사항 표(TanStack Table 셀 편집·행 추가/삭제; 구분 탭에 총괄표 분류명 표시·검색 — `lib/rfp/category-summary.ts`; 매핑 후 요구사항 ID는 판정 색 버튼 → 클릭 시 행 펼침, ID 편집은 펼친 패널 헤더) → xlsx 다운로드(매핑은 요구사항 목록이 아니라 **구분별 상세 시트의 세부 항목 행**에 붙고 요구사항·항목 칸은 세로 병합 — 화면과 같은 단위, 목록 시트는 "당사 솔루션"·"세부 항목 매핑 3/5" 요약, 마지막 솔루션_매핑 시트는 병합 없는 한 줄 = 한 매핑, 그 뒤 **요구사항_대응표**(제안서 부속 초안 — 단위마다 확정 판정·대응 솔루션/기능/방안, 후보는 "검토 대기")·**Gap_리포트**(충족이 아닌 단위만, 설계·구축영역→해당없음→부분충족→검토 대기→미매핑 순 + 상태별 건수) 시트) → 솔루션 매핑(공용 실행 레이어 `MappingRunDialog` — 대상 솔루션 체크박스(기본 모두)·후보 상한 1~5(어드민 값 기본)·엔진 규칙(키워드, 기본)/Claude 선택, 스코프는 프로젝트 전체/요구사항/세부 항목, **세부 항목(세부 내용 1단 리스트, 2depth는 1단으로 묶음)마다** 판정 충족/부분충족/후보/설계·구축영역/해당없음, 행 펼침 편집은 세부 항목별 카드(왼쪽 강조선 = 그 항목의 최상 판정 색, 판정 선택도 같은 색) — 근거는 근거 문장(`evidence_text`)을 앞세우고 소스 문서 제목·기능명은 보조색 + 바로가기, 행마다 메모(`note`, 📝 버튼 → 엑셀 "비고" 열)) → 공유 링크(등록자·admin이 공개/사내 범위를 골라 생성·폐기, `components/rfp/ShareLinkSection.tsx`) → SharePoint 등록(3단계: 상세 "SharePoint 등록" 섹션에서 폴더 '링크 복사' 값 지정, **없으면 개인 설정의 기본 폴더**로 올라간다(섹션에 어디로 가는지 표시) → 같은 xlsx를 **각 사용자의 위임 권한**으로 업로드(같은 날 덮어쓰기 — SharePoint 수정자도 그 사용자) → 이력·Teams 채널 알림(개인 워크플로우 URL이 있으면 그 채널)). 런북 `docs/rfp-analyzer.md`, 아키텍처 `docs/rfp-analyzer-architecture.md`
- `/admin/rfp-catalog` — RFP 솔루션 카탈로그(admin): 솔루션(SECloudit·Devopsit·AICubeit·TabCloudit·Openstackit) · 소스 등록(Confluence 페이지 URL 또는 SharePoint xlsx 링크, "Confluence에서 찾기" 제목·본문 검색 + "미등록 모두 등록"(`POST …/sources/bulk`)·등록 후 전체 가져오기, 소스 표 "원본 대비" 열이 Confluence 페이지 버전·xlsx 수정 시각을 비교해 최신/갱신 필요 자동 표시 — `GET …/sources/freshness`, `lib/rfp/catalog/freshness.ts`) · 가져오기(규칙 파서 기본, `ANTHROPIC_API_KEY` 있으면 "Claude로 보강"; ✎ 편집 항목 보존) · 기능 표 인라인 편집(키워드 열·↻ 재생성) · "솔루션 매핑 설정" 카드(요구사항당 최대 후보 1~5, 기본 5 — 전역 settings 키 `rfp_mapping_max_candidates`, `lib/rfp/mapping/settings.ts`)

## API
- `/api/rfp/{uploads,projects,projects/[id],projects/[id]/{reextract,xlsx,file,requirements},requirements/[requirementId]}` — RFP 분석(user 이상, `lib/rfp/require-user.ts`). 파일은 Storage 버킷 `rfp`에 브라우저 직접 업로드, 추출은 `after()`(maxDuration 300)
- `/api/admin/rfp-catalog/{solutions,solutions/[code],solutions/[code]/{sources,import,features},sources/[sourceId],features/[featureId],confluence-search}` — 카탈로그 관리(admin). 가져오기는 `after()`+`runImport`(engine rules|llm, xlsx 소스는 세션 사용자 Graph 토큰)
- `GET /api/rfp/catalog`(`llmAvailable` 포함), `/api/rfp/projects/[id]/mapping`(GET·POST {mode all|missing, engine rules|llm, confirm, solutions[], maxCandidates, requirementIds[], detailKey}), `POST /api/rfp/projects/[id]/mapping/rows`, `/api/rfp/mappings/[mappingId]`(PATCH {verdict, solutionCode, featureId, rationale, evidenceUrl, note}·DELETE — 무엇을 고쳐도 edited=true라 재매핑에 지워지지 않는다) — 솔루션 매핑(user 이상). 실행은 `after()`+`runMapping`(엔진 팩토리 주입, 20건 청크·동시 3·청크별 저장, 행에 engine·score)
- `GET /api/ms/connect?returnTo=`(Azure authorize 302), `GET /api/ms/callback`(state 검증·코드 교환·`ms_connections` 저장 → `returnTo?ms_connected=1|ms_error=`), `GET·DELETE /api/ms/connection` — Microsoft 계정 연결(user 이상, `lib/ms/`). 오리진은 `MS_ALLOWED_ORIGINS` 허용 목록만
- `POST /api/rfp/projects/[id]/mapping/decide`({action confirm|close|reuse, requirementId, detailKey, mappingId?|verdict?|sourceMappingId?} → 그 요구사항의 행 전체) — 확정 작업 한 단위의 결정을 한 번에 적용(후보 삭제 + 확정/닫기/복사, 판정 조합 규칙은 `validateManualMapping` 공용). `GET /api/rfp/projects/[id]/reuse?requirementId&detailKey` — 다른 요구사항에서 사람이 확정한 매핑 중 문장이 비슷한 것(문자 bigram cosine ≥ 0.45, 최대 3) — `lib/rfp/mapping/reuse.ts`
- `GET·POST /api/rfp/projects/[id]/shares`(공유 링크 목록·생성 — 등록자·admin, visibility public|private), `DELETE /api/rfp/shares/[shareId]`(폐기), `GET /api/rfp/shared/[token]`(**인증 없음** — private은 세션 필요, 응답에서 파일·SharePoint·소유자 제거, 공개는 근거 URL·비고까지 제거) — `lib/rfp/share.ts`
- `GET /api/rfp/projects/[id]/sharepoint`, `PUT·DELETE …/sharepoint/folder`({url} → Graph shares 해석 → `rfp_projects.sharepoint_folder`), `POST …/sharepoint/upload`(→ `{upload, notified, notifyError?}`, 오류 `code: no_folder|not_connected|reconnect`) — SharePoint 등록(user 이상). 업로드는 `uploadProjectXlsx`(xlsx 라우트와 같은 `buildProjectWorkbook`)

## Supabase 테이블
- `rfp_projects`(사업 개요·상태·정규화 키, `category_summary` jsonb = 요구사항 총괄표 행 — SQL `2026-09-07-rfp-category-summary.sql`; `extraction_method`·`rfp_files.format`에 xlsx 허용 — SQL `2026-09-07-rfp-xlsx-source.sql`; `rfp_files.format`에 pdf 허용 — SQL `2026-09-09-rfp-pdf-source.sql`), `rfp_files`(원본, sha256 유니크), `rfp_requirements`(구분 코드·ID·7필드·solution) — SQL `docs/sql/2026-09-03-rfp-analyzer.sql`
- `rfp_solutions`, `rfp_solution_sources`(Confluence 페이지·import_status), `rfp_solution_features`(name_norm 유니크·edited), `rfp_requirement_mappings`(요구사항·세부 항목별 0~N행·verdict·edited·`detail_key`/`detail_text`/`evidence_text` — SQL `2026-09-07-rfp-mapping-detail.sql`, 사람이 적는 메모 `note`(엑셀 "비고") — SQL `2026-09-07-rfp-mapping-note.sql`), `rfp_projects.mapping_status|mapping_error|mapping_warnings|mapping_at` — SQL `docs/sql/2026-09-04-rfp-solution-mapping.sql`
- `rfp_solution_features.keywords`(text[]), `rfp_solution_sources.kind|drive_id`(confluence|xlsx), `rfp_requirement_mappings.verdict`에 candidate·`engine`(rules|llm|manual)·`score` — SQL `docs/sql/2026-09-06-rfp-rules-mapping.sql`
- `ms_connections`(사용자당 1행, `refresh_token_enc` AES-256-GCM `v1.iv.tag.cipher`, RLS 정책 없음 = service role만), `rfp_projects.sharepoint_folder`(jsonb {url, driveId, itemId, name, webUrl, setBy, setAt}), `rfp_sharepoint_uploads`(업로드 이력) — SQL `docs/sql/2026-09-05-rfp-sharepoint.sql`
- `rfp_share_links`(project_id·token 유니크·visibility public|private·view_count·last_viewed_at, RLS 정책 없음 = service role만), RPC `rfp_share_link_viewed` — 공유 링크. SQL `docs/sql/2026-09-09-rfp-share-links.sql`

## 패턴
**RFP 분석**: `lib/rfp/` — 파서 5종(`parse-hwp.ts` cfb+zlib 레코드 파서, `parse-hwpx.ts`, `parse-docx.ts`, `parse-xlsx.ts` exceljs·병합셀 보존, `parse-pdf.ts` unpdf(pdf.js) **괘선으로 표 복원**(세로선=열·가로선=행·선 없으면 병합, 글자 간격 추측 금지), xlsx·pdf는 비동기 `parseDocumentAsync`) → 공통 `DocumentModel` → `overview.ts`(개요·정규화) → `dedupe.ts` → `extract-standard.ts`(표준 7행 표 규칙) / `extract-xlsx.ts`(엑셀 요건표: 한 행 = 한 요구사항, 헤더 점수 선택·구분 병합 채움·답변/비고→산출정보) / `extract-llm.ts`(Claude 폴백) → `xlsx.ts`(exceljs). 라우트는 `pipeline.ts`의 `registerProject`·`runExtraction`만 호출. 2단계: `lib/rfp/catalog/`(Confluence URL→페이지 id·storage XHTML→텍스트·Claude 기능 추출·이름 정규화 병합·`runImport`) · `lib/rfp/mapping/`(판정 상수 `types.ts`·S/F 별칭 프롬프트·20건 청크·출력 검증·요약/건수·`runMapping`). 라우트는 `runImport`·`runMapping`만 호출. `rfp_requirements.solution`은 더는 편집하지 않고 화면·xlsx의 "당사 솔루션"은 `mappingSummary`로 만든다. 3단계: `lib/ms/`(crypto AES-GCM·HMAC state / oauth 위임 토큰 / config settings+env / origin 허용 오리진·returnTo / connections `ms_connections`+access 토큰 5분 캐시 / graph-drive shares 해석·업로드) + `lib/rfp/sharepoint.ts`(`buildProjectWorkbook` xlsx 라우트 공용·`uploadProjectXlsx`·`buildUploadNotice`·`loadUploads`). 파일명 날짜는 KST(`kstYmd`). 토큰·시크릿은 어떤 로그·응답에도 쓰지 않는다. 4단계: 카탈로그 적재·매핑이 엔진 주입형 — `catalog/{source-kind,extract-rules,xlsx-features,keywords,confluence-search}.ts`, `mapping/{tokenize,rules,engine}.ts`. 규칙 엔진은 "후보"만 내고 확정은 사람 또는 Claude. 매핑 단위는 `mapping/detail-items.ts`의 세부 항목(요구사항 세부 내용 1단 리스트)이며 판정 조합·후보 상한을 단위마다 적용한다. 요구사항당 후보 상한은 어드민 설정(1~5, 기본 5)이며 매핑 라우트가 settings에서 읽어 `runMapping` → 엔진 팩토리로 넘긴다(잡은 순수 유지). Graph 토큰은 라우트가 발급해 `runImport` 인자로만 넘긴다(`lib/ms/route-token.ts`).
