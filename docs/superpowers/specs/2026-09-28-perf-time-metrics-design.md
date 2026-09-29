# 성과 측정 시간 정보 — 설계

> 2026-09-28. 성과 측정 화면(`/admin/perf`, `/usage/perf`)에 시간 정보 네 가지를 보인다: 데이터 기준 시점, 소요 시간 분포·체류, 활동 시간대, 기간 비교. 기반 설계는 `docs/superpowers/specs/2026-08-31-claude-roi-integrations-design.md`.

## 1. 목적과 성공 기준

- **대상**: 경영진(도입 효과 보고), 조직장(팀 운영 점검), 개인(본인 셀프 체크). 세 화면 모두 같은 `PerfDashboard`를 쓰고 범위만 다르다.
- **성공 기준**: 평균 하나가 아니라 분포와 변화가 보이고, 그 숫자가 언제 기준인지 화면에서 알 수 있다.
- **확정된 값**: 데이터 신선도 기준 48시간, Claude 도입일 `2026-08-27`(상수), 시간대 히트맵 최소 인원 3명.
- **공개 범위(확정)**: 활동 시간대는 팀·조직 합계만 보이고 개인별 시간대는 본인 화면에서 본인 것만 본다. 소요 시간(p50 등)은 지금도 구성원별 평균을 보여주므로 구성원별로 보인다.

## 2. 범위

포함:
1. 데이터 기준 시점 배지(소스별 마지막 수집 시각·실패·오래됨)
2. 기간 비교: 직전 같은 길이 기간 대비 증감, 도입 전후 4주 비교
3. 소요 시간 강화: 리드·사이클·대기·MR 리드의 p50·p90·평균·분포 5구간, 구성원·프로젝트·주별
4. 활동 시간대: 요일×시각 히트맵(커밋 authored, 이슈 해결, MR 머지), 업무시간 외 비중(업무시간 = 평일 09:00~17:59 KST)

제외(후속 후보): Confluence 항목화(문서에는 소요 시간이 없음), MR 첫 리뷰 시각(MR마다 추가 API 호출), 도입일의 설정 화면, 상태별 세부 체류(진행 중 대기·블록 등, `extra jsonb`로 확장 여지만 둔다).

## 3. 현재 상태

- 일 집계 테이블(`jira_issue_daily`, `gitlab_daily`, `confluence_daily`)은 리드·사이클·MR 리드를 **일별 합계와 건수**로만 갖는다. 중앙값·분포·시간대를 낼 수 없다.
- Jira 수집기는 `created`·`resolutiondate`와 changelog(최초 In Progress)를 이미 받는다. GitLab은 운영에서 로컬 스크립트 `frontend/scripts/gitlab-metrics-sync.py`가 수집해 `POST /api/admin/work-metrics/sync`로 밀어 넣는다(서버 `gitlab.ts`는 같은 규칙의 참조 구현).
- 수집 이력은 `work_metrics_sync`(source, range_from, range_to, rows, ok, error, created_at)에 남지만 화면에 쓰이지 않는다.
- 대시보드는 평균만 보인다(`h()` = 합/건수). 시간대·분포·기준 시점 표시가 없다. 도입 전후 비교는 기존 스펙에 있으나 미구현.

## 4. 데이터 모델

### 4.1 `work_items` — 한 행 = 이슈·MR·커밋 하나

SQL `docs/sql/2026-09-28-work-items.sql`(멱등, Supabase SQL Editor 또는 Management API).

