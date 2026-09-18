# Claude 비용 관리 — 설계

작성 2026-09-18. 관리자 페이지 `/admin/claude-cost` "비용 관리".

## 배경과 목표

Claude Code(OTel)·Claude 채팅/Cowork(CSV) 사용량은 이미 대시보드로 보이지만, **실제로 청구된 금액**은 어디에도 없다. 지금 있는 숫자는 모두 추정치다 — OTel `cost_usd`(API 환산 추정), CSV `estimated_spend_usd`, `claude_orgs.seats_total`(관리자가 손으로 적은 좌석 수).

목표: 월별로 **실제 청구 금액**과 **사용량**을 나란히 보고, 좌석당·활성 사용자당 비용을 한눈에 파악한다.

## 청구 데이터의 출처 — 확인한 사실

| 지출 | 출처 | 자동화 |
|---|---|---|
| claude.ai **Team 좌석 구독료**(7개 조직, 지출의 대부분) | Anthropic(Stripe) 인보이스 — 조직별 한 장 | API 없음. Stripe 링크에서 PDF를 서버가 직접 내려받아 파싱 |
| Claude **Console API 사용분**(`ANTHROPIC_API_KEY` — RFP 매핑·마케팅 AI) | Admin API `GET /v1/organizations/cost_report` (`sk-ant-admin01-…`) | 일 단위 자동 수집. 키는 아직 발급 전 — env 없으면 화면에서 숨김 |

공식 문서 기준으로 **Team 좌석 구독료는 어떤 API에도 없다.** Claude Enterprise Analytics API는 Enterprise 조직 전용이고 좌석제 플랜은 "usage credits만" 반영한다. Claude Code Analytics API는 OTel과 같은 추정치다.

### Stripe 인보이스 구조(실물 확인)

- 발행자 `Anthropic, PBC`, **Bill to = 조직명**(`Innogrid-ax` — `claude_orgs.name`과 매칭 가능), 통화 USD, 한국 VAT 10% 별도.
- 청구 기간은 달력 월이 아니라 **결제일~다음 달 같은 날**(예 Aug 23–Sep 23, 2026).
- 좌석 변경이 있으면 **프로레이션 라인**이 들어온다: `Remaining time on 97 × Team plan - Premium after 24 Aug 2026`(+, Qty 97) / `Unused time on 40 × Team plan - Premium after 24 Aug 2026`(−, Qty 40). 좌석 티어는 설명 문구에 있다.
- 합계 줄: `Subtotal`, `Total excluding tax`, `VAT - South Korea (10% on $…)`, `Total`, `Amount due $… USD`.
- 호스팅 페이지 `https://invoice.stripe.com/i/<acct>/<id>?s=ap`는 JS SPA라 서버에서 읽을 수 없지만, `https://pay.stripe.com/invoice/<acct>/<id>/pdf?s=ap`는 **인증 없이 PDF(1쪽, 60KB대)** 를 돌려준다. 글자 좌표로 줄을 복원하면 모든 필드가 깨끗하게 나온다(unpdf 원시 순서는 뒤섞이므로 좌표 기반 필수).

## 결정 사항

