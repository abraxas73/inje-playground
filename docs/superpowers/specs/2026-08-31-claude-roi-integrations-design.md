# Claude 활용 성과 측정 — 업무 시스템 연동 설계

> 2026-08-31 초안. Claude 사용량 데이터(투입)와 업무 시스템의 산출 지표를 이메일 기준으로 결합해 "Claude를 쓰면 무엇이 얼마나 좋아지는가"를 측정한다.
> 관련: 사용량 수집 아키텍처 `docs/claude-usage-architecture.md`, 운영 런북 `docs/claude-usage.md`, 설문 시스템(생산성 25문항).

## 1. 측정하려는 것 (성과 질문 → KPI)

성과는 "사용량"이 아니라 **산출·속도·품질**이다. 이미 투입(사용량)은 다 모으고 있으므로, 이 설계는 산출 쪽 데이터를 붙이는 것이 핵심.

| 질문 | KPI | 데이터 출처 |
|---|---|---|
| 일을 더 많이 끝내는가 | 주당 Jira 이슈 완료 수, 스토리포인트 | **Jira** (신규) |
| 일이 더 빨리 끝나는가 | 이슈 사이클 타임(진행→완료), MR 리드타임(생성→머지) | **Jira**, **GitLab** (신규) |
| 코드 산출이 늘었는가 | 전체 커밋/MR 수(분모) 대비 Claude 경유 커밋/PR(분자) 비중 | **GitLab**(신규) + `claude_code_daily`(보유) |
| 문서 산출이 늘었는가 | Confluence 페이지 생성·수정 수 | **Confluence** (신규) |
| 협업 부하가 줄었는가 (보조) | Teams 메시지 수, SharePoint 파일 편집 수 | **Microsoft Graph 리포트** (신규, 신호 약함) |
| 체감 효과 (정성) | 생산성 설문 점수 추이 | 설문 시스템 (보유) |

투입 지표(보유): 비용·세션·프롬프트 수·활동 시간(OTel `claude_code_daily`), 채팅·Cowork(CSV `claude_member_activity`), 도구·시간대·프롬프트 내용.

**해석 원칙 (중요)**: 상관 ≠ 인과. 헤비 유저는 원래 산출이 높은 사람일 수 있다(자기선택 편향). 그래서 ① 같은 팀 내 코호트 비교(헤비/라이트/미사용) ② 도입 전후 4주 추이 ③ 설문 정성 지표, 세 가지를 병행해서 방향이 일치하는지 본다. 개인 성과평가 도구가 아니라 **도입 효과 검증·시트 배분 근거**로 쓴다.

## 2. 전체 아키텍처

기존 패턴을 그대로 따른다: **일 단위 집계를 Supabase에 적재 → 이메일로 `company_directory` 조인 → 어드민 대시보드**.

```
[Jira Cloud API]──┐
[Confluence API]──┤   Vercel Cron (매일 07:30 KST)
[GitLab API]──────┼─→ /api/cron/work-metrics ─→ Supabase (소스별 daily 테이블)
[MS Graph 리포트]─┘         (CRON_SECRET 인증)         │
                                                      ├─ email ⋈ company_directory (팀/본부)
[폴백: 로컬 푸시 스크립트]─→ POST /api/admin/work-metrics/sync   ├─ email ⋈ claude_code_daily (투입)
  (조직도 동기화와 같은 패턴, 수집 토큰)                └─→ /admin/claude-usage "성과 분석" 탭
```

- **수집기**: `frontend/src/lib/work-metrics/` 아래 소스별 어댑터(`jira.ts`, `confluence.ts`, `gitlab.ts`, `m365.ts`) + 공통 upsert. Vercel Cron이 기본, API 접근이 막힌 시스템만 로컬 푸시 폴백(그룹웨어 조직도와 동일 패턴).
- **조인 키 = 회사 이메일.** 소스마다 이메일이 아닌 ID를 쓰는 경우 매핑 테이블을 둔다(아래 각 절).
- **멱등성**: 모든 테이블은 `(day, user_email, scope)` upsert. 재수집·백필 안전.
- **백필**: 각 어댑터는 `?from=&to=` 기간 수집을 지원 → 도입 이전(예: 2026-05~07) 기준선(baseline)을 한 번에 채운다. **이게 전후 비교의 핵심이므로 필수.**

## 3. 연동별 설계

### 3.1 Jira (Atlassian Cloud) — 1순위

이슈 처리량·사이클 타임이 성과와 가장 직결. 프롬프트 수집에서 `CMPTEAM-5309` 같은 Jira 키 사용이 확인됨.