```sql
create table if not exists public.work_items (
  source       text not null,                 -- jira | gitlab
  kind         text not null,                 -- issue | mr | commit
  item_key     text not null,                 -- 아래 규칙
  user_email   text not null,                 -- 소문자 회사 이메일(미확인 시 aid:<accountId>)
  scope_key    text not null,                 -- Jira project_key / GitLab project_path
  created_at   timestamptz not null,
  started_at   timestamptz,                   -- issue: 최초 In Progress 진입. mr·commit: null
  done_at      timestamptz,                   -- issue: resolutiondate. mr: merged_at(미머지 null). commit: null
  story_points numeric,
  is_claude    boolean not null default false,-- commit: Co-Authored-By: Claude 트레일러
  extra        jsonb,                         -- 후속(상태별 체류 등). 이번 판은 쓰지 않는다
  synced_at    timestamptz not null default now(),
  primary key (source, kind, item_key)
);
create index if not exists work_items_done_idx    on public.work_items (done_at);
create index if not exists work_items_created_idx on public.work_items (created_at);
create index if not exists work_items_email_idx   on public.work_items (user_email, done_at desc);
-- RLS: 일 집계 테이블과 같은 admin 읽기 정책, 쓰기는 service_role만
```

- `item_key`: issue = Jira 키(`CMPTEAM-5309`), mr = `<project_path>!<iid>`, commit = `md5("<email>|<authored_date>|<title>")`. 커밋 키가 SHA가 아닌 이유는 리베이스·체리픽으로 SHA만 바뀐 같은 커밋을 1건으로 세는 일 집계 규칙과 맞추기 위해서다.
- 소요 시간은 컬럼으로 두지 않는다. 리드 = `done_at − created_at`, 사이클 = `done_at − started_at`, 대기 = `started_at − created_at`, MR 리드 = `done_at − created_at`. 조회 때 계산하고 음수는 0으로 잘라낸다(시계 오차).
- 시간대는 KST로 DB에서 뽑는다(`at time zone 'Asia/Seoul'`).
- 일 집계 테이블은 그대로 유지한다. 수집기가 같은 메모리 목록에서 두 곳에 쓴다.
- 규모: 커밋 하루 200~300건이면 연 10만 행 안팎. 보존 기한은 두지 않는다.

### 4.2 수집기 변경

**Jira (`lib/work-metrics/jira.ts`)**: 해결 검색(`resolutiondate` 범위, changelog 포함) 루프에서 이슈 항목을 만든다.

```
{ source: "jira", kind: "issue", item_key: issue.key, user_email(assignee ?? reporter), scope_key: project.key,
  created_at: fields.created, started_at: cycleStart(issue) ?? null, done_at: resolutiondate, story_points }
```
`upsertChunked(admin, "work_items", items, "source,kind,item_key")`. 생성 검색 결과는 항목으로 쓰지 않는다(이번 판 지표는 모두 완료 시각 기준).

**GitLab 로컬 스크립트 (`frontend/scripts/gitlab-metrics-sync.py`)**: 커밋·MR 루프에서 항목을 모아 일 집계 POST 뒤에 `{"source": "gitlab_items", "rows": [...], "replace": {from, to}}`로 보낸다(5,000행 청크, replace는 첫 청크만).

- 커밋: `{kind: "commit", item_key: md5(f"{email}|{when}|{title}"), user_email, scope_key: path, created_at: when, is_claude}`. 중복 제거 집합(`seen`)을 통과한 커밋만.
- MR: `{kind: "mr", item_key: f"{path}!{iid}", user_email, scope_key: path, created_at, done_at: merged_at or null}`. 오픈일 또는 머지일이 기간 안인 MR.
- `--dry-run`은 항목 표본도 찍는다.

**서버 `lib/work-metrics/gitlab.ts`**: 같은 규칙으로 항목을 만들어 직접 upsert(참조 구현 유지). 두 구현은 규칙을 바꾸면 함께 고친다(기존 원칙).

**sync API (`app/api/admin/work-metrics/sync/route.ts`)**: `TABLES`에 `gitlab_items` 추가.

