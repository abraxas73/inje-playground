# 사내 조직도 명부(company_directory) 설계

상태: 구현 완료(2026-08-29). 런북 `docs/company-directory.md`.

## 요구
"inno-creed MCP를 이용해 사용자의 조직 정보(조직명/팀명)를 가져와 테이블에서 관리한다. 기존 Claude 내 조직(Team 플랜 조직)과는 별개의 정보로."

## 조사 결과
- `inno-creed`(`~/bin/inno-creed`, Mach-O, stdio MCP, rmcp 3.0.1)는 이노그리드 그룹웨어 **아마란스**(gw.innogrid.com) 도구. 실행 시 그룹웨어 크레덴셜을 스스로 취득한다(로컬 PC 전용 — 서버(Vercel)에서는 돌릴 수 없음).
- 조직 정보 도구: `whoami`(본인), `find_person(query)`(이름·ID·이메일 부분 일치 → empSeq/deptId/deptName/**deptPath**/duty/position/email/loginId/mobile; 첫 호출에 전사 명부를 조립해 30분 캐시), `org_chart(dept_id?|parent_seq?)`(부서 트리 74개 / 부서원).
- `find_person("innogrid")`는 이메일 도메인으로 **전사 324명 전원**을 한 번에 돌려준다(rosterSize=324, 이메일 전원 고유, 모두 @innogrid.com).
- `deptPath` 깊이 3~6: `(주)이노그리드>(주)이노그리드>부문[>본부[>센터[>팀]]]`. 부문 4종(기술·운영 206, 사업·전략 95, 경영지원 20, 대표이사 3), 말단 부서 65종.

## 결정
1. **저장**: `company_directory(email PK, …, units[], division, headquarters, team, duty, position, active, synced_at)` + `company_directory_sync`(이력). Claude 조직 테이블과 분리(조인 키는 이메일만).
2. **동기화는 로컬 푸시**: 서버는 MCP를 못 부르므로 `frontend/scripts/company-directory-sync.py`가 MCP stdio로 `find_person`을 호출해 `POST /api/admin/directory/sync`(수집 토큰 또는 관리자 세션)로 밀어 넣는다. upsert + 누락자 비활성(삭제 금지) + 50명 미만 거부. 휴대폰은 전송·저장하지 않는다(요구 범위 밖 개인정보).
3. **화면**: `/admin/directory` — 부문/본부 필터·검색·비활성 포함·CSV, 마지막 동기화 표시. 수동 편집은 넣지 않음(출처가 그룹웨어라 그룹웨어에서 고치는 것이 맞음; 필요 시 수동 매핑 테이블을 추가).
4. **활용**: Claude 사용량 `summary`/`members` API가 재직자 명부를 이메일로 조인해 `team`/`division`을 붙이고, Claude Code 탭·CSV 탭에 "소속" 컬럼을 추가. 명부에 없으면 `—`.
5. **하지 않은 것**: `org_chart` 트리 저장(부서 마스터) — 명부의 `units[]`로 충분. Claude 로그인 이메일≠그룹웨어 이메일인 사람의 수동 매핑 — 사례가 나오면 추가.

## 검증
- vitest `directory-parse.test.ts`: 깊이 3~6 분해, 소문자 이메일, 휴대폰 제외, 중복/누락 처리.
- e2e `directory.spec.ts`: 세션 없는 401, 토큰 있는 400(people 누락/빈 배열), 소규모 명부 거부.
- 실데이터: `--dry-run` 324명 → 실제 동기화 → `/admin/directory`·사용량 탭 "소속" 확인.