- **인증**: 서비스 계정(봇) 이메일 + API 토큰(Basic). env: `ATLASSIAN_SITE`(https://\<org\>.atlassian.net), `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`. 서비스 계정에 대상 프로젝트 조회 권한 필요.
- **수집** (매일, 전일분):
  - `POST /rest/api/3/search/jql` — `resolved >= -1d` / `created >= -1d`, `expand=changelog`
  - 사이클 타임 = changelog에서 최초 In Progress 진입 → `resolutiondate`
  - 스토리포인트 = 커스텀 필드(사이트마다 ID 다름, 설정으로 지정)
- **함정**: Atlassian GDPR 모드에서 `assignee.emailAddress`가 비공개일 수 있음 → org 관리자 API(`/users/search`)로 accountId↔email을 1회 덤프해 `atlassian_account_map` 테이블에 저장(관리자만 실행, 로컬 푸시 폴백 가능).
- **테이블**:
  ```sql
  jira_issue_daily(day, user_email, project_key,
    issues_created int, issues_resolved int,
    cycle_hours_sum numeric, cycle_count int, story_points numeric,
    primary key (day, user_email, project_key))
  atlassian_account_map(account_id text pk, email text)
  ```

### 3.2 GitLab — 2순위 (분모 확보)

OTel이 세는 커밋/PR은 "Claude Code 세션 안에서 만든 것"뿐이다. **전체 커밋·MR(분모)이 있어야 "Claude 경유 비중"과 순증가를 말할 수 있다.** 프롬프트에서 MR·`origin/refactor/…` 워크플로 확인됨.

- **인증**: 그룹 단위 PAT(`read_api`). env: `GITLAB_URL`(self-hosted면 사내 주소), `GITLAB_TOKEN`, `GITLAB_GROUP`. **self-hosted가 사내망 전용이면 Vercel에서 접근 불가 → 로컬 푸시 스크립트로 수집**(조직도와 동일 패턴).
- **수집**: 그룹 하위 프로젝트 순회 —
  - 커밋: `GET /projects/:id/repository/commits?since=…` → author_email별 카운트
  - MR: `GET /projects/:id/merge_requests?updated_after=…` → 생성/머지 수, 리드타임(created→merged), 리뷰 코멘트 수(선택)
- **테이블**:
  ```sql
  gitlab_daily(day, user_email, project_path,
    commits int, mrs_opened int, mrs_merged int,
    mr_lead_hours_sum numeric, mr_merged_count int,
    primary key (day, user_email, project_path))
  ```
- **파생 지표**: `claude_code_daily.commits ÷ gitlab_daily.commits` = Claude 경유 커밋 비중(개인·팀·주 단위).

### 3.3 Confluence — 3순위

- **인증**: Jira와 같은 토큰.
- **수집**: `GET /wiki/rest/api/content/search?cql=created >= now("-1d")`(+ lastmodified) → creator/수정자별 페이지 생성·수정 수. 본문은 수집하지 않는다(개수만).
- **테이블**: `confluence_daily(day, user_email, space_key, pages_created int, pages_updated int, primary key(day, user_email, space_key))`

### 3.4 Microsoft Graph — Teams·SharePoint (4순위, 보조)

메시지·파일 활동은 성과보다 "업무 방식 변화" 신호. 기존 Graph app-only 자격(멤버 조회용)에 권한만 추가.

- **인증**: 기존 Azure 앱에 `Reports.Read.All`(애플리케이션 권한) 추가 + 관리자 동의. env는 기존 `TEAMS_GRAPH_CLIENT_SECRET` 재사용.
- **수집**: `GET /reports/getTeamsUserActivityUserDetail(period='D7')`, `getSharePointActivityUserDetail(period='D7')` — CSV 응답, 사용자별 일 활동.
- **함정**: M365 관리 센터 > 설정 > 보고서에서 "사용자 정보 익명화"가 켜져 있으면 이메일이 가려짐 → 해제 필요(테넌트 관리자).
- **테이블**: `m365_activity_daily(day, user_email, teams_messages int, sp_files_edited int, sp_files_shared int, primary key(day, user_email))`

### 3.5 Dooray (선택, 사내 상황에 따라)

프로젝트 업무(태스크) 완료 수를 Dooray API로 수집 가능(`/project/v1/projects/{id}/posts`). Jira를 안 쓰는 팀이 Dooray 업무로 일하면 이쪽이 분모. Jira 커버리지 확인 후 결정.

## 4. 성과 분석 모델 (대시보드 "성과 분석" 탭)

주 단위 개인 패널을 만들고(주=월~일, KST), 세 가지 뷰를 제공:

1. **코호트 비교** — 같은 팀 안에서 Claude 사용 강도(주간 활동일 기준 헤비 ≥4일 / 라이트 1–3일 / 미사용)별 평균: 이슈 완료, 사이클 타임, 커밋, MR 리드타임. *"헤비 유저가 사이클 타임 30% 짧다"* 형태의 결론.
2. **도입 전후 추이** — 관리형 설정 적용(2026-08-27) 전후 4~8주, 팀별 주간 산출 추이 라인 차트. 백필 데이터가 기준선.
3. **상관 산점도** — X: 주간 Claude 비용(또는 세션), Y: 이슈 완료/커밋. 점=개인×주, 팀 색상. 추세선 + 상관계수 표시(인과 아님 주석 고정).

공통: 팀 필터(company_directory), CSV 내보내기, **기본 화면은 팀 단위 집계**(개인 식별 화면은 접기).

## 5. 개인정보·거버넌스

- 수집 범위: **개수·시간 지표만**. 이슈 제목·문서 본문·메시지 내용은 수집하지 않는다(프롬프트 수집과 달리 내용 없음).
- 공지: 기존 안내문에 "업무 시스템(Jira·GitLab·Confluence·M365) 활동 **통계**를 성과 분석 목적으로 결합" 1줄 추가(v3). 프롬프트 때와 같은 채널로.
- 활용 원칙 문서화: 팀 단위 의사결정(시트 배분·도입 확대) 목적, 개인 인사평가 비활용을 명시해 두는 것을 권장.

## 6. 로드맵과 준비물

| 단계 | 내용 | 규모 | 사용자 준비물 |
|---|---|---|---|
| P0 | 공지 v3 + 측정 정의 합의(이 문서) | — | 공지 발송 |
| P1 | Jira 수집기 + 테이블 + 크론 + 백필 | 1~2일 | Atlassian 서비스 계정·API 토큰, 사이트 주소, 대상 프로젝트 목록 |
| P2 | GitLab 수집기(+사내망이면 로컬 푸시) | 1일 | GitLab 주소·그룹 PAT(read_api) |
| P3 | 성과 분석 탭(코호트·전후·산점도) — P1 데이터만으로 1차 오픈 | 1~2일 | — |
| P4 | Confluence 수집기 | 0.5일 | (P1 토큰 재사용) |
| P5 | M365 리포트 수집기 | 1일 | Azure 앱 `Reports.Read.All` 동의, 보고서 익명화 해제 |
| P6 | (선택) Dooray 태스크, 설문 점수 오버레이 | 0.5일 | — |

## 7. 확정 사항 (2026-08-31 사용자 회신)

1. **엔드포인트**: Jira/Confluence = `https://pms-innogrid.atlassian.net` (Atlassian Cloud), GitLab = `https://rnd-app.innogrid.com` — **공인망에서 접근 가능 확인**(API 401 응답, DNS 210.207.104.150) → Vercel 크론으로 직접 수집, 로컬 푸시 불필요.
2. **계정 규칙**: 각 시스템 계정은 회사 이메일 또는 이메일 로컬파트(@innogrid.com 생략형) → `normalizeEmail()`로 통일.
3. **공개 범위(변경)**: 성과·사용량 화면은 **어드민 메뉴가 아니라 일반 사용자 메뉴**. 본인은 본인 것만, 팀장급(팀장·센터장·실장·소장)은 같은 팀, 임원급(본부장·부문장 등)은 같은 본부까지 — `lib/usage-scope.ts`가 company_directory의 `duty`로 판정하고 서버가 허용 이메일을 계산한다. Claude 사용량 2개 화면(`/usage/code`, `/usage/chat`)도 같은 규칙으로 개인 메뉴에 노출(구현됨). 성과 화면 `/usage/perf`는 P1 데이터 적재 후 추가.
4. **남은 확인**: Jira 스토리포인트 사용 여부(쓰면 `JIRA_STORY_POINTS_FIELD` 지정), GitLab 그룹 경로(`GITLAB_GROUPS`, 미지정 시 토큰이 보는 전체), Dooray 태스크 분모 포함 여부.

## 8. 구현 현황 (P1 골격, 2026-08-31)

- SQL: `docs/sql/2026-08-31-work-metrics.sql` (jira_issue_daily·atlassian_account_map·confluence_daily·gitlab_daily·work_metrics_sync, 관리자 RLS)
- 수집기: `frontend/src/lib/work-metrics/{common,jira,confluence,gitlab}.ts`
- 크론: `GET /api/cron/work-metrics?source=all|jira|confluence|gitlab&from&to` — Vercel Cron 매일 07:30 KST(`frontend/vercel.json`), `CRON_SECRET` Bearer 또는 관리자 세션(수동 백필)
- 필요 env(Vercel): `ATLASSIAN_SITE=https://pms-innogrid.atlassian.net`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`, `GITLAB_URL=https://rnd-app.innogrid.com`, `GITLAB_TOKEN`(read_api), `CRON_SECRET` + 선택 `JIRA_PROJECTS`, `JIRA_STORY_POINTS_FIELD`, `GITLAB_GROUPS`
- 미설정 소스는 "미설정"으로 조용히 스킵 — env 등록 전 배포 안전