- table `work_items`, conflict `source,kind,item_key`, 허용 컬럼 `kind, item_key, user_email, scope_key, created_at, started_at, done_at, is_claude`. `source`는 서버가 `gitlab`으로 고정한다.
- 검증(순수 함수 `lib/work-metrics/items.ts`의 `normalizeGitlabItem`): kind ∈ {mr, commit}, item_key 1~200자, created_at은 `Date.parse` 가능, started_at·done_at은 null 또는 파싱 가능하고 created_at 이후(아니면 created_at으로 보정), is_claude는 boolean. 통과 못 하면 그 행은 건너뛰고 `skipped`에 센다.
- 이메일: 커밋은 `resolveCommitterEmail`, MR도 같은 함수를 거친다(정상 이메일은 그대로 통과).
- `replace`: `source = 'gitlab' and kind = 'commit' and created_at ∈ [from 00:00 KST, to+1 00:00 KST)`만 삭제. MR은 PK upsert(같은 MR이 나중에 머지되면 done_at이 채워진다).
- 수집 로그는 `source: "gitlab_items"`로 남긴다. 신선도 배지는 `gitlab`만 본다.

### 4.3 백필과 대조

1. SQL 적용 → 수집기·sync API·스크립트 배포.
2. Jira: 관리자 세션으로 `GET /api/cron/work-metrics?source=jira&from=2026-05-01&to=2026-05-31`을 월 단위로 어제까지(라우트 maxDuration 300초).
3. GitLab: 사내망에서 `python3 frontend/scripts/gitlab-metrics-sync.py --from 2026-05-04 --to <어제>`.
4. 대조: 같은 날짜 범위에서 `count(work_items where kind='issue' and done_at in range)` = `sum(jira_issue_daily.issues_resolved)`, `count(kind='commit')` = `sum(gitlab_daily.commits)`, `count(kind='mr' and done_at in range)` = `sum(mrs_merged)`. 이메일 정규화 전후 차이는 없어야 한다(둘 다 서버 정규화). 커밋은 정확히 일치하지 않을 수 있다: 항목은 authored 날짜로 기간을 자르지 않아 리베이스된 커밋이 더 들어갈 수 있고(items ≥ daily), 여러 프로젝트에 미러된 같은 커밋은 내용 키로 합쳐진다(items ≤ daily). 이슈는 jira_issue_daily가 upsert만 하므로 재오픈·재해결된 이슈만큼 daily가 더 클 수 있다(items = 현재 해결 상태). 수십 건 차이는 정상이다. 2026-09-29 GitLab 백필(05-04~09-28) 대조: MR 2,833 = 2,833(일치), 커밋은 항목 26,257 vs daily 32,867 — daily 커밋의 38%(12,563건)가 같은 저장소의 포크(개인 네임스페이스 복제, 예: secloudit-ui 9곳)에 있어 프로젝트마다 세는 daily가 크고 항목은 내용 키로 한 번만 센다. 같은 키가 한 배치에 두 번 오면 Postgres upsert가 거부하므로 `upsertItems`가 PK 중복을 제거한다(마지막 행 우선).

## 5. 집계와 API

### 5.1 데이터 기준 시점 `freshness`

`lib/work-metrics/freshness.ts`의 순수 함수 `deriveFreshness(rows, now)`: `work_metrics_sync`에서 소스별(`jira`, `gitlab`, `confluence`) 최신 행 1개와 최신 성공 행 1개를 읽어

```ts
type SourceFreshness = { lastOkAt: string | null; rangeTo: string | null; lastError: string | null; stale: boolean };
type Freshness = Record<"jira" | "gitlab" | "confluence", SourceFreshness>;
```
- `stale` = 성공 기록이 없거나 `lastOkAt`이 48시간보다 오래됨.
- `lastError` = 최신 행이 실패면 그 오류(500자 이내), 성공이면 null.
- Claude 사용량은 실시간 수집이라 배지 문구만 "실시간(OTel)".
- 두 성과 API 응답에 `freshness`를 넣는다. 조회는 `work_metrics_sync`를 `created_at desc`로 소스당 최대 2행씩(작다).

### 5.2 기간 비교 `compare=1`

