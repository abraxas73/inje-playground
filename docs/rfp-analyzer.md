# RFP 분석 런북

설계: `docs/superpowers/specs/2026-09-03-rfp-analyzer-phase1-design.md` · 계획: `docs/superpowers/plans/2026-09-03-rfp-analyzer-phase1.md`

## 구성
- 화면 `/rfp`(목록·업로드), `/rfp/[id]`(개요·요구사항 표). user 역할 이상.
- API `/api/rfp/*`. 파일은 브라우저가 Storage 버킷 `rfp`에 서명 URL로 직접 올린다(Vercel 4.5MB 제한 회피).
- 추출은 `after()`로 응답 뒤 실행(`maxDuration 300`). 표준 양식(첫 셀 "요구사항분류"/"요구사항구분"인 7행 표)은 규칙, 비표준만 Claude.
- 테이블 `rfp_projects`·`rfp_files`·`rfp_requirements` — SQL `docs/sql/2026-09-03-rfp-analyzer.sql`.

## 환경 변수
| 이름 | 용도 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | 기존. DB·Storage 서버 접근 |
| `ANTHROPIC_API_KEY` | 비표준 RFP LLM 폴백. 없으면 표준 양식만 동작하고 비표준은 failed |
| `RFP_LLM_MODEL` | 기본 `claude-opus-5` |

## 최초 설치
1. SQL 실행(Supabase SQL Editor 또는 Management API) → 테이블 3개 + 버킷 `rfp`(private, 50MB).
2. Vercel env에 `ANTHROPIC_API_KEY` 추가(선택).
3. 배포: `git push` 후 `vercel --prod`(자동 배포 아님).

## 운영 메모
- 지원 형식: hwp(5.x, 암호화·배포용 제외), hwpx, docx. 스캔 이미지 문서는 요구사항이 나오지 않는다.
- 중복 판단: 파일 sha256(서버가 Storage에서 내려받은 바이트로 계산하며, 등록 요청에 클라이언트가 보낸 값은 없다) 또는 정규화한 사업명+발주기관 일치. 사업명 정규화는 공백·기호·괄호 문자만 제거하고 괄호 안 내용은 유지하며(재공고·차수 등 접미어는 유사 판단에서만 별도로 제거), 발주기관 정규화는 괄호 안 내용(예: "(이하 OO)")과 법인 표기를 제거한다. 유사하면 화면에서 사용자 확인.
- 유사 확인창에서 "취소"하면 Storage `uploads/…`에 고아 파일이 남는다. 주기적으로 `rfp_files.storage_path`에 없는 객체를 지운다(수동).
- 추출이 3분 넘게 `extracting`이면 화면이 안내한다. 6분 넘게 `extracting`이면(after()가 5분 제한에 걸려 죽었다고 보고) 재추출 버튼이 다시 활성화되며, 재추출 API도 같은 기준으로 409 없이 재시도를 받아준다.
- 요구사항은 프로젝트당 수백 건이라 Supabase 1000행 상한에 걸리지 않는다. 넘길 가능성이 생기면 `selectAll` 사용.

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

## 2·3단계 접점
- 2단계: `rfp_requirements.solution` → 구조화 테이블 + xlsx 목록 열 확장.
- 3단계: `GET /api/rfp/projects/[id]/xlsx` 버퍼를 Graph 드라이브 업로드로 전달.