1. **인보이스 원장**으로 저장한다(접근 A). 요약만 저장(B)하면 프로레이션·같은 달 2장·원본 대조가 안 되고, 일할 배분(C)은 카드 청구와 어긋난다.
2. **월 배정 = 발행일(`issued_on`)의 달력 월.** 재무팀이 보는 카드 청구와 일치한다. 서비스 기간은 저장해 두어 나중에 일할 배분 토글을 얹을 수 있다.
3. 한 조직·한 달에 인보이스가 2장이면 **청구액은 합, 좌석 수는 좌석이 파싱된 것 가운데 가장 늦게 발행된 것.**
4. 금액은 **센트 정수**(인보이스) / **센트 numeric**(Admin API — `"123.78912"`처럼 소수 센트가 온다). 부동소수 달러 저장 없음. 표시할 때만 반올림.
5. 통화는 인보이스대로 **USD**(세전·VAT·총액 구분). 원화 카드 청구액은 은행 환율이라 범위 밖.
6. **청구 합계 = 등록된 인보이스 합계.** Admin API의 API 비용은 별도 열(대조용)이며 합계에 더하지 않는다 — Console 인보이스를 함께 올렸을 때 이중 계산을 막기 위해서다.
7. 입력은 **Stripe 링크 붙여넣기(주)** + **PDF 업로드(보조)**. 두 경로는 같은 파서를 탄다.
8. 페이지는 **관리자 전용**. 사용자용 `/usage`에는 넣지 않는다.
9. `CLAUDE_ADMIN_API_KEY`가 없으면 API 비용 탭·열을 **렌더하지 않는다**(비활성 버튼+env 툴팁 금지 — 기존 `llmAvailable` 패턴).

## 데이터 모델 — SQL `docs/sql/2026-09-18-claude-cost.sql`

RLS 정책 없음 = service role 전용. Storage 버킷 `claude-invoices`(비공개).

```sql
create table public.claude_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  org_id text null references public.claude_orgs(id),
  bill_to text not null,
  issued_on date not null,
  period_start date null,
  period_end date null,
  currency text not null default 'USD',
  subtotal_cents integer not null,
  tax_cents integer not null default 0,
  total_cents integer not null,
  seats integer null,
  plan text null,
  source text not null check (source in ('link','pdf')),
  source_url text null,
  storage_path text not null,
  raw_text text not null,
  uploaded_by uuid null,
  created_at timestamptz not null default now()
);
create index claude_invoices_org_issued_idx on public.claude_invoices (org_id, issued_on);

create table public.claude_invoice_lines (
  invoice_id uuid not null references public.claude_invoices(id) on delete cascade,
  position integer not null,
  description text not null,
  quantity integer null,
  amount_cents integer not null,
  tax_rate text null,
  period_start date null,
  period_end date null,
  seats integer null,
  plan text null,
  primary key (invoice_id, position)
);

create table public.claude_api_cost_daily (
  day date not null,
  workspace_id text not null default '',
  description text not null,
  cost_type text null,
  model text null,
  amount_cents numeric not null,
  currency text not null default 'USD',
  synced_at timestamptz not null default now(),
  primary key (day, workspace_id, description)
);
```

- `seats`/`plan`(헤더) = 양수 금액 라인의 수량 합 / 티어(둘 이상이면 `, `로 이어 붙임). 프로레이션 크레딧(음수)은 좌석 계산에서 제외 — "Remaining 97 / Unused 40"은 좌석 97이다.
- `period_start/period_end`(헤더) = 라인 기간의 최소~최대.
- `raw_text` = 복원한 줄 텍스트 전체(재파싱·디버깅용). 응답에는 내려주지 않는다.
- `claude_api_cost_daily.day`는 버킷 `starting_at`의 UTC 날짜. 같은 키 재수집은 upsert(문서상 값이 30일간 사후 보정된다).

## 파서 `lib/claude-cost/stripe-invoice.ts` — 순수 함수

```ts
export function invoiceLinkToPdfUrl(url: string): string | null
```
`https://invoice.stripe.com/i/<acct>/<id>[?s=…]` → `https://pay.stripe.com/invoice/<acct>/<id>/pdf[?s=…]`. 이미 `pay.stripe.com/invoice/…/pdf`면 그대로. 그 외(다른 호스트·http·경로 불일치)는 `null`.

```ts
export interface InvoiceLine { position; description; quantity; amountCents; taxRate; periodStart; periodEnd; seats; plan }
export interface ParsedInvoice { invoiceNumber; issuedOn; billTo; currency; subtotalCents; taxCents; totalCents; periodStart; periodEnd; seats; plan; lines: InvoiceLine[] }
export type ParseResult = { ok: true; invoice: ParsedInvoice } | { ok: false; errors: string[] }
export function parseStripeInvoice(lines: TextLine[]): ParseResult
```
`TextLine`은 RFP `parse-pdf.ts`의 `groupLines`가 만드는 줄(조각 x좌표 유지). 규칙:

- 발행자: 줄 중 `Anthropic`을 포함하는 줄이 없으면 오류 `Anthropic 인보이스가 아닙니다`.
- `Invoice number <번호>`, `Date of issue <Month D, YYYY>` — 영문 월 이름 파싱.
- `Bill to`: 그 조각의 x0을 기준으로 다음 줄에서 x0이 같은 열(±글자 높이)의 조각 = `billTo`.
- 라인: 줄 텍스트가 `^(.+?)\s+(\d+)\s+(\d+%)?\s*(-?\$[\d,]+\.\d{2})$` — 설명·수량·세율·금액. 바로 다음 줄이 `Mon D–Mon D, YYYY`(연도가 뒤에만 있으면 앞 날짜에 보정, 연말 걸침이면 앞 연도 −1)이면 기간. 설명에서 `^(?:Remaining time on |Unused time on )?(\d+) × (.+?)(?: after .+)?$` → `seats`, `plan`.
- 합계: `Subtotal $…`, `VAT … $…`(없으면 0), `Total $…`, `Amount due $… <통화>`. 
- **검증**: Σ라인 = Subtotal, Subtotal + VAT = Total. 어긋나면 오류로 저장 거절(조용히 넘기지 않는다). 라인 0개도 오류.
- 금액 문자열 → 센트 정수: `-$4,978.24` → `-497824`. 부동소수 경유 금지(문자열 분해).

```ts
export function matchOrg(billTo: string, orgs: { id; name }[]): string | null
```
소문자화 + 영숫자만 남겨 비교(`Innogrid-ax` ≡ `innogridax`). 정확히 하나면 그 id, 아니면 null.

```ts
export async function extractInvoiceLines(pdf: Uint8Array): Promise<TextLine[]>
```
unpdf로 페이지 글자 조각을 뽑아 `groupLines`. RFP 파서의 조각 추출 부분을 공용 함수로 뽑아 재사용한다(`parse-pdf.ts`에 `extractTextFrags(pdf)` export 추가 — 기존 동작 변경 없음).

## 인보이스 등록 `lib/claude-cost/invoice-ingest.ts`

```ts
export async function ingestInvoice(input: { bytes: Uint8Array; source: 'link'|'pdf'; sourceUrl?: string; filename?: string }, deps: { admin; orgs; uploadedBy }): Promise<IngestResult>
```
1. `%PDF` 매직·2MB 상한 확인 → `extractInvoiceLines` → `parseStripeInvoice`. 실패면 `{ ok:false, errors }`.
2. `invoice_number` 중복이면 `{ ok:false, duplicate: { id, org_id, issued_on } }`(라우트는 409).
3. `matchOrg` → `org_id`(null 허용).
4. Storage 업로드 `claude-invoices/<invoice_number>.pdf`(upsert). 실패면 중단.
5. 헤더 insert → 라인 insert. 라인 실패 시 헤더 삭제(cascade) + Storage 삭제.
6. `logAudit({ category: 'usage', action: 'claude_cost.invoice_import', detail: { invoice_number, org_id, total_cents, source } })`.

링크 가져오기(라우트 쪽 `fetchInvoicePdf(url)`): `invoiceLinkToPdfUrl`이 null이면 400. `fetch(pdfUrl, { redirect: 'manual', signal: 10초 })`, 응답 2xx·본문 2MB 이하·`%PDF` 매직이 아니면 오류 `PDF를 받지 못했습니다`. 오류 메시지에 URL을 그대로 넣지 않는다.

## Admin API 수집 `lib/claude-cost/anthropic-cost-report.ts`

