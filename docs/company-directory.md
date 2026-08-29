# 사내 조직도 명부(company_directory) 운영 런북

> 화면: `/admin/directory` (조직/팀). 출처: 그룹웨어 **아마란스**(gw.innogrid.com) 조직도 — `inno-creed` MCP(`~/bin/inno-creed`, stdio)의 `find_person` 전사 명부. **Claude 조직(Team 플랜, `claude_orgs`)과는 별개**의 "회사 소속" 정보이며, Claude 사용량 대시보드의 "소속" 컬럼이 이 명부를 이메일로 조인한다. 설계 배경: `docs/superpowers/specs/2026-08-29-company-directory-design.md`.

## 1. 최초 설정 (1회)
1. Supabase SQL Editor에서 `docs/sql/2026-08-29-company-directory.sql` 실행 → `company_directory`, `company_directory_sync` + admin 읽기 RLS.
2. 동기화를 실행할 PC에 `~/bin/inno-creed`가 있고 그룹웨어 크레덴셜을 스스로 취득할 수 있어야 한다(실행 시 stderr에 `크레덴셜 취득 완료`). 다른 경로면 `INNO_CREED=/path/to/inno-creed`.
3. 토큰: `CLAUDE_OTEL_INGEST_TOKEN`(환경변수 또는 `frontend/.env.local`, Vercel과 동일 값) — 동기화 API가 관리자 세션 대신 이 토큰도 받는다.

## 2. 동기화 (수동, 1분)
```bash
./frontend/scripts/company-directory-sync.py --dry-run   # 명부 인원·부문별 분포만 확인
./frontend/scripts/company-directory-sync.py             # 프로덕션에 반영
BASE_URL=http://localhost:3003 ./frontend/scripts/company-directory-sync.py   # 로컬 개발 서버
```
- 동작: `find_person("innogrid")` → 전사 명부(이메일 도메인으로 전원 매칭, 2026-08-29 기준 324명) → `POST /api/admin/directory/sync` → 이메일 기준 upsert(`active=true`), **이번 명부에 없던 재직자는 `active=false`**(삭제하지 않음) → `company_directory_sync`에 1행.
- 안전장치: 명부가 50명 미만이면 `force` 없이는 반영하지 않는다(그룹웨어 부분 응답으로 전원이 비활성 처리되는 사고 방지). 휴대폰 번호는 전송하지 않는다.
- 주기: 조직 개편·입퇴사 반영이 필요할 때, 또는 월 1회. 자동화하려면 이 PC의 launchd/cron에 스크립트를 걸면 된다(사내 그룹웨어의 공식 도구이므로 무인 실행에 약관 문제 없음). 예: 매주 월 09:10
  ```
  10 9 * * 1 cd ~/Repos/inje-playground && ./frontend/scripts/company-directory-sync.py >> ~/Library/Logs/company-directory-sync.log 2>&1
  ```
- 확인: `/admin/directory` 상단 "마지막 동기화" 시각·인원, 비활성 처리 인원. Claude 사용량 탭의 "소속" 컬럼은 다음 조회부터 반영.

## 2.1 대시보드에서의 표시
- Claude 사용량 두 탭(Claude Code·채팅/Cowork) 표: **"사용자 (Claude)"**(CSV/OTel의 이름·이메일) 옆 **"이름"**(이 명부의 실명), **"Claude 조직"**(Team 플랜 조직), **"조직 / 팀"**(팀 + 본부/부문). 필터 바에 **조직/팀 필터**(본부·부문 / 팀·센터 / 명부 없음) — Claude 조직 필터와 독립적으로 동작.
- `/admin/users` 사용자 상세 레이어의 "사내 소속 (조직도)" 섹션도 이 명부를 이메일로 조회한다.

## 3. 데이터 모델
| 컬럼 | 뜻 | 예 |
|---|---|---|
| `email`(PK) | 소문자 정규화 | seunguk.kang@innogrid.com |
| `dept_path` | 원본 경로 | (주)이노그리드>(주)이노그리드>기술·운영부문>R&D본부>클라우드 네이티브 센터>XPU플랫폼팀 |
| `units[]` | 회사 세그먼트를 뗀 경로 | {기술·운영부문, R&D본부, 클라우드 네이티브 센터, XPU플랫폼팀} |
| `division` / `headquarters` / `team` | units[1] / units[2] / 말단(dept_name) | 기술·운영부문 / R&D본부 / XPU플랫폼팀 |
| `duty` / `position` | 직책 / 직급 | 팀장 / 선임연구원 |
| `active`, `synced_at` | 최근 명부 포함 여부, 마지막 반영 시각 | |

경로 깊이는 3~6(부문만 있는 사람 ~ 팀까지 있는 사람). "팀명"으로 쓸 값은 `team`(말단 부서명: 팀·센터·본부·부문 중 가장 아래), "조직명"은 `division`(부문) 또는 `headquarters`(본부).

## 4. 장애 대응
| 증상 | 확인 | 조치 |
|---|---|---|
| 스크립트 `MCP 실패` / `크레덴셜` 오류 | `~/bin/inno-creed --help` 실행 시 stderr에 `크레덴셜 취득 완료`가 나오는지 | 그룹웨어 로그인 상태 복구(inno-creed 문서 참고) 후 재실행 |
| `명부가 N명으로 너무 적습니다` (400) | `--dry-run`의 `rosterSize`와 검색 결과 수 비교 | 검색어(`DIRECTORY_QUERY`, 기본 `innogrid`)가 이메일 도메인과 맞는지 확인. 정말 소규모면 API에 `force:true` |
| 401 | 토큰 불일치 | `frontend/.env.local`의 `CLAUDE_OTEL_INGEST_TOKEN`이 Vercel 값과 같은지 |
| 500 `server not configured` | Vercel `SUPABASE_SERVICE_ROLE_KEY` 없음 | 환경변수 확인 |
| 500 `relation company_directory does not exist` | §1 SQL 미실행 | SQL 실행 |
| 사용량 표 "소속"이 `—` | 명부에 없는 이메일(외부 계정·별칭) 또는 비활성 | `/admin/directory`에서 "비활성 포함"으로 검색. Claude 로그인 이메일과 그룹웨어 이메일이 다르면 조인 불가(현재 수동 매핑 기능 없음) |

## 5. 테스트
- 단위: `npx vitest run src/lib/__tests__/directory-parse.test.ts` (경로 분해·정규화·중복 제거).
- E2E 게이트: `npx playwright test e2e/directory.spec.ts` (세션 없는 401, 토큰 있는 400, 소규모 명부 거부).
