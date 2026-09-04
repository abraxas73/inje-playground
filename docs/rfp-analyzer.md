# RFP 분석 런북

설계: `docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md`(1단계) · `docs/superpowers/specs/2026-09-04-rfp-analyzer-phase2-design.md`(2단계) · 계획: `docs/superpowers/plans/2026-09-03-rfp-analyzer-phase1.md` · `docs/superpowers/plans/2026-09-04-rfp-analyzer-phase2.md`

## 구성
- 화면 `/rfp`(목록·업로드), `/rfp/[id]`(개요·요구사항 표). user 역할 이상.
- API `/api/rfp/*`. 파일은 브라우저가 Storage 버킷 `rfp`에 서명 URL로 직접 올린다(Vercel 4.5MB 제한 회피).
- 추출은 `after()`로 응답 뒤 실행(`maxDuration 300`). 표준 양식(첫 셀 "요구사항분류"/"요구사항구분"인 7행 표)은 규칙, 비표준만 Claude.
- 테이블 `rfp_projects`·`rfp_files`·`rfp_requirements` — SQL `docs/sql/2026-09-03-rfp-analyzer.sql`.

- **2단계(솔루션 매핑)**: 어드민 `/admin/rfp-catalog`에서 솔루션(SECloudit·Devopsit·AICubeit·TabCloudit·Openstackit 시드)마다 Confluence 페이지 URL을 등록해 "가져오기" → 서버가 페이지 id로 REST 조회 → Claude가 기능 목록 정리 → 카탈로그 병합(사람이 고친 ✎ 항목은 덮어쓰지 않음). 상세 화면 "솔루션 매핑 실행" → `after()`에서 카탈로그를 시스템 프롬프트(캐싱)로 넣고 요구사항 20건씩(동시 3) Claude 호출 → 요구사항별 0~N행(솔루션·기능·판정 충족/부분충족/설계·구축영역/해당없음·설명·근거 URL). 사람이 고친 행(✎)이 있는 요구사항은 재실행에서 제외. 테이블 `rfp_solutions`·`rfp_solution_sources`·`rfp_solution_features`·`rfp_requirement_mappings` + `rfp_projects.mapping_*` — SQL `docs/sql/2026-09-04-rfp-solution-mapping.sql`.

## 환경 변수
| 이름 | 용도 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 기존. DB·Storage 서버 접근 |
| `ANTHROPIC_API_KEY` | 비표준 RFP LLM 폴백 + 2단계 카탈로그 가져오기·솔루션 매핑. 없으면 표준 양식 추출만 동작 |
| `RFP_LLM_MODEL` | 기본 `claude-opus-5` |
| `ATLASSIAN_SITE`·`ATLASSIAN_EMAIL`·`ATLASSIAN_API_TOKEN` | 기존(성과 지표와 공유). 카탈로그 Confluence 가져오기. 없으면 가져오기 400 |

## 최초 설치
1. SQL 실행(Supabase SQL Editor 또는 Management API) → 테이블 3개 + 버킷 `rfp`(private, 50MB).
2. Vercel env에 `ANTHROPIC_API_KEY` 추가(선택).
3. 배포: `git push` 후 `vercel --prod`(자동 배포 아님).
4. (2단계) `docs/sql/2026-09-04-rfp-solution-mapping.sql` 실행 → 테이블 4개 + 시드 5건. Vercel env에 `ANTHROPIC_API_KEY`가 있어야 가져오기·매핑이 동작한다.
5. (2단계) 어드민 `/admin/rfp-catalog`에서 솔루션별 Confluence 페이지 URL 등록 → 가져오기 → 기능 표 검토(이름·설명 정리, 회의록성 항목 비활성).

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

## 3단계 접점
- 3단계(SharePoint): `GET /api/rfp/projects/[id]/xlsx` 버퍼(매핑 시트 포함)를 Graph 드라이브 업로드로 전달. 2단계 테이블은 3단계와 무관.