`lib/work-metrics/compare.ts`:
- `prevRange(from, to)`: 길이 n일이면 `to' = from − 1일`, `from' = to' − (n − 1)일`.
- `adoptionWindows(date = ADOPTION_DATE)`: before = `[date − 28일, date − 1일]`, after = `[date, date + 27일]`. `ADOPTION_DATE = "2026-08-27"`은 `lib/work-metrics/adoption.ts` 상수.
- `totalsOf(users: UserPerf[])`: 대시보드가 클라이언트에서 하던 합산(해결·생성·SP·사이클 합/건수·리드 합·커밋·Claude 경유·MR 오픈/머지/리드 합·문서·LOC·비용·세션·프롬프트·활동시간)을 서버 공용 함수로 옮긴다. 클라이언트 요약 카드도 이 함수를 쓴다.
- 라우트는 `compare=1`이면 `buildPerfReport`를 직전 기간·도입 전·도입 후로 세 번 더 돌려(Promise.all) 총계만 돌려준다:

```ts
compare: {
  previous: { range: { from, to }, totals: Totals },
  adoption: { date: string, before: { range, totals }, after: { range, totals } },
}
```
- 4회 조회가 부담이면 `compare`를 요약 탭이 열릴 때만 요청한다(대시보드는 첫 로드가 요약 탭이므로 기본 켬).

### 5.3 소요 시간 RPC `work_items_time_stats`

```sql
create or replace function public.work_items_time_stats(p_from date, p_to date, p_emails text[])
returns table (grp text, kind text, metric text, n bigint, p50 numeric, p90 numeric, avg numeric,
               b1 bigint, b2 bigint, b3 bigint, b4 bigint, b5 bigint)
language sql security definer set search_path = public as $$
  with base as (
    select kind, lower(user_email) as user_email, scope_key,
      to_char(date_trunc('week', done_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') as week,
      greatest(0, extract(epoch from (done_at - created_at)) / 3600) as lead_h,
      case when started_at is not null then greatest(0, extract(epoch from (done_at - started_at)) / 3600) end as cycle_h,
      case when started_at is not null then greatest(0, extract(epoch from (started_at - created_at)) / 3600) end as wait_h
    from work_items
    where done_at >= (p_from::text || ' 00:00:00+09')::timestamptz
      and done_at <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
      and kind in ('issue', 'mr')
      and (p_emails is null or lower(user_email) = any (p_emails))
  ), m as (
    select kind, user_email, scope_key, week, 'lead' as metric, lead_h as h from base
    union all select kind, user_email, scope_key, week, 'cycle', cycle_h from base where kind = 'issue' and cycle_h is not null
    union all select kind, user_email, scope_key, week, 'wait',  wait_h  from base where kind = 'issue' and wait_h  is not null
  )
  select coalesce('week:' || week, 'user:' || user_email, 'scope:' || scope_key, 'all') as grp, kind, metric,
    count(*)::bigint as n,
    percentile_cont(0.5) within group (order by h)::numeric as p50,
    percentile_cont(0.9) within group (order by h)::numeric as p90,
    avg(h)::numeric as avg,
    count(*) filter (where h <= 4)::bigint                 as b1,   -- ≤4시간
    count(*) filter (where h > 4   and h <= 24)::bigint    as b2,   -- ≤1일
    count(*) filter (where h > 24  and h <= 72)::bigint    as b3,   -- ≤3일
    count(*) filter (where h > 72  and h <= 168)::bigint   as b4,   -- ≤1주
    count(*) filter (where h > 168)::bigint                as b5    -- >1주
  from m
  group by grouping sets ((kind, metric), (kind, metric, week), (kind, metric, user_email), (kind, metric, scope_key))
$$;
```
- 기간 기준은 **완료 시각**(done_at). 기간 안에 완료된 항목의 소요 시간이다.
- `p_emails`가 null이면 무필터(어드민 전체). 라우트는 기존 `filterEmails`를 그대로 넘긴다.
- 실행 권한은 기존 RPC와 같다(`service_role`만).
- 성과 API 응답 `durations: TimeStatRow[]`(RPC 행 그대로). 클라이언트가 `grp`로 나눠 쓴다. 주별은 `week:` 접두, 구성원별은 `user:`, 프로젝트·저장소별은 `scope:`.
- RPC가 없으면(`could not find`/`does not exist`) `durations: []`, `durationsReady: false`로 내려 화면이 평균으로 폴백한다.