```ts
export function isApiCostAvailable(): boolean   // !!process.env.CLAUDE_ADMIN_API_KEY
export interface ApiCostRow { day; workspaceId; description; costType; model; amountCents: string; currency }
export function parseCostReport(json: unknown): { rows: ApiCostRow[]; hasMore: boolean; nextPage: string | null }
export async function fetchCostReport(opts: { apiKey; from: string; to: string; fetchImpl? }): Promise<ApiCostRow[]>
```
- 요청 `GET https://api.anthropic.com/v1/organizations/cost_report?starting_at=<from>T00:00:00Z&ending_at=<to+1일>T00:00:00Z&bucket_width=1d&group_by[]=workspace_id&group_by[]=description&limit=31[&page=…]`, 헤더 `anthropic-version: 2023-06-01`, `x-api-key`, `User-Agent: inje-playground/1.0 (https://inje-playground.vercel.app)`.
- 31일 청크로 나눠 순서대로 호출, `has_more`면 `page=next_page`로 이어서. 429·5xx는 1회 재시도 후 오류.
- `results[]` → `day`=`starting_at`의 UTC 날짜, `workspaceId`=`workspace_id ?? ''`, `amountCents`는 문자열 그대로 보존(numeric 컬럼에 그대로 넣는다).
- 저장 `upsertApiCost(admin, rows)` — `(day, workspace_id, description)` onConflict upsert, `synced_at = now()`.
- 키·응답 원문은 어떤 로그·응답에도 쓰지 않는다.

## 월별 집계 `lib/claude-cost/monthly.ts` — 순수 함수

```ts
export interface MonthlyCost {
  month: string;                       // YYYY-MM
  invoices: number;
  billed: { subtotalCents; taxCents; totalCents };
  seats: number | null;                // 조직별로 그 달 인보이스 중 seats가 있는 것 가운데 최신 것의 좌석 합(하나도 없으면 null)
  missingOrgs: string[];               // 인보이스 없는 Team 조직 이름
  unassignedCents: number;             // org_id null 인보이스 총액
  apiCostCents: number | null;         // Admin API(없으면 null)
  usage: { activeUsers; sessions; promptsHuman; estCostUsd };  // OTel Team 조직 월합(KST day 기준)
  csvActiveMembers: number | null;     // 그 달에 period_end가 있는 CSV(조직별 최신)의 활동 멤버 합
  perOrg: { orgId; name; invoices: {id; invoiceNumber; issuedOn; periodStart; periodEnd; plan; seats; totalCents}[]; totalCents; seats; activeUsers; estCostUsd }[];
}
export function summarizeMonthly(input: { months: string[]; orgs; invoices; apiCost; daily: DailyRow[]; csv }): MonthlyCost[]
```
- 파생 지표(화면 계산): 좌석당 = total/seats, 활성 사용자당 = total/activeUsers — 분모 0이면 `—`.
- 활성 사용자 = `claude_code_daily`에서 `isActive` 행의 distinct `user_email`(identity map 적용, `org=team`).