### 5.4 시간대 RPC `work_items_hourly`

```sql
create or replace function public.work_items_hourly(p_from date, p_to date, p_emails text[], p_kinds text[])
returns table (kind text, dow int, hour int, n bigint)
language sql security definer set search_path = public as $$
  select kind,
    extract(isodow from (ts at time zone 'Asia/Seoul'))::int as dow,
    extract(hour   from (ts at time zone 'Asia/Seoul'))::int as hour,
    count(*)::bigint as n
  from (
    select kind, user_email, case when kind = 'commit' then created_at else done_at end as ts
    from work_items
  ) x
  where ts is not null
    and ts >= (p_from::text || ' 00:00:00+09')::timestamptz
    and ts <  ((p_to + 1)::text || ' 00:00:00+09')::timestamptz
    and kind = any (p_kinds)
    and (p_emails is null or lower(user_email) = any (p_emails))
  group by 1, 2, 3
$$;
```
- 커밋은 authored 시각, 이슈는 해결 시각, MR은 머지 시각. **반환에 사용자 차원이 없다.**

### 5.5 엔드포인트와 공개 범위

- `GET /api/admin/work-metrics/perf`, `GET /api/usage/perf`: 기존 파라미터 + `compare=1`. 응답에 `freshness`, `compare?`, `durations`, `durationsReady` 추가. 나머지 형태는 유지.
- 신규 `GET /api/admin/work-metrics/perf/hourly?from&to&team&kinds=commit,issue,mr`, `GET /api/usage/perf/hourly?from&to&team&kinds`:
  - 어드민: `team`이 있으면 그 팀, 없으면 전체. **`q`(이름 검색)는 받지 않는다.**
  - 개인용: `scope.scope === "self"`면 본인 이메일만. `org`면 팀 필터까지.
  - 대상 이메일이 3명 미만이고 self가 아니면 `{ suppressed: true, cells: [] }`. 셀은 내려주지 않는다.
  - 응답 `{ range, scope: { scopeLabel }, kinds, cells: [{kind, dow, hour, n}], suppressed, notReady }`.
- `Cache-Control: no-store`.

## 6. 화면 (`components/usage/PerfDashboard.tsx`)

- **헤더**: "데이터 기준" 배지 묶음. 소스별 `MM-DD HH:mm`(KST). `stale`이거나 `lastError`가 있으면 주황색, 툴팁에 사유. 마지막에 "Claude 실시간". `compare`가 있으면 "직전 기간 MM-DD~MM-DD" 작은 글씨.
- **요약 탭**: 카드마다 직전 기간 대비 증감 표시(`delta(cur, prev, lowerIsBetter)`: 소요 시간은 줄면 초록, 나머지는 늘면 초록. prev가 0이면 표시 안 함). 사이클 카드 주 값은 p50(`durationsReady`일 때), 부제 "평균 x · p90 y · 대기 p50 z". 준비 전에는 지금처럼 평균. 새 카드 "도입 전후 4주": 이슈 해결·사이클(p50 또는 평균)·MR 리드 before→after.
- **Jira 탭**: "사이클 타임 분포" 가로 막대 5개(≤4h·≤1일·≤3일·≤1주·>1주, 건수와 비율), "체류" 스탯(대기 p50, 진행 p50). 주별 사이클 차트는 `week:` p50 시리즈(준비 전 평균). 구성원별 표에 "사이클 p50"·"리드 p50" 열(`user:` 행, 없으면 —).
- **코드 탭**: MR 리드 p50·p90 스탯과 분포 막대. 구성원별·저장소별 표에 "MR 리드 p50".
- **시간대 탭(신규)**: `HourHeatmap` 7×24(KST), 종류 토글(커밋 / 이슈 해결 / MR 머지, 기본 커밋), 스탯 "업무시간 외 비중"(업무시간 = 평일(isodow 1~5) 09:00~17:59 KST. 그 밖의 시각 + 주말 건수 / 전체), "주말 비중". 안내 문구: 조직 화면은 "팀 합계, 개인별 표시 없음", `suppressed`면 "3명 미만이라 표시하지 않습니다", 개인 화면은 "내 활동".
- **분석 탭**: 코호트 표에 "사이클 p50"·"MR 리드 p50" 열(코호트 구성원 이메일의 `user:` 행을 건수 가중으로 합쳐 근사; 정확한 코호트 p50은 후속). 주별 추이 막대에서 도입일 이후 주는 다른 색(`WeekBars`에 `highlightFrom` prop).
- **공용 히트맵**: `components/shared/HourHeatmap.tsx`로 `HourlyPatternTab`의 그리드 렌더링을 뽑아 둘이 같이 쓴다. props `cells: {dow, hour, value}[]`, `valueLabel`, `title?`. `HourlyPatternTab` 동작은 그대로.
- 타입 `types/work-metrics.ts`에 응답 타입을 모아 두 라우트와 대시보드가 공유한다(지금은 대시보드가 자체 인터페이스를 복제하고 있다).

## 7. 단계와 배포 순서

**1단계(수집 변경 없음, 먼저 배포)**: 5.1 freshness, 5.2 compare, 6의 헤더 배지·증감·도입 전후 카드·도입일 강조, `totalsOf` 서버 이동, 타입 파일. 기존 데이터만으로 동작한다.

**2단계(항목 테이블)**: 4.1 SQL + 5.3·5.4 RPC 적용 → 4.2 수집기·sync API·스크립트 배포 → 4.3 백필·대조 → 5.5 라우트 → 6 나머지(p50 전환·분포·체류·시간대 탭·코호트 열·공용 히트맵).

배포는 기존 방식(`frontend/`에서 `vercel deploy --prod`). launchd의 GitLab 스크립트는 저장소 파일을 직접 실행하므로 main 반영 즉시 다음 실행부터 항목을 보낸다.

## 8. 테스트

- vitest(순수 함수): `deriveFreshness`(성공·실패·오래됨·기록 없음), `prevRange`·`adoptionWindows`(월말·윤년 경계), `totalsOf`, `delta` 방향, `normalizeGitlabItem`(kind·시각·done<created 보정·거부), Jira 이슈→항목 변환(started 없음·SP 없음), 커밋 `item_key` 해시가 중복 제거 규칙과 일치, 히트맵 "업무시간 외 비중" 계산, `HourHeatmap` 셀 배치(간단 렌더 테스트).
- RPC: 운영 DB에서 수동 검증 3건(전체 p50이 정렬 중앙과 일치, 주별 grp 수 = 주 수, 3명 미만 필터).
- 스크립트: `--dry-run`으로 항목 표본 확인, 백필 뒤 4.3 대조 쿼리.
- 회귀: 기존 685+ 테스트, lint 0.

## 9. 문서

- `.claude/rules/claude-usage-cost.md`: 성과 API 응답 변경, `work_items`·RPC, 시간대 공개 범위, 백필 절차.
- `docs/superpowers/specs/2026-08-31-claude-roi-integrations-design.md` §8에 구현 현황 한 줄.
- 운영 런북은 이 문서 4.3·7절이 맡는다.

## 10. 미결·후속

- 코호트별 정확한 p50(RPC에 코호트 그룹을 넘기거나 클라이언트가 항목을 받아 계산).
- MR 첫 리뷰까지 시간(notes/approvals API), Confluence 항목화, 도입일 설정화, 상태별 체류(`extra jsonb`에 상태 전이 목록).
- 개인 화면에서 본인 시간대와 팀 합계를 나란히 보는 비교.