## API 라우트 — 모두 `requireAdmin` + `adminClientOr500`

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/admin/claude-cost/invoices?from&to&org` | 인보이스 목록(라인 포함, `raw_text` 제외) |
| `POST /api/admin/claude-cost/invoices` | JSON `{ urls: string[] }`(최대 20) 또는 multipart `files[]`(PDF, 각 2MB) → `{ results: [{ input, ok, invoice? , duplicate?, errors? }] }` 건별 결과. 하나가 실패해도 나머지는 저장 |
| `PATCH /api/admin/claude-cost/invoices/[id]` | `{ org_id: string \| null }` 배정 변경 → audit `claude_cost.invoice_assign` |
| `DELETE /api/admin/claude-cost/invoices/[id]` | 행 삭제(cascade) + Storage 삭제 → audit `claude_cost.invoice_delete` |
| `GET /api/admin/claude-cost/invoices/[id]/pdf` | Storage 서명 URL(5분) 302 |
| `GET /api/admin/claude-cost/monthly?months=12&org=` | `{ months: MonthlyCost[], apiCostAvailable }` — months 1~36 |
| `GET /api/admin/claude-cost/api-cost?from&to` | `{ available, rows, lastSyncedAt }` — 키 없으면 `{ available:false, rows:[] }` |
| `POST /api/admin/claude-cost/api-cost/sync` | `{ from, to }`(최대 93일) 수집 → `{ upserted }` → audit `claude_cost.api_sync` |
| `GET /api/cron/claude-cost` | Vercel Cron(`Authorization: Bearer CRON_SECRET`) 또는 관리자 세션. 키 없으면 `{ skipped: 'no_key' }`. 최근 3일 재수집. `vercel.json`에 `"0 23 * * *"`(08:00 KST) 추가 |

`pagesForPath`에는 추가하지 않는다(`/admin`·`/api/admin`은 이미 admin 전용).

## 화면 `/admin/claude-cost`

`ADMIN_NAV`에 `{ href: "/admin/claude-cost", label: "비용 관리", icon: Receipt }` — "Claude 사용량 (Chat/Cowork)" 다음.

컴포넌트 `components/admin/claude-cost/`:
- `CostOverviewTab` — 기간(6/12/24개월)·조직(`OrgSelect` 공용, Team 조직 전체 기본) → 카드 4개(최근 인보이스 월의 청구 총액·좌석·좌석당·활성 사용자당) → 월별 막대 SVG(`MonthlyBars`: 세전·VAT를 한 막대에 스택, API 비용은 옆에 별도 가는 막대 — 합계에 더하지 않는다는 결정 6과 맞춘다) → 월별 표(월 | 인보이스 | 좌석 | 세전 | VAT | 총액 | API 비용* | 추정 비용(OTel) | Claude Code 활성 사용자 | 활성 멤버(CSV) | 좌석당 | 1인당). 인보이스 누락 조직·미배정 금액은 배지. CSV 내려받기(`downloadCsv` 공용). 행 클릭 → `MonthOrgDetail`(조직별 상세: 인보이스 번호·발행일·기간·티어·좌석·총액·활성 사용자·추정 비용·PDF·원본 링크).
- `InvoiceImportTab` — textarea(링크 여러 줄) + PDF 파일 선택 → "등록" → 건별 결과(성공/중복/오류 메시지) → 등록된 인보이스 표(조직 배정 드롭다운 = PATCH, 삭제 확인, PDF).
- `ApiCostTab` — `available`일 때만 `TabsTrigger`를 렌더. 일별 막대(`DailyBars` 재사용) + 항목(description)별 합계 표 + "지금 수집"(기간 선택) + 마지막 수집 시각.
- 지표 툴팁 문구는 `lib/claude-usage/metric-hints.ts` 패턴으로 `lib/claude-cost/hints.ts`: "청구 총액은 인보이스 기준(VAT 포함), API 비용은 대조용이며 합계에 포함하지 않음", "월 = 인보이스 발행일 기준", "좌석 = 그 달 마지막 인보이스의 좌석".

## 오류 처리

- 파싱 실패: 어떤 필드가 안 잡혔는지 오류 목록으로 돌려주고 저장하지 않는다. `raw_text`는 실패 응답에 넣지 않는다.
- 합계 검증 실패도 저장 거절 — 파서가 라인을 놓친 신호다.
- 중복 인보이스 번호 → 409 + 기존 인보이스(번호·조직·발행일). 화면은 "이미 등록됨"으로 표시.
- Bill to 미매칭 → 저장(org_id null), 화면에 "조직 미배정" 경고. 월 합계에는 포함, 조직별 표에는 "미배정" 행.
- Storage 실패 → 원장도 남기지 않는다.
- 링크 fetch 실패(타임아웃·비PDF·리디렉션) → 건별 오류 `PDF를 받지 못했습니다 — PDF 파일로 올려 주세요`.
- Admin API 401/403 → `관리자 키가 거부되었습니다`(키 값 노출 없음). 429·5xx 1회 재시도.

## 보안

- `CLAUDE_ADMIN_API_KEY`는 서버 env만. settings 테이블 저장 금지. 어떤 응답·로그에도 쓰지 않는다.
- 링크 fetch는 `invoice.stripe.com`·`pay.stripe.com` https만, `redirect: 'manual'`(SSRF·리디렉션 방지), 2MB·10초 상한.
- Stripe 링크(`source_url`)는 그 자체로 PDF 접근 토큰이라 DB(service role)에만 두고, 화면은 관리자 전용이므로 "원본 열기" 링크로 노출한다.
- 테이블 3개 RLS 정책 없음(service role 전용), Storage 버킷 비공개 + 서명 URL 5분.
- 등록·삭제·배정·수집은 모두 `logAudit`(category `usage`).

## 테스트 (vitest, `frontend/src/lib/__tests__/`)

- `claude-cost-stripe-invoice.test.ts` — 실물 레이아웃을 본뜬 픽스처(조직명·금액 가공): 프로레이션 2줄(좌석 97·크레딧 음수), 단일 라인 갱신, VAT 없는 인보이스, 연말 걸침 기간(`Dec 23–Jan 23, 2027`), 합계 불일치 거절, 라인 0개 거절, 비Anthropic 거절, Bill to 열 추출(왼쪽 발행자 주소와 섞이지 않음), 금액 문자열→센트, 영문 날짜 파싱, `invoiceLinkToPdfUrl`(정상 변환·pay.stripe 그대로·타 호스트/http null), `matchOrg`(대소문자·하이픈 무시·중복 시 null).
- `claude-cost-cost-report.test.ts` — 문서 예시 응답 파싱(소수 센트 문자열 보존, `workspace_id` null → `''`), `has_more` 페이지네이션 2회, 31일 청크 분할, 429 재시도.
- `claude-cost-monthly.test.ts` — 같은 달 2장(합·최신 좌석), 미배정 인보이스(합계 포함·`unassignedCents`), 누락 조직, API 비용 null/합, OTel 활성 사용자 distinct, CSV 없는 달 null, 분모 0.
- 파서 통합: 실제 PDF 바이트 픽스처는 저장소에 넣지 않는다(청구 정보). `extractInvoiceLines`는 구현 중 실물 PDF로 수동 확인하고, 그 결과 줄 텍스트를 가공해 유닛 픽스처로 쓴다.

## 배포 순서

1. SQL 적용(테이블 3개) + Storage 버킷 `claude-invoices` 생성(비공개).
2. Vercel env `CLAUDE_ADMIN_API_KEY`는 키 발급 후. `vercel.json` cron 추가.
3. `frontend/`에서 `vercel --prod`.
4. 실물 인보이스 7장 링크 등록 → 조직 매칭·합계 확인.

## 후속 반영 (2026-09-18 저녁, 실물 11장 등록 후)

- 연간 인보이스 3장(각 12개월)이 발행 월에 통째로 잡히고 다른 달엔 "누락"으로 보여 두 가지를 추가했다: (1) 누락 판정 = 서비스 기간 커버리지(기준 무관), (2) 월 기준 토글 `basis=issued|period` — period는 일수 비례 배분(끝 미포함, 잔여는 마지막 달, VAT = 총액 − 세전), 좌석은 그 달을 덮는 마지막 장. 결정 2·3은 issued 기준의 규칙으로 유지된다.
- 갱신·연간 인보이스는 라인 설명이 `Team plan - Premium`뿐이고 좌석은 수량 열에 있다(파서 규칙 추가).

## 범위 밖(후속 후보)

- 원화 환산(카드 청구 원화·환율).
- 인보이스 자동 수집(결제 메일 파싱·Stripe 고객 포털 로그인).
- 좌석 변동 이력(인보이스 라인에서 파생 가능).
- 사용자용 `/usage`에 팀 단위 비용 배분.
