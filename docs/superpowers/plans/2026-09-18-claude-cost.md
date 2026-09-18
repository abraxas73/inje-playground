# Claude 비용 관리 페이지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 Stripe 인보이스(링크·PDF)와 Admin API cost_report로 월별 실제 청구 금액을 쌓고, `/admin/claude-cost`에서 사용량(OTel·CSV)과 나란히 본다.

**Architecture:** 인보이스 원장 2테이블(`claude_invoices`·`claude_invoice_lines`) + API 비용 1테이블(`claude_api_cost_daily`). 파싱·집계는 `lib/claude-cost/`의 순수 함수(vitest), DB·Storage·fetch는 `invoice-ingest.ts`·`anthropic-cost-report.ts`가 주입받은 클라이언트로 처리, 라우트는 인증·파라미터·호출만. 화면은 기존 Claude 사용량 대시보드와 같은 관례(SortableTable·OrgSelect·DailyBars·downloadCsv).

**Tech Stack:** Next.js 16 App Router(route handlers, nodejs runtime), Supabase(service role, Storage), unpdf(pdf.js), vitest, shadcn/ui, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-18-claude-cost-design.md`

## Global Constraints

- 금액: 인보이스는 **센트 정수**(`integer`), Admin API 비용은 **센트 `numeric`**(소수 문자열 `"123.78912"` 그대로). 부동소수 달러 저장 금지. 표시할 때만 반올림.
- 월 배정 = `issued_on`의 달력 월(`YYYY-MM`). 같은 조직·같은 달 인보이스 2장 → 청구액 합, 좌석 = seats가 있는 것 중 가장 늦게 발행된 것.
- 청구 합계 = 인보이스 합계만. Admin API 비용은 별도 열·별도 막대, 합계에 더하지 않는다.
- `CLAUDE_ADMIN_API_KEY` 없으면 API 비용 탭·열을 **렌더하지 않는다**(비활성 버튼+env 툴팁 금지).
- 링크 fetch는 `https://invoice.stripe.com/i/…`·`https://pay.stripe.com/invoice/…/pdf`만, `redirect: "manual"`, 10초, 2MB, `%PDF` 매직 확인.
- 비밀(Admin 키·Stripe 링크)은 응답·로그에 쓰지 않는다. 링크는 DB(service role)에만.
- 모든 라우트는 `requireAdmin()` + `adminClientOr500()` (`@/lib/claude-usage/require-admin`). 등록·삭제·배정·수집은 `logAudit(admin, request, { category: "usage", action, detail, userId })`.
- 파일: 새 코드는 `frontend/src/lib/claude-cost/`, `frontend/src/components/admin/claude-cost/`, `frontend/src/app/api/admin/claude-cost/`, 테스트는 `frontend/src/lib/__tests__/claude-cost-*.test.ts`. 주석·UI 문구는 한국어, 기존 파일 톤(짧은 이유 설명)을 따른다.
- 명령은 모두 `frontend/`에서: `npx vitest run <파일>`, `npm run lint`, `npx tsc --noEmit`. 워크트리에 `node_modules`가 없으면 먼저 `npm install`.
- 커밋은 현재 브랜치(`abraxas73/cost_anlalysis`)에 작업 단위로. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- 실물 인보이스 PDF·Stripe 링크·실제 금액은 저장소(테스트 픽스처·문서)에 넣지 않는다. 픽스처는 가공값.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `docs/sql/2026-09-18-claude-cost.sql` | 테이블 3개 + Storage 버킷 `claude-invoices` |
| `frontend/src/types/claude-cost.ts` | 파서 결과·DB 행·월별 집계 타입 |
| `frontend/src/lib/claude-cost/money.ts` | 금액 문자열↔센트, 영문 날짜·기간 파싱, 월 유틸 |
| `frontend/src/lib/claude-cost/stripe-invoice.ts` | 링크→PDF URL, 인보이스 줄 파서, 조직 매칭, unpdf 줄 추출 |
| `frontend/src/lib/claude-cost/invoice-ingest.ts` | PDF fetch, 저장(Storage+DB), 중복·감사 |
| `frontend/src/lib/claude-cost/anthropic-cost-report.ts` | Admin API cost_report 호출·파싱·upsert |
| `frontend/src/lib/claude-cost/monthly.ts` | 월별 집계(순수) |
| `frontend/src/lib/claude-cost/hints.ts` | 지표 툴팁 문구 |
| `frontend/src/app/api/admin/claude-cost/invoices/route.ts` | GET 목록 · POST 등록(링크/PDF) |
| `frontend/src/app/api/admin/claude-cost/invoices/[id]/route.ts` | PATCH 조직 배정 · DELETE |
| `frontend/src/app/api/admin/claude-cost/invoices/[id]/pdf/route.ts` | 서명 URL 302 |
| `frontend/src/app/api/admin/claude-cost/monthly/route.ts` | 월별 집계 |
| `frontend/src/app/api/admin/claude-cost/api-cost/route.ts` | API 비용 일별 조회 |
| `frontend/src/app/api/admin/claude-cost/api-cost/sync/route.ts` | 지금 수집 |
| `frontend/src/app/api/cron/claude-cost/route.ts` | 매일 최근 3일 재수집 |
| `frontend/src/app/admin/claude-cost/page.tsx` | 탭 페이지 |
| `frontend/src/components/admin/claude-cost/{CostOverviewTab,MonthlyBars,MonthOrgDetail,InvoiceImportTab,ApiCostTab}.tsx` | 화면 |
| 수정 `frontend/src/app/admin/layout.tsx` | ADMIN_NAV 항목 |
| 수정 `frontend/src/lib/claude-usage/aggregate.ts` | `isActive` export |
| 수정 `frontend/vercel.json` | cron 추가 |
| 수정 `CLAUDE.md`, 신규 `docs/claude-cost.md` | 문서 |

---

### Task 1: SQL · 타입 · 금액/날짜 유틸

**Files:**
- Create: `docs/sql/2026-09-18-claude-cost.sql`
- Create: `frontend/src/types/claude-cost.ts`
- Create: `frontend/src/lib/claude-cost/money.ts`
- Test: `frontend/src/lib/__tests__/claude-cost-money.test.ts`

**Interfaces:**
- Produces: 타입 `ParsedInvoiceLine`, `ParsedInvoice`, `InvoiceParseResult`, `InvoiceRow`, `InvoiceLineRow`, `ApiCostRow`, `MonthlyOrgCost`, `MonthlyCost`; 함수 `parseMoneyCents(s): number|null`, `formatCents(cents, currency?): string`, `parseEnglishDate(s): string|null`, `parsePeriod(s): {start,end}|null`, `monthOf(ymd): string`, `monthRange(month): {from,to}`, `lastMonths(n, today?): string[]`

- [ ] **Step 1: SQL 파일 작성**

```sql
-- docs/sql/2026-09-18-claude-cost.sql
-- Claude 비용 관리: Stripe 인보이스 원장 + Admin API cost_report. RLS 정책 없음 = service role 전용.

create table if not exists public.claude_invoices (
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
  source text not null check (source in ('link', 'pdf')),
  source_url text null,
  storage_path text not null,
  raw_text text not null,
  uploaded_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists claude_invoices_org_issued_idx on public.claude_invoices (org_id, issued_on);
alter table public.claude_invoices enable row level security;

create table if not exists public.claude_invoice_lines (
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
alter table public.claude_invoice_lines enable row level security;

-- Admin API cost_report: amount는 센트 단위 소수 문자열("123.78912")이라 numeric으로 그대로 보관한다.
create table if not exists public.claude_api_cost_daily (
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
alter table public.claude_api_cost_daily enable row level security;

-- 인보이스 PDF 원본(비공개, 2MB). 읽기는 서버가 서명 URL을 만든다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('claude-invoices', 'claude-invoices', false, 2097152)
on conflict (id) do update set public = false, file_size_limit = 2097152;
```

- [ ] **Step 2: 타입 파일 작성**

```ts
// frontend/src/types/claude-cost.ts
/** Claude 비용 관리 — Stripe 인보이스 원장 + Admin API cost_report + 월별 집계 */

export interface ParsedInvoiceLine {
  position: number;
  description: string;
  quantity: number | null;
  /** 음수 = 프로레이션 크레딧("Unused time on …") */
  amountCents: number;
  taxRate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** 설명 "97 × Team plan - Premium …"에서 읽은 좌석 수·티어 */
  seats: number | null;
  plan: string | null;
}

export interface ParsedInvoice {
  invoiceNumber: string;
  issuedOn: string;
  billTo: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  periodStart: string | null;
  periodEnd: string | null;
  /** 양수 금액 라인의 좌석 합 / 티어(둘 이상이면 ", "로 이어 붙임) */
  seats: number | null;
  plan: string | null;
  lines: ParsedInvoiceLine[];
}

export type InvoiceParseResult = { ok: true; invoice: ParsedInvoice } | { ok: false; errors: string[] };

/** claude_invoice_lines 한 행 */
export interface InvoiceLineRow {
  invoice_id: string;
  position: number;
  description: string;
  quantity: number | null;
  amount_cents: number;
  tax_rate: string | null;
  period_start: string | null;
  period_end: string | null;
  seats: number | null;
  plan: string | null;
}

/** claude_invoices 한 행(API 응답 — raw_text·storage_path는 내려주지 않는다) */
export interface InvoiceRow {
  id: string;
  invoice_number: string;
  org_id: string | null;
  bill_to: string;
  issued_on: string;
  period_start: string | null;
  period_end: string | null;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  seats: number | null;
  plan: string | null;
  source: "link" | "pdf";
  source_url: string | null;
  created_at: string;
  lines?: InvoiceLineRow[];
}

/** claude_api_cost_daily 한 행 — amount_cents는 소수 센트 문자열 그대로 */
export interface ApiCostRow {
  day: string;
  workspace_id: string;
  description: string;
  cost_type: string | null;
  model: string | null;
  amount_cents: string;
  currency: string;
}

export interface MonthlyOrgCost {
  /** null = Bill to가 어느 조직과도 맞지 않아 미배정 */
  orgId: string | null;
  name: string;
  invoices: InvoiceRow[];
  totalCents: number;
  seats: number | null;
  plan: string | null;
  /** OTel Claude Code 활성 사용자(그 달, 그 조직) */
  activeUsers: number;
  estCostUsd: number;
}

export interface MonthlyCost {
  /** YYYY-MM */
  month: string;
  invoices: number;
  billed: { subtotalCents: number; taxCents: number; totalCents: number };
  seats: number | null;
  /** 이 달 인보이스가 없는 Team 조직 이름 */
  missingOrgs: string[];
  unassignedCents: number;
  /** Admin API 비용(센트, 소수 가능). 키가 없으면 null */
  apiCostCents: number | null;
  usage: { activeUsers: number; sessions: number; promptsHuman: number; estCostUsd: number };
  /** 그 달에 끝나는 멤버 활동 CSV(조직별 최신)의 활동 멤버 합. 없으면 null */
  csvActiveMembers: number | null;
  perOrg: MonthlyOrgCost[];
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-cost-money.test.ts
import { describe, it, expect } from "vitest";
import { formatCents, lastMonths, monthOf, monthRange, parseEnglishDate, parseMoneyCents, parsePeriod } from "@/lib/claude-cost/money";

describe("parseMoneyCents", () => {
  it("달러 문자열을 센트 정수로 바꾼다(천 단위 구분·음수·US$ 접두)", () => {
    expect(parseMoneyCents("$12,072.22")).toBe(1207222);
    expect(parseMoneyCents("-$4,978.24")).toBe(-497824);
    expect(parseMoneyCents("US$7,803.38")).toBe(780338);
    expect(parseMoneyCents("$0.00")).toBe(0);
  });
  it("형식이 다르면 null", () => {
    expect(parseMoneyCents("7,093.98")).toBeNull();
    expect(parseMoneyCents("$12")).toBeNull();
    expect(parseMoneyCents("97")).toBeNull();
  });
});

describe("formatCents", () => {
  it("센트 → $1,234.56, 음수·반올림 포함", () => {
    expect(formatCents(1207222)).toBe("$12,072.22");
    expect(formatCents(-497824)).toBe("-$4,978.24");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123.78912)).toBe("$1.24");
  });
});

describe("parseEnglishDate", () => {
  it("영문 월 이름 날짜", () => {
    expect(parseEnglishDate("August 23, 2026")).toBe("2026-08-23");
    expect(parseEnglishDate("Sep 1, 2026")).toBe("2026-09-01");
    expect(parseEnglishDate("2026-08-23")).toBeNull();
  });
});

describe("parsePeriod", () => {
  it("연도가 뒤에 하나만 있으면 앞 날짜도 그 연도", () => {
    expect(parsePeriod("Aug 23–Sep 23, 2026")).toEqual({ start: "2026-08-23", end: "2026-09-23" });
    expect(parsePeriod("Aug 23 - Sep 23, 2026")).toEqual({ start: "2026-08-23", end: "2026-09-23" });
  });
  it("연말을 걸치면 앞 날짜 연도를 하나 뺀다", () => {
    expect(parsePeriod("Dec 23–Jan 23, 2027")).toEqual({ start: "2026-12-23", end: "2027-01-23" });
  });
  it("양쪽에 연도가 있으면 그대로", () => {
    expect(parsePeriod("Dec 23, 2026–Jan 23, 2027")).toEqual({ start: "2026-12-23", end: "2027-01-23" });
  });
  it("기간이 아니면 null", () => {
    expect(parsePeriod("Remaining time on 97 × Team plan - Premium after 24 Aug 2026")).toBeNull();
    expect(parsePeriod("Aug 23–Sep 23")).toBeNull();
  });
});

describe("월 유틸", () => {
  it("monthOf·monthRange", () => {
    expect(monthOf("2026-08-23")).toBe("2026-08");
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("lastMonths는 KST 이번 달을 포함해 오래된 → 최신 순", () => {
    // 2026-09-30 23:30 UTC = 2026-10-01 08:30 KST → 10월이 이번 달
    expect(lastMonths(3, new Date("2026-09-30T23:30:00Z"))).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(lastMonths(1, new Date("2026-01-15T00:00:00Z"))).toEqual(["2026-01"]);
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-money.test.ts`
Expected: FAIL — `Cannot find module '@/lib/claude-cost/money'`

- [ ] **Step 5: money.ts 구현**

```ts
// frontend/src/lib/claude-cost/money.ts
/** 금액·날짜 유틸. 금액은 센트 정수로만 다룬다(부동소수 달러 금지). */

const MONEY_RE = /^(-)?(?:US)?\$\s*([\d,]+)\.(\d{2})$/;

/** "$12,072.22" | "-$4,978.24" | "US$7,803.38" → 센트 정수. 형식이 다르면 null */
export function parseMoneyCents(s: string): number | null {
  const m = MONEY_RE.exec(s.trim());
  if (!m) return null;
  const whole = Number(m[2].replace(/,/g, ""));
  if (!Number.isInteger(whole)) return null;
  const cents = whole * 100 + Number(m[3]);
  return m[1] ? -cents : cents;
}

/** 센트 → "$1,234.56". 소수 센트(Admin API)는 반올림 */
export function formatCents(cents: number, currency = "USD"): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${sign}${symbol}${whole}.${frac}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (name: string): number => MONTHS.indexOf(name.toLowerCase().slice(0, 3));
const ymd = (y: number, m: number, d: number): string => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "August 23, 2026" | "Aug 23, 2026" → "2026-08-23" */
export function parseEnglishDate(s: string): string | null {
  const m = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mi = monthIndex(m[1]);
  if (mi < 0) return null;
  return ymd(Number(m[3]), mi + 1, Number(m[2]));
}

const DATE_PART = String.raw`([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?`;
const PERIOD_RE = new RegExp(String.raw`^${DATE_PART}\s*[–—-]\s*${DATE_PART}$`);

/**
 * Stripe 라인 아이템 기간 "Aug 23–Sep 23, 2026". 연도는 뒤에만 있는 게 보통이라 앞 날짜에 보정하고,
 * 연말을 걸치면(12월→1월) 앞 연도를 하나 뺀다. 둘 다 연도가 없으면 기간으로 보지 않는다.
 */
export function parsePeriod(s: string): { start: string; end: string } | null {
  const m = PERIOD_RE.exec(s.trim());
  if (!m) return null;
  const m1 = monthIndex(m[1]);
  const m2 = monthIndex(m[4]);
  if (m1 < 0 || m2 < 0) return null;
  const d1 = Number(m[2]);
  const d2 = Number(m[5]);
  const startBeforeEnd = m1 < m2 || (m1 === m2 && d1 <= d2);
  let y1 = m[3] ? Number(m[3]) : null;
  let y2 = m[6] ? Number(m[6]) : null;
  if (y1 === null && y2 === null) return null;
  if (y1 === null) y1 = startBeforeEnd ? (y2 as number) : (y2 as number) - 1;
  if (y2 === null) y2 = startBeforeEnd ? y1 : y1 + 1;
  return { start: ymd(y1, m1 + 1, d1), end: ymd(y2, m2 + 1, d2) };
}

export const monthOf = (day: string): string => day.slice(0, 7);

/** "2026-02" → { from: "2026-02-01", to: "2026-02-28" } */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 이번 달을 포함한 최근 n개월(오래된 → 최신) */
export function lastMonths(n: number, today: Date = new Date()): string[] {
  const t = new Date(today.getTime() + KST_OFFSET_MS);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-money.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 7: 커밋**

```bash
git add docs/sql/2026-09-18-claude-cost.sql frontend/src/types/claude-cost.ts frontend/src/lib/claude-cost/money.ts frontend/src/lib/__tests__/claude-cost-money.test.ts
git commit -m "feat(claude-cost): 인보이스·API 비용 테이블 SQL, 타입, 금액·날짜 유틸

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Stripe 인보이스 파서(순수)

**Files:**
- Create: `frontend/src/lib/claude-cost/stripe-invoice.ts`
- Test: `frontend/src/lib/__tests__/claude-cost-stripe-invoice.test.ts`

**Interfaces:**
- Consumes: `parseMoneyCents`, `parseEnglishDate`, `parsePeriod` (Task 1); 타입 `ParsedInvoice`, `ParsedInvoiceLine`, `InvoiceParseResult`
- Produces: `interface InvoiceTextLine { text: string; frags: { x0: number; text: string }[] }`, `invoiceLinkToPdfUrl(url): string|null`, `parseStripeInvoice(lines: InvoiceTextLine[]): InvoiceParseResult`, `matchOrg(billTo, orgs: {id,name}[]): string|null`, `isPdf(bytes: Uint8Array): boolean`. (`extractInvoiceLines`는 Task 3에서 같은 파일에 추가)

- [ ] **Step 1: 실패하는 테스트 작성**

픽스처는 실물 레이아웃(`pdftotext -layout`)을 본떴고 조직명·번호·금액은 가공값이다. `L(text, frags?)`는 한 줄을 만든다(frags를 주지 않으면 x0=0 조각 하나).

```ts
// frontend/src/lib/__tests__/claude-cost-stripe-invoice.test.ts
import { describe, it, expect } from "vitest";
import { invoiceLinkToPdfUrl, matchOrg, parseStripeInvoice, isPdf, type InvoiceTextLine } from "@/lib/claude-cost/stripe-invoice";

const L = (text: string, frags?: { x0: number; text: string }[]): InvoiceTextLine => ({ text, frags: frags ?? [{ x0: 0, text }] });

/** 프로레이션 2줄(좌석 40→97), VAT 10% */
const PRORATED: InvoiceTextLine[] = [
  L("Invoice"),
  L("Invoice number TEST0001-0003"),
  L("Date of issue August 23, 2026"),
  L("Date due August 23, 2026"),
  L("Anthropic, PBC @anthropic Bill to", [{ x0: 36, text: "Anthropic, PBC @anthropic" }, { x0: 306, text: "Bill to" }]),
  L("548 Market Street Innogrid-zz", [{ x0: 36, text: "548 Market Street" }, { x0: 306, text: "Innogrid-zz" }]),
  L("PMB 90375 서울시 중구 을지로 100", [{ x0: 36, text: "PMB 90375" }, { x0: 306, text: "서울시 중구 을지로 100" }]),
  L("$6,600.00 USD due August 23, 2026"),
  L("Description Qty Unit price Tax Amount"),
  L("Remaining time on 97 × Team plan - Premium after 24 Aug 2026 97 10% $10,000.00"),
  L("Aug 23–Sep 23, 2026"),
  L("Unused time on 40 × Team plan - Premium after 24 Aug 2026 40 10% -$4,000.00"),
  L("Aug 23–Sep 23, 2026"),
  L("Subtotal $6,000.00"),
  L("Total excluding tax $6,000.00"),
  L("VAT - South Korea (10% on $6,000.00) $600.00"),
  L("Total $6,600.00"),
  L("Amount due $6,600.00 USD"),
  L("Page 1 of 1"),
];

const replaceLine = (lines: InvoiceTextLine[], from: string, to: string | null): InvoiceTextLine[] =>
  lines.flatMap((l) => (l.text === from ? (to === null ? [] : [L(to)]) : [l]));

describe("parseStripeInvoice", () => {
  it("프로레이션 인보이스: 라인 2개, 좌석은 양수 라인 97, 크레딧은 음수", () => {
    const r = parseStripeInvoice(PRORATED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inv = r.invoice;
    expect(inv.invoiceNumber).toBe("TEST0001-0003");
    expect(inv.issuedOn).toBe("2026-08-23");
    expect(inv.billTo).toBe("Innogrid-zz");
    expect(inv.currency).toBe("USD");
    expect(inv.subtotalCents).toBe(600000);
    expect(inv.taxCents).toBe(60000);
    expect(inv.totalCents).toBe(660000);
    expect(inv.periodStart).toBe("2026-08-23");
    expect(inv.periodEnd).toBe("2026-09-23");
    expect(inv.seats).toBe(97);
    expect(inv.plan).toBe("Team plan - Premium");
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0]).toEqual({ position: 0, description: "Remaining time on 97 × Team plan - Premium after 24 Aug 2026", quantity: 97, amountCents: 1000000, taxRate: "10%", periodStart: "2026-08-23", periodEnd: "2026-09-23", seats: 97, plan: "Team plan - Premium" });
    expect(inv.lines[1].amountCents).toBe(-400000);
    expect(inv.lines[1].seats).toBe(40);
  });

  it("단일 갱신 라인(단가 열 있음)도 읽는다", () => {
    const lines = [
      ...PRORATED.slice(0, 9),
      L("97 × Team plan - Premium 97 $61.86 10% $6,000.00"),
      L("Sep 23–Oct 23, 2026"),
      ...PRORATED.slice(13),
    ];
    const r = parseStripeInvoice(lines);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.invoice.lines).toHaveLength(1);
    expect(r.invoice.lines[0]).toMatchObject({ quantity: 97, amountCents: 600000, seats: 97, plan: "Team plan - Premium", periodStart: "2026-09-23", periodEnd: "2026-10-23" });
  });

  it("VAT 줄이 없으면 세액 0", () => {
    let lines = replaceLine(PRORATED, "VAT - South Korea (10% on $6,000.00) $600.00", null);
    lines = replaceLine(lines, "Total $6,600.00", "Total $6,000.00");
    lines = replaceLine(lines, "Amount due $6,600.00 USD", "Amount due $6,000.00 USD");
    const r = parseStripeInvoice(lines);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.invoice.taxCents).toBe(0); expect(r.invoice.totalCents).toBe(600000); }
  });

  it("라인 합이 소계와 다르면 거절한다(라인을 놓친 신호)", () => {
    const lines = replaceLine(PRORATED, "Unused time on 40 × Team plan - Premium after 24 Aug 2026 40 10% -$4,000.00", null);
    const r = parseStripeInvoice(lines);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("소계"))).toBe(true);
  });

  it("소계+세액 ≠ 총액이면 거절한다", () => {
    const r = parseStripeInvoice(replaceLine(PRORATED, "Total $6,600.00", "Total $6,700.00"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("총액"))).toBe(true);
  });

  it("Anthropic 인보이스가 아니면 거절한다", () => {
    const r = parseStripeInvoice(PRORATED.map((l) => (l.text.includes("Anthropic") ? L("Some Vendor Bill to", [{ x0: 36, text: "Some Vendor" }, { x0: 306, text: "Bill to" }]) : l)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("Anthropic");
  });

  it("라인 아이템이 하나도 없으면 거절한다", () => {
    const lines = PRORATED.filter((l) => !/Team plan|Aug 23–Sep 23/.test(l.text));
    const r = parseStripeInvoice(lines);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("라인 아이템"))).toBe(true);
  });

  it("Bill to는 그 열(x0) 아래 조각만 읽고 왼쪽 발행자 주소는 섞지 않는다", () => {
    const r = parseStripeInvoice(PRORATED);
    if (r.ok) expect(r.invoice.billTo).toBe("Innogrid-zz");
    const twoFrags = PRORATED.map((l) => (l.text.startsWith("548 Market") ? L("548 Market Street Innogrid Cloud Team", [{ x0: 36, text: "548 Market Street" }, { x0: 306, text: "Innogrid Cloud" }, { x0: 380, text: "Team" }]) : l));
    const r2 = parseStripeInvoice(twoFrags);
    if (r2.ok) expect(r2.invoice.billTo).toBe("Innogrid Cloud Team");
  });

  it("Bill to가 없으면 오류에 포함된다", () => {
    const r = parseStripeInvoice(PRORATED.filter((l) => !l.text.includes("Bill to")));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("Bill to"))).toBe(true);
  });

  it("연말을 걸치는 기간도 라인에 붙는다", () => {
    let lines = replaceLine(PRORATED, "Aug 23–Sep 23, 2026", "Dec 23–Jan 23, 2027");
    lines = lines.map((l) => (l.text === "Aug 23–Sep 23, 2026" ? L("Dec 23–Jan 23, 2027") : l));
    const r = parseStripeInvoice(lines);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.invoice.periodStart).toBe("2026-12-23"); expect(r.invoice.periodEnd).toBe("2027-01-23"); }
  });
});

describe("invoiceLinkToPdfUrl", () => {
  it("호스팅 페이지 링크 → pay.stripe.com PDF 링크(쿼리 유지)", () => {
    expect(invoiceLinkToPdfUrl("https://invoice.stripe.com/i/acct_1AbC/live_XyZ_0200?s=ap")).toBe("https://pay.stripe.com/invoice/acct_1AbC/live_XyZ_0200/pdf?s=ap");
    expect(invoiceLinkToPdfUrl(" https://invoice.stripe.com/i/acct_1AbC/live_XyZ ")).toBe("https://pay.stripe.com/invoice/acct_1AbC/live_XyZ/pdf");
  });
  it("이미 PDF 링크면 그대로", () => {
    expect(invoiceLinkToPdfUrl("https://pay.stripe.com/invoice/acct_1AbC/live_XyZ/pdf?s=ap")).toBe("https://pay.stripe.com/invoice/acct_1AbC/live_XyZ/pdf?s=ap");
  });
  it("다른 호스트·http·이상한 경로는 null", () => {
    expect(invoiceLinkToPdfUrl("https://evil.example.com/i/acct_1/live_2")).toBeNull();
    expect(invoiceLinkToPdfUrl("http://invoice.stripe.com/i/acct_1/live_2")).toBeNull();
    expect(invoiceLinkToPdfUrl("https://invoice.stripe.com/i/acct_1")).toBeNull();
    expect(invoiceLinkToPdfUrl("https://invoice.stripe.com/i/acct_1/live_2/../x")).toBeNull();
  });
});

describe("matchOrg", () => {
  const orgs = [{ id: "o1", name: "Innogrid-ax" }, { id: "o2", name: "Innogrid-bx" }, { id: "o3", name: "Innogrid AX" }];
  it("대소문자·하이픈·공백을 무시해 하나만 맞으면 그 id", () => {
    expect(matchOrg("innogrid-bx", orgs)).toBe("o2");
    expect(matchOrg("INNOGRID BX", orgs)).toBe("o2");
  });
  it("둘 이상 맞거나 하나도 없으면 null", () => {
    expect(matchOrg("Innogrid-ax", orgs)).toBeNull(); // o1·o3 둘 다 맞음
    expect(matchOrg("Innogrid-zz", orgs)).toBeNull();
  });
});

describe("isPdf", () => {
  it("%PDF 매직으로 판정", () => {
    expect(isPdf(new TextEncoder().encode("%PDF-1.4 ..."))).toBe(true);
    expect(isPdf(new TextEncoder().encode("<!doctype html>"))).toBe(false);
    expect(isPdf(new Uint8Array(0))).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-stripe-invoice.test.ts`
Expected: FAIL — `Cannot find module '@/lib/claude-cost/stripe-invoice'`

- [ ] **Step 3: stripe-invoice.ts 구현(파서 부분)**

```ts
// frontend/src/lib/claude-cost/stripe-invoice.ts
/**
 * Anthropic(Stripe) 인보이스 PDF → ParsedInvoice.
 *
 * Stripe PDF는 글자 좌표만 있고 원시 순서는 뒤섞여 있어(라벨·값이 따로 나온다) **줄 단위로 복원한 텍스트**를 읽는다.
 * 실물 레이아웃(2026-08): "Invoice number X" / "Date of issue Month D, YYYY" / 왼쪽 발행자 주소·오른쪽 "Bill to" 열 /
 * "Description Qty Unit price Tax Amount" 표 → 라인 줄 + 다음 줄 기간 "Aug 23–Sep 23, 2026" → Subtotal · VAT · Total · Amount due.
 * 좌석 변경 시 프로레이션 2줄("Remaining time on 97 ×" +, "Unused time on 40 ×" −)이 들어온다.
 * 합계 검증(Σ라인 = 소계, 소계+세액 = 총액)에 어긋나면 라인을 놓친 것이므로 저장을 거절한다.
 */
import { parseEnglishDate, parseMoneyCents, parsePeriod, formatCents } from "./money";
import type { InvoiceParseResult, ParsedInvoice, ParsedInvoiceLine } from "@/types/claude-cost";

/** 좌표로 복원한 한 줄. frags는 왼쪽→오른쪽 순, Bill to 열을 찾을 때만 x0를 쓴다 */
export interface InvoiceTextLine {
  text: string;
  frags: { x0: number; text: string }[];
}

const INVOICE_LINK_RE = /^https:\/\/invoice\.stripe\.com\/i\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)(?:\/pdf)?(\?[^#\s]*)?$/;
const PAY_LINK_RE = /^https:\/\/pay\.stripe\.com\/invoice\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\/pdf(\?[^#\s]*)?$/;

/** 결제 메일의 호스팅 페이지 링크 → 서버가 인증 없이 받을 수 있는 PDF 링크. 허용 호스트 밖이면 null */
export function invoiceLinkToPdfUrl(url: string): string | null {
  const s = url.trim();
  const m = INVOICE_LINK_RE.exec(s) ?? PAY_LINK_RE.exec(s);
  if (!m) return null;
  return `https://pay.stripe.com/invoice/${m[1]}/${m[2]}/pdf${m[3] ?? ""}`;
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

const MONEY = String.raw`-?(?:US)?\$[\d,]+\.\d{2}`;
/** 설명 · 수량 · [단가] · [세율] · 금액 — 금액이 줄 끝이라 설명 안의 숫자(97, 24 Aug 2026)와 헷갈리지 않는다 */
const ITEM_RE = new RegExp(String.raw`^(.+?)\s+(\d+)(?:\s+(${MONEY}))?(?:\s+(\d+(?:\.\d+)?%))?\s+(${MONEY})$`);
const SEATS_RE = /^(?:Remaining time on |Unused time on )?(\d+)\s*[×x]\s*(.+?)(?:\s+after\s+.+)?$/;
const SUBTOTAL_RE = new RegExp(String.raw`^Subtotal\s+(${MONEY})$`);
const TAX_RE = new RegExp(String.raw`^(?:VAT|Tax|GST)\b.*\s(${MONEY})$`);
const TOTAL_RE = new RegExp(String.raw`^Total\s+(${MONEY})$`);
const DUE_RE = new RegExp(String.raw`^Amount due\s+${MONEY}\s+([A-Z]{3})\b`);
/** Bill to 열로 볼 x 허용 오차(pt) — 같은 열의 조각은 x0가 거의 같다 */
const COLUMN_TOL = 20;

function firstMatch(texts: string[], re: RegExp): string | null {
  for (const t of texts) {
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

function moneyAt(texts: string[], re: RegExp): number | null {
  const s = firstMatch(texts, re);
  return s === null ? null : parseMoneyCents(s);
}

/** "Bill to" 조각의 x0 아래 첫 줄에서 같은 열(오른쪽) 조각만 이어 붙인다 — 왼쪽 열은 발행자 주소다 */
function findBillTo(lines: InvoiceTextLine[]): string | null {
  const idx = lines.findIndex((l) => l.frags.some((f) => f.text.trim() === "Bill to"));
  if (idx < 0) return null;
  const x = lines[idx].frags.find((f) => f.text.trim() === "Bill to")!.x0;
  for (let i = idx + 1; i < Math.min(lines.length, idx + 3); i++) {
    const own = lines[i].frags.filter((f) => f.x0 >= x - COLUMN_TOL).map((f) => f.text.trim()).filter(Boolean);
    if (own.length) return own.join(" ");
  }
  return null;
}

export function parseStripeInvoice(lines: InvoiceTextLine[]): InvoiceParseResult {
  const errors: string[] = [];
  const texts = lines.map((l) => l.text.trim());

  if (!texts.some((t) => t.includes("Anthropic"))) errors.push("Anthropic 인보이스가 아닙니다.");
  const invoiceNumber = firstMatch(texts, /^Invoice number\s+(\S+)/);
  if (!invoiceNumber) errors.push("인보이스 번호를 찾을 수 없습니다.");
  const issuedRaw = firstMatch(texts, /^Date of issue\s+(.+)$/);
  const issuedOn = issuedRaw ? parseEnglishDate(issuedRaw) : null;
  if (!issuedOn) errors.push("발행일을 읽을 수 없습니다.");
  const billTo = findBillTo(lines);
  if (!billTo) errors.push("Bill to(청구 대상)를 찾을 수 없습니다.");

  const items: ParsedInvoiceLine[] = [];
  const headerIdx = texts.findIndex((t) => /^Description\b/.test(t));
  const subtotalIdx = texts.findIndex((t) => SUBTOTAL_RE.test(t));
  if (headerIdx < 0 || subtotalIdx < 0 || subtotalIdx <= headerIdx) {
    errors.push("라인 아이템 표(Description … Subtotal)를 찾을 수 없습니다.");
  } else {
    for (let i = headerIdx + 1; i < subtotalIdx; i++) {
      const m = ITEM_RE.exec(texts[i]);
      if (!m) continue;
      const amountCents = parseMoneyCents(m[5]);
      if (amountCents === null) { errors.push(`금액을 읽을 수 없습니다: ${texts[i]}`); continue; }
      const period = i + 1 < subtotalIdx ? parsePeriod(texts[i + 1]) : null;
      if (period) i++;
      const s = SEATS_RE.exec(m[1]);
      items.push({
        position: items.length,
        description: m[1],
        quantity: Number(m[2]),
        amountCents,
        taxRate: m[4] ?? null,
        periodStart: period?.start ?? null,
        periodEnd: period?.end ?? null,
        seats: s ? Number(s[1]) : null,
        plan: s ? s[2] : null,
      });
    }
    if (items.length === 0) errors.push("라인 아이템이 없습니다.");
  }

  const subtotalCents = moneyAt(texts, SUBTOTAL_RE);
  const taxCents = moneyAt(texts, TAX_RE) ?? 0;
  const totalCents = moneyAt(texts, TOTAL_RE);
  if (subtotalCents === null) errors.push("소계(Subtotal)를 찾을 수 없습니다.");
  if (totalCents === null) errors.push("총액(Total)을 찾을 수 없습니다.");
  if (subtotalCents !== null && items.length) {
    const sum = items.reduce((a, l) => a + l.amountCents, 0);
    if (sum !== subtotalCents) errors.push(`라인 합(${formatCents(sum)})이 소계(${formatCents(subtotalCents)})와 다릅니다 — 라인을 놓쳤을 수 있습니다.`);
  }
  if (subtotalCents !== null && totalCents !== null && subtotalCents + taxCents !== totalCents) {
    errors.push(`소계+세액(${formatCents(subtotalCents + taxCents)})이 총액(${formatCents(totalCents)})과 다릅니다.`);
  }
  if (errors.length || !invoiceNumber || !issuedOn || !billTo || subtotalCents === null || totalCents === null) {
    return { ok: false, errors };
  }

  const positive = items.filter((l) => l.amountCents > 0 && l.seats !== null);
  const plans = [...new Set(positive.map((l) => l.plan).filter((p): p is string => !!p))];
  const starts = items.map((l) => l.periodStart).filter((d): d is string => !!d).sort();
  const ends = items.map((l) => l.periodEnd).filter((d): d is string => !!d).sort();
  const invoice: ParsedInvoice = {
    invoiceNumber,
    issuedOn,
    billTo,
    currency: firstMatch(texts, DUE_RE) ?? "USD",
    subtotalCents,
    taxCents,
    totalCents,
    periodStart: starts[0] ?? null,
    periodEnd: ends[ends.length - 1] ?? null,
    seats: positive.length ? positive.reduce((a, l) => a + (l.seats ?? 0), 0) : null,
    plan: plans.length ? plans.join(", ") : null,
    lines: items,
  };
  return { ok: true, invoice };
}

const normalizeName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");

/** Bill to 이름 ↔ claude_orgs.name — 대소문자·하이픈·공백 무시. 정확히 하나만 맞을 때만 배정한다 */
export function matchOrg(billTo: string, orgs: { id: string; name: string }[]): string | null {
  const key = normalizeName(billTo);
  if (!key) return null;
  const hits = orgs.filter((o) => normalizeName(o.name) === key);
  return hits.length === 1 ? hits[0].id : null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-stripe-invoice.test.ts`
Expected: PASS (16 tests). 실패하면 정규식이 아니라 픽스처 줄 텍스트를 먼저 의심하지 말고, `ITEM_RE`가 `$` 앵커 덕분에 마지막 금액만 잡는지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/claude-cost/stripe-invoice.ts frontend/src/lib/__tests__/claude-cost-stripe-invoice.test.ts
git commit -m "feat(claude-cost): Stripe 인보이스 줄 파서·링크 변환·조직 매칭

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: PDF 줄 추출 · 인보이스 등록(fetch·Storage·DB)

**Files:**
- Modify: `frontend/src/lib/claude-cost/stripe-invoice.ts` (`extractInvoiceLines` 추가)
- Create: `frontend/src/lib/claude-cost/invoice-ingest.ts`
- Test: `frontend/src/lib/__tests__/claude-cost-invoice-ingest.test.ts`

**Interfaces:**
- Consumes: `fragsOfPage`, `groupLines`, `joinFrags` (`@/lib/rfp/parse-pdf`, 이미 export됨 — parse-pdf.ts는 고치지 않는다); `parseStripeInvoice`, `matchOrg`, `isPdf`, `invoiceLinkToPdfUrl` (Task 2); `logAudit` (`@/lib/audit`)
- Produces: `extractInvoiceLines(pdf: Uint8Array): Promise<InvoiceTextLine[]>`; `INVOICE_BUCKET = "claude-invoices"`, `MAX_INVOICE_BYTES = 2 * 1024 * 1024`; `type IngestResult = { ok: true; invoice: InvoiceRow } | { ok: false; duplicate: { id: string; org_id: string | null; issued_on: string; invoice_number: string } } | { ok: false; errors: string[] }`; `fetchInvoicePdf(url, fetchImpl?): Promise<{ ok: true; bytes: Uint8Array; pdfUrl: string } | { ok: false; error: string }>`; `ingestInvoice(input, deps): Promise<IngestResult>`; `INVOICE_COLUMNS` (select 문자열)

- [ ] **Step 1: 실패하는 테스트 작성(fetchInvoicePdf — fetch 주입)**

```ts
// frontend/src/lib/__tests__/claude-cost-invoice-ingest.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchInvoicePdf, MAX_INVOICE_BYTES } from "@/lib/claude-cost/invoice-ingest";

const pdfBytes = new TextEncoder().encode("%PDF-1.4 fake");
const okResponse = (body: Uint8Array, headers: Record<string, string> = { "content-type": "application/pdf" }, status = 200) =>
  new Response(body, { status, headers });

describe("fetchInvoicePdf", () => {
  it("호스팅 링크를 PDF 링크로 바꿔 받고 바이트를 돌려준다", async () => {
    const fetchImpl = vi.fn(async () => okResponse(pdfBytes));
    const r = await fetchInvoicePdf("https://invoice.stripe.com/i/acct_1/live_2?s=ap", fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.pdfUrl).toBe("https://pay.stripe.com/invoice/acct_1/live_2/pdf?s=ap"); expect(r.bytes).toEqual(pdfBytes); }
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://pay.stripe.com/invoice/acct_1/live_2/pdf?s=ap");
    expect(init.redirect).toBe("manual");
  });

  it("허용 호스트가 아니면 fetch 없이 거절한다", async () => {
    const fetchImpl = vi.fn();
    const r = await fetchInvoicePdf("https://evil.example.com/i/acct_1/live_2", fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("PDF가 아니면(HTML 응답·리디렉션) 거절하고 URL은 메시지에 넣지 않는다", async () => {
    const html = vi.fn(async () => okResponse(new TextEncoder().encode("<!doctype html>"), { "content-type": "text/html" }));
    const r1 = await fetchInvoicePdf("https://invoice.stripe.com/i/acct_1/live_2", html as unknown as typeof fetch);
    expect(r1.ok).toBe(false);
    if (!r1.ok) { expect(r1.error).toContain("PDF"); expect(r1.error).not.toContain("stripe.com"); }
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://x" } }));
    const r2 = await fetchInvoicePdf("https://invoice.stripe.com/i/acct_1/live_2", redirect as unknown as typeof fetch);
    expect(r2.ok).toBe(false);
  });

  it("2MB를 넘으면 거절한다", async () => {
    const big = new Uint8Array(MAX_INVOICE_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const fetchImpl = vi.fn(async () => okResponse(big));
    const r = await fetchInvoicePdf("https://invoice.stripe.com/i/acct_1/live_2", fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("2MB");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-invoice-ingest.test.ts`
Expected: FAIL — `Cannot find module '@/lib/claude-cost/invoice-ingest'`

- [ ] **Step 3: `extractInvoiceLines` 추가 (stripe-invoice.ts 끝에)**

```ts
// stripe-invoice.ts 맨 위 import에 추가
import { fragsOfPage, groupLines, joinFrags } from "@/lib/rfp/parse-pdf";

// 파일 끝에 추가
/**
 * PDF 바이트 → 좌표로 복원한 줄. RFP 파서와 같은 조각 추출·줄 묶기를 쓰되 표(괘선)는 보지 않는다.
 * unpdf는 서버리스용 pdf.js 묶음이라 동적 import로 실제 요청에서만 로드한다.
 */
export async function extractInvoiceLines(pdf: Uint8Array): Promise<InvoiceTextLine[]> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const out: InvoiceTextLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const line of groupLines(fragsOfPage(content.items))) {
      const text = joinFrags(line.frags);
      if (!text) continue;
      out.push({ text, frags: line.frags.map((f) => ({ x0: f.x0, text: f.text })) });
    }
  }
  return out;
}
```

- [ ] **Step 4: invoice-ingest.ts 구현**

```ts
// frontend/src/lib/claude-cost/invoice-ingest.ts
/**
 * 인보이스 등록: PDF 바이트(링크에서 받았든 업로드했든) → 파싱·검증 → 중복 확인 → Storage → DB → 감사 로그.
 * 라우트는 이 함수만 부른다. 실패는 예외가 아니라 결과 값으로 돌려 건별 결과를 화면에 그대로 보여준다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { extractInvoiceLines, invoiceLinkToPdfUrl, isPdf, matchOrg, parseStripeInvoice } from "./stripe-invoice";
import type { InvoiceRow } from "@/types/claude-cost";

export const INVOICE_BUCKET = "claude-invoices";
export const MAX_INVOICE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

/** 응답에 내려주는 컬럼 — raw_text·storage_path는 제외 */
export const INVOICE_COLUMNS = "id, invoice_number, org_id, bill_to, issued_on, period_start, period_end, currency, subtotal_cents, tax_cents, total_cents, seats, plan, source, source_url, created_at";

export type IngestResult =
  | { ok: true; invoice: InvoiceRow }
  | { ok: false; duplicate: { id: string; org_id: string | null; issued_on: string; invoice_number: string } }
  | { ok: false; errors: string[] };

/** Stripe 링크 → PDF 바이트. 허용 호스트만, 리디렉션 미추적, 10초·2MB 상한. 오류 문구에 URL을 넣지 않는다 */
export async function fetchInvoicePdf(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; bytes: Uint8Array; pdfUrl: string } | { ok: false; error: string }> {
  const pdfUrl = invoiceLinkToPdfUrl(url);
  if (!pdfUrl) return { ok: false, error: "Stripe 인보이스 링크(invoice.stripe.com/i/…)만 받을 수 있습니다." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(pdfUrl, { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": "inje-playground/1.0 (+https://inje-playground.vercel.app)" } });
    if (!res.ok) return { ok: false, error: `PDF를 받지 못했습니다(HTTP ${res.status}) — PDF 파일로 올려 주세요.` };
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_INVOICE_BYTES) return { ok: false, error: "PDF가 2MB를 초과합니다." };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_INVOICE_BYTES) return { ok: false, error: "PDF가 2MB를 초과합니다." };
    if (!isPdf(bytes)) return { ok: false, error: "받은 파일이 PDF가 아닙니다 — 링크가 만료됐거나 형식이 바뀌었을 수 있습니다. PDF 파일로 올려 주세요." };
    return { ok: true, bytes, pdfUrl };
  } catch (e) {
    const timeout = e instanceof Error && e.name === "AbortError";
    return { ok: false, error: timeout ? "PDF 받기가 10초를 넘겨 중단했습니다." : "PDF를 받지 못했습니다 — PDF 파일로 올려 주세요." };
  } finally {
    clearTimeout(timer);
  }
}

export async function ingestInvoice(
  input: { bytes: Uint8Array; source: "link" | "pdf"; sourceUrl?: string | null },
  deps: { admin: SupabaseClient; orgs: { id: string; name: string }[]; uploadedBy: string | null; request: { headers: Headers } | null },
): Promise<IngestResult> {
  const { admin } = deps;
  if (input.bytes.length > MAX_INVOICE_BYTES) return { ok: false, errors: ["PDF가 2MB를 초과합니다."] };
  if (!isPdf(input.bytes)) return { ok: false, errors: ["PDF 파일이 아닙니다."] };

  let lines;
  try {
    lines = await extractInvoiceLines(input.bytes);
  } catch (e) {
    return { ok: false, errors: [`PDF를 열 수 없습니다: ${e instanceof Error ? e.message : "알 수 없는 오류"}`] };
  }
  const parsed = parseStripeInvoice(lines);
  if (!parsed.ok) return parsed;
  const inv = parsed.invoice;

  const dup = await admin.from("claude_invoices").select("id, org_id, issued_on, invoice_number").eq("invoice_number", inv.invoiceNumber).maybeSingle();
  if (dup.error) return { ok: false, errors: [dup.error.message] };
  if (dup.data) return { ok: false, duplicate: dup.data as { id: string; org_id: string | null; issued_on: string; invoice_number: string } };

  const orgId = matchOrg(inv.billTo, deps.orgs);
  const storagePath = `${inv.invoiceNumber}.pdf`;
  const up = await admin.storage.from(INVOICE_BUCKET).upload(storagePath, input.bytes, { contentType: "application/pdf", upsert: true });
  if (up.error) return { ok: false, errors: [`원본 저장 실패: ${up.error.message}`] };

  const ins = await admin
    .from("claude_invoices")
    .insert({
      invoice_number: inv.invoiceNumber,
      org_id: orgId,
      bill_to: inv.billTo,
      issued_on: inv.issuedOn,
      period_start: inv.periodStart,
      period_end: inv.periodEnd,
      currency: inv.currency,
      subtotal_cents: inv.subtotalCents,
      tax_cents: inv.taxCents,
      total_cents: inv.totalCents,
      seats: inv.seats,
      plan: inv.plan,
      source: input.source,
      source_url: input.sourceUrl ?? null,
      storage_path: storagePath,
      raw_text: lines.map((l) => l.text).join("\n"),
      uploaded_by: deps.uploadedBy,
    })
    .select(INVOICE_COLUMNS)
    .single();
  if (ins.error) {
    await admin.storage.from(INVOICE_BUCKET).remove([storagePath]).catch(() => undefined);
    return { ok: false, errors: [ins.error.message] };
  }
  const row = ins.data as unknown as InvoiceRow;

  const lineRows = inv.lines.map((l) => ({
    invoice_id: row.id,
    position: l.position,
    description: l.description,
    quantity: l.quantity,
    amount_cents: l.amountCents,
    tax_rate: l.taxRate,
    period_start: l.periodStart,
    period_end: l.periodEnd,
    seats: l.seats,
    plan: l.plan,
  }));
  const li = await admin.from("claude_invoice_lines").insert(lineRows);
  if (li.error) {
    // 라인 없이 헤더만 남기지 않는다(cascade로 라인도 정리)
    await admin.from("claude_invoices").delete().eq("id", row.id);
    await admin.storage.from(INVOICE_BUCKET).remove([storagePath]).catch(() => undefined);
    return { ok: false, errors: [li.error.message] };
  }

  await logAudit(admin, deps.request, {
    userId: deps.uploadedBy,
    action: "claude_cost.invoice_import",
    category: "usage",
    detail: { invoice_number: inv.invoiceNumber, org_id: orgId, bill_to: inv.billTo, issued_on: inv.issuedOn, total_cents: inv.totalCents, source: input.source },
  });
  return { ok: true, invoice: { ...row, lines: lineRows.map((l) => ({ ...l })) } };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-invoice-ingest.test.ts src/lib/__tests__/claude-cost-stripe-invoice.test.ts`
Expected: PASS

- [ ] **Step 6: (로컬 확인) 실물 PDF로 줄 추출·파싱 점검**

이 세션의 스크래치패드에 실물 인보이스가 있다: `/private/tmp/claude-501/-Users-seunguk-kang-orca-workspaces-inje-playground-cost-anlalysis/251498b6-0cb4-47ef-a30c-b29dd7f783b5/scratchpad/invoice-ax.pdf` (없으면 이 단계는 건너뛰고 Task 5 배포 후 실물 링크로 확인). 스크립트는 저장소에 남기지 않는다.

```bash
cd frontend && cat > /tmp/inv-check.mts <<'TS'
import { readFileSync } from "node:fs";
import { extractInvoiceLines, parseStripeInvoice } from "./src/lib/claude-cost/stripe-invoice";
const bytes = new Uint8Array(readFileSync(process.argv[2]));
const lines = await extractInvoiceLines(bytes);
console.log(lines.map((l) => l.text).join("\n"));
const r = parseStripeInvoice(lines);
console.log(JSON.stringify(r.ok ? { ...r.invoice, lines: r.invoice.lines.length } : r, null, 2));
TS
npx tsx --tsconfig tsconfig.json /tmp/inv-check.mts "/private/tmp/claude-501/-Users-seunguk-kang-orca-workspaces-inje-playground-cost-anlalysis/251498b6-0cb4-47ef-a30c-b29dd7f783b5/scratchpad/invoice-ax.pdf"; rm -f /tmp/inv-check.mts
```
Expected: `ok: true`, `billTo: "Innogrid-ax"`, `seats: 97`, `plan: "Team plan - Premium"`, 라인 2개, 합계 검증 통과. `tsx`가 없으면 `npx --yes tsx …`. `@/…` 별칭이 안 풀리면 상대 경로 import로 바꿔 실행한다. 어긋나면 출력된 줄 텍스트를 보고 `ITEM_RE`·`findBillTo`를 고치고 유닛 픽스처도 그 줄 모양으로 맞춘다.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/lib/claude-cost/stripe-invoice.ts frontend/src/lib/claude-cost/invoice-ingest.ts frontend/src/lib/__tests__/claude-cost-invoice-ingest.test.ts
git commit -m "feat(claude-cost): PDF 줄 추출과 인보이스 등록(fetch·Storage·DB·감사)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 인보이스 API 라우트

**Files:**
- Create: `frontend/src/app/api/admin/claude-cost/invoices/route.ts`
- Create: `frontend/src/app/api/admin/claude-cost/invoices/[id]/route.ts`
- Create: `frontend/src/app/api/admin/claude-cost/invoices/[id]/pdf/route.ts`

**Interfaces:**
- Consumes: `ingestInvoice`, `fetchInvoicePdf`, `INVOICE_COLUMNS`, `INVOICE_BUCKET`, `MAX_INVOICE_BYTES` (Task 3); `requireAdmin`, `adminClientOr500`, `isYmd` (`@/lib/claude-usage/require-admin`); `logAudit`
- Produces: `GET /api/admin/claude-cost/invoices?from&to&org` → `{ invoices: InvoiceRow[] }`(lines 포함, issued_on 내림차순); `POST` JSON `{ urls: string[] }` 또는 multipart `files[]` → `{ results: { input: string; ok: boolean; invoice?: InvoiceRow; duplicate?: {...}; errors?: string[] }[] }`; `PATCH …/[id]` `{ org_id: string | null }` → `{ invoice: InvoiceRow }`; `DELETE …/[id]` → `{ success: true }`; `GET …/[id]/pdf` → 302 서명 URL

- [ ] **Step 1: 목록·등록 라우트**

```ts
// frontend/src/app/api/admin/claude-cost/invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { fetchInvoicePdf, ingestInvoice, INVOICE_COLUMNS, MAX_INVOICE_BYTES, type IngestResult } from "@/lib/claude-cost/invoice-ingest";
import type { InvoiceLineRow, InvoiceRow } from "@/types/claude-cost";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_URLS = 20;

/** GET /api/admin/claude-cost/invoices?from&to&org — 발행일 범위(기본 24개월)·조직(id | unassigned) */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const sp = request.nextUrl.searchParams;
  let q = c.admin.from("claude_invoices").select(`${INVOICE_COLUMNS}, lines:claude_invoice_lines(*)`).order("issued_on", { ascending: false }).order("invoice_number");
  if (isYmd(sp.get("from"))) q = q.gte("issued_on", sp.get("from") as string);
  if (isYmd(sp.get("to"))) q = q.lte("issued_on", sp.get("to") as string);
  const org = sp.get("org");
  if (org === "unassigned") q = q.is("org_id", null);
  else if (org && org !== "all") q = q.eq("org_id", org);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const invoices = ((data ?? []) as unknown as (InvoiceRow & { lines: InvoiceLineRow[] })[]).map((i) => ({ ...i, lines: [...(i.lines ?? [])].sort((a, b) => a.position - b.position) }));
  return NextResponse.json({ invoices });
}

async function loadOrgs(admin: SupabaseClient) {
  const { data, error } = await admin.from("claude_orgs").select("id, name").eq("category", "team");
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * POST /api/admin/claude-cost/invoices
 * - JSON { urls: string[] } : Stripe 링크(최대 20) — 서버가 PDF를 받아 파싱
 * - multipart files[]     : PDF 업로드(각 2MB)
 * 건별 결과를 돌려주고, 하나가 실패해도 나머지는 저장한다.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  let orgs: { id: string; name: string }[];
  try {
    orgs = await loadOrgs(admin);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  const deps = { admin, orgs, uploadedBy: auth.userId, request };
  const results: { input: string; ok: boolean; invoice?: InvoiceRow; duplicate?: unknown; errors?: string[] }[] = [];
  const push = (input: string, r: IngestResult) => {
    if (r.ok) results.push({ input, ok: true, invoice: r.invoice });
    else if ("duplicate" in r) results.push({ input, ok: false, duplicate: r.duplicate });
    else results.push({ input, ok: false, errors: r.errors });
  };

  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { urls?: unknown } | null;
    const urls = Array.isArray(body?.urls) ? body!.urls.filter((u): u is string => typeof u === "string").map((u) => u.trim()).filter(Boolean) : [];
    if (urls.length === 0) return NextResponse.json({ error: "urls가 필요합니다." }, { status: 400 });
    if (urls.length > MAX_URLS) return NextResponse.json({ error: `링크는 한 번에 ${MAX_URLS}개까지입니다.` }, { status: 400 });
    for (const url of [...new Set(urls)]) {
      const got = await fetchInvoicePdf(url);
      if (!got.ok) { results.push({ input: url, ok: false, errors: [got.error] }); continue; }
      push(url, await ingestInvoice({ bytes: got.bytes, source: "link", sourceUrl: url }, deps));
    }
  } else {
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "PDF 파일이 필요합니다." }, { status: 400 });
    for (const file of files) {
      if (file.size > MAX_INVOICE_BYTES) { results.push({ input: file.name, ok: false, errors: ["PDF가 2MB를 초과합니다."] }); continue; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      push(file.name, await ingestInvoice({ bytes, source: "pdf" }, deps));
    }
  }
  return NextResponse.json({ results });
}
```

- [ ] **Step 2: 배정·삭제 라우트**

```ts
// frontend/src/app/api/admin/claude-cost/invoices/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { INVOICE_BUCKET, INVOICE_COLUMNS } from "@/lib/claude-cost/invoice-ingest";
import { logAudit } from "@/lib/audit";

/** PATCH { org_id: string | null } — Bill to 자동 매칭이 안 된 인보이스를 조직에 배정(또는 해제) */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { org_id?: unknown } | null;
  if (!body || !("org_id" in body) || (body.org_id !== null && typeof body.org_id !== "string")) {
    return NextResponse.json({ error: "org_id(문자열 또는 null)가 필요합니다." }, { status: 400 });
  }
  if (typeof body.org_id === "string") {
    const org = await c.admin.from("claude_orgs").select("id").eq("id", body.org_id).maybeSingle();
    if (org.error || !org.data) return NextResponse.json({ error: "없는 조직입니다." }, { status: 400 });
  }
  const { data, error } = await c.admin.from("claude_invoices").update({ org_id: body.org_id }).eq("id", id).select(INVOICE_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "PGRST116" ? 404 : 500 });
  await logAudit(c.admin, request, { userId: auth.userId, action: "claude_cost.invoice_assign", category: "usage", detail: { id, org_id: body.org_id } });
  return NextResponse.json({ invoice: data });
}

/** DELETE — 원장(라인 cascade) + Storage 원본 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { id } = await params;
  const row = await c.admin.from("claude_invoices").select("invoice_number, storage_path").eq("id", id).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  if (!row.data) return NextResponse.json({ error: "없는 인보이스입니다." }, { status: 404 });
  const del = await c.admin.from("claude_invoices").delete().eq("id", id);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  await c.admin.storage.from(INVOICE_BUCKET).remove([row.data.storage_path as string]).catch(() => undefined);
  await logAudit(c.admin, request, { userId: auth.userId, action: "claude_cost.invoice_delete", category: "usage", detail: { id, invoice_number: row.data.invoice_number } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: PDF 서명 URL 라우트**

```ts
// frontend/src/app/api/admin/claude-cost/invoices/[id]/pdf/route.ts
import { NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { INVOICE_BUCKET } from "@/lib/claude-cost/invoice-ingest";

/** GET — 원본 PDF 서명 URL(5분)로 302. 관리자 화면의 "PDF" 링크가 새 탭으로 연다 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { id } = await params;
  const row = await c.admin.from("claude_invoices").select("storage_path").eq("id", id).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  if (!row.data) return NextResponse.json({ error: "없는 인보이스입니다." }, { status: 404 });
  const signed = await c.admin.storage.from(INVOICE_BUCKET).createSignedUrl(row.data.storage_path as string, 300);
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: signed.error?.message ?? "서명 URL 생성 실패" }, { status: 500 });
  return NextResponse.redirect(signed.data.signedUrl, 302);
}
```

- [ ] **Step 4: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 오류 0.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/app/api/admin/claude-cost/invoices
git commit -m "feat(claude-cost): 인보이스 목록·등록(링크/PDF)·배정·삭제·PDF 라우트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Admin API cost_report 수집기 · API 비용 라우트 · Cron

**Files:**
- Create: `frontend/src/lib/claude-cost/anthropic-cost-report.ts`
- Create: `frontend/src/app/api/admin/claude-cost/api-cost/route.ts`
- Create: `frontend/src/app/api/admin/claude-cost/api-cost/sync/route.ts`
- Create: `frontend/src/app/api/cron/claude-cost/route.ts`
- Modify: `frontend/vercel.json` (crons 배열)
- Test: `frontend/src/lib/__tests__/claude-cost-cost-report.test.ts`

**Interfaces:**
- Consumes: `addDays` (`@/lib/claude-usage/aggregate`); 타입 `ApiCostRow`
- Produces: `ADMIN_KEY_ENV = "CLAUDE_ADMIN_API_KEY"`, `isApiCostAvailable(): boolean`, `parseCostReport(json): { rows: ApiCostRow[]; hasMore: boolean; nextPage: string|null }`, `chunkDateRange(from, to, maxDays=31): {from,to}[]`, `mergeCostRows(rows): ApiCostRow[]`, `fetchCostReport({ apiKey, from, to, fetchImpl? }): Promise<ApiCostRow[]>`, `upsertApiCost(admin, rows): Promise<{ upserted: number }>`, `syncApiCost(admin, from, to): Promise<{ upserted: number }>`
- 라우트: `GET /api/admin/claude-cost/api-cost?from&to` → `{ available: boolean; rows: ApiCostRow[]; lastSyncedAt: string|null }`; `POST …/api-cost/sync` `{ from, to }` → `{ upserted }`; `GET /api/cron/claude-cost` → `{ skipped: "no_key" } | { from, to, upserted }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-cost-cost-report.test.ts
import { describe, it, expect, vi } from "vitest";
import { chunkDateRange, fetchCostReport, mergeCostRows, parseCostReport } from "@/lib/claude-cost/anthropic-cost-report";

/** 공식 문서 예시 응답을 본뜬 픽스처 */
const bucket = (day: string, results: Record<string, unknown>[]) => ({ starting_at: `${day}T00:00:00Z`, ending_at: `${day}T00:00:00Z`, results });
const item = (over: Record<string, unknown> = {}) => ({
  amount: "123.78912", context_window: "0-200k", cost_type: "tokens", currency: "USD",
  description: "Claude Opus 5 Usage - Input Tokens", inference_geo: "global", model: "claude-opus-5",
  service_tier: "standard", token_type: "uncached_input_tokens", workspace_id: "wrkspc_01", ...over,
});

describe("parseCostReport", () => {
  it("버킷 starting_at의 날짜 + results를 행으로; amount는 소수 센트 문자열 그대로", () => {
    const r = parseCostReport({ data: [bucket("2026-08-01", [item(), item({ workspace_id: null, description: "Code Execution Usage", cost_type: "code_execution", model: null, amount: "50" })])], has_more: true, next_page: "page_x" });
    expect(r.hasMore).toBe(true);
    expect(r.nextPage).toBe("page_x");
    expect(r.rows).toEqual([
      { day: "2026-08-01", workspace_id: "wrkspc_01", description: "Claude Opus 5 Usage - Input Tokens", cost_type: "tokens", model: "claude-opus-5", amount_cents: "123.78912", currency: "USD" },
      { day: "2026-08-01", workspace_id: "", description: "Code Execution Usage", cost_type: "code_execution", model: null, amount_cents: "50", currency: "USD" },
    ]);
  });
  it("빈 버킷은 행이 없고, 형식이 아니면 throw", () => {
    expect(parseCostReport({ data: [bucket("2026-08-02", [])], has_more: false, next_page: null }).rows).toEqual([]);
    expect(() => parseCostReport({ nope: 1 })).toThrow();
  });
});

describe("mergeCostRows", () => {
  it("같은 (day, workspace, description) 행은 금액을 더해 하나로(컨텍스트 창이 달라 description이 같은 경우)", () => {
    const rows = parseCostReport({ data: [bucket("2026-08-01", [item({ amount: "100.5" }), item({ amount: "0.25", context_window: "200k-1M" })])], has_more: false, next_page: null }).rows;
    const merged = mergeCostRows(rows);
    expect(merged).toHaveLength(1);
    expect(Number(merged[0].amount_cents)).toBeCloseTo(100.75, 6);
  });
});

describe("chunkDateRange", () => {
  it("31일 단위로 나눈다(양끝 포함)", () => {
    expect(chunkDateRange("2026-07-01", "2026-07-10")).toEqual([{ from: "2026-07-01", to: "2026-07-10" }]);
    expect(chunkDateRange("2026-07-01", "2026-08-31")).toEqual([
      { from: "2026-07-01", to: "2026-07-31" },
      { from: "2026-08-01", to: "2026-08-31" },
    ]);
  });
});

describe("fetchCostReport", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("헤더·쿼리를 맞춰 부르고 next_page를 따라간다", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ data: [bucket("2026-08-01", [item()])], has_more: true, next_page: "p2" }))
      .mockResolvedValueOnce(json({ data: [bucket("2026-08-02", [item({ amount: "1" })])], has_more: false, next_page: null }));
    const rows = await fetchCostReport({ apiKey: "sk-ant-admin01-test", from: "2026-08-01", to: "2026-08-02", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(rows.map((r) => r.day)).toEqual(["2026-08-01", "2026-08-02"]);
    const [url1, init1] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url1);
    expect(u.origin + u.pathname).toBe("https://api.anthropic.com/v1/organizations/cost_report");
    expect(u.searchParams.get("starting_at")).toBe("2026-08-01T00:00:00Z");
    expect(u.searchParams.get("ending_at")).toBe("2026-08-03T00:00:00Z");
    expect(u.searchParams.getAll("group_by[]")).toEqual(["workspace_id", "description"]);
    expect(u.searchParams.get("bucket_width")).toBe("1d");
    expect(u.searchParams.get("limit")).toBe("31");
    const headers = init1.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-admin01-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const url2 = fetchImpl.mock.calls[1][0] as string;
    expect(new URL(url2).searchParams.get("page")).toBe("p2");
  });

  it("429·5xx는 한 번 재시도하고, 401은 키 값 없이 오류", async () => {
    const retry = vi.fn()
      .mockResolvedValueOnce(json({ error: "rate" }, 429))
      .mockResolvedValueOnce(json({ data: [], has_more: false, next_page: null }));
    await expect(fetchCostReport({ apiKey: "k", from: "2026-08-01", to: "2026-08-01", fetchImpl: retry as unknown as typeof fetch, retryDelayMs: 0 })).resolves.toEqual([]);
    expect(retry).toHaveBeenCalledTimes(2);
    const denied = vi.fn().mockResolvedValue(json({ error: "unauthorized" }, 401));
    await expect(fetchCostReport({ apiKey: "sk-secret", from: "2026-08-01", to: "2026-08-01", fetchImpl: denied as unknown as typeof fetch })).rejects.toThrow(/거부/);
    await expect(fetchCostReport({ apiKey: "sk-secret", from: "2026-08-01", to: "2026-08-01", fetchImpl: denied as unknown as typeof fetch })).rejects.not.toThrow(/sk-secret/);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-cost-report.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: anthropic-cost-report.ts 구현**

```ts
// frontend/src/lib/claude-cost/anthropic-cost-report.ts
/**
 * Anthropic Admin API — GET /v1/organizations/cost_report (Claude Console 조직의 API 사용분 실제 비용).
 * claude.ai Team 좌석 구독료는 여기 없다(인보이스로만). 키(`sk-ant-admin01-…`)는 env CLAUDE_ADMIN_API_KEY.
 * amount는 센트 단위 소수 문자열("123.78912")이라 문자열로 보존해 numeric 컬럼에 넣는다.
 * 문서: 1d 버킷, 호출당 최대 31버킷, has_more/next_page 페이지네이션, 값은 30일간 사후 보정될 수 있다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/claude-usage/aggregate";
import type { ApiCostRow } from "@/types/claude-cost";

export const ADMIN_KEY_ENV = "CLAUDE_ADMIN_API_KEY";
const ENDPOINT = "https://api.anthropic.com/v1/organizations/cost_report";
const USER_AGENT = "inje-playground/1.0 (https://inje-playground.vercel.app)";

export function isApiCostAvailable(): boolean {
  return !!process.env[ADMIN_KEY_ENV];
}

export function parseCostReport(json: unknown): { rows: ApiCostRow[]; hasMore: boolean; nextPage: string | null } {
  const j = json as { data?: unknown; has_more?: unknown; next_page?: unknown } | null;
  if (!j || !Array.isArray(j.data)) throw new Error("cost_report 응답 형식이 아닙니다.");
  const rows: ApiCostRow[] = [];
  for (const b of j.data as { starting_at?: unknown; results?: unknown }[]) {
    const day = typeof b.starting_at === "string" ? b.starting_at.slice(0, 10) : null;
    if (!day || !Array.isArray(b.results)) continue;
    for (const r of b.results as Record<string, unknown>[]) {
      const amount = typeof r.amount === "string" ? r.amount : typeof r.amount === "number" ? String(r.amount) : null;
      if (amount === null || !/^-?\d+(\.\d+)?$/.test(amount)) continue;
      rows.push({
        day,
        workspace_id: typeof r.workspace_id === "string" ? r.workspace_id : "",
        description: typeof r.description === "string" ? r.description : "(전체)",
        cost_type: typeof r.cost_type === "string" ? r.cost_type : null,
        model: typeof r.model === "string" ? r.model : null,
        amount_cents: amount,
        currency: typeof r.currency === "string" ? r.currency : "USD",
      });
    }
  }
  return { rows, hasMore: j.has_more === true, nextPage: typeof j.next_page === "string" ? j.next_page : null };
}

/** pk(day, workspace_id, description)가 같은 행(컨텍스트 창·토큰 종류가 달라도 description이 같을 수 있다)은 금액을 더한다 */
export function mergeCostRows(rows: ApiCostRow[]): ApiCostRow[] {
  const byKey = new Map<string, ApiCostRow & { sum: number }>();
  for (const r of rows) {
    const k = `${r.day}|${r.workspace_id}|${r.description}`;
    const cur = byKey.get(k);
    if (cur) cur.sum += Number(r.amount_cents);
    else byKey.set(k, { ...r, sum: Number(r.amount_cents) });
  }
  return [...byKey.values()].map(({ sum, ...r }) => ({ ...r, amount_cents: sum.toFixed(6) }));
}

export function chunkDateRange(from: string, to: string, maxDays = 31): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let start = from; start <= to; start = addDays(start, maxDays)) {
    const end = addDays(start, maxDays - 1);
    out.push({ from: start, to: end < to ? end : to });
  }
  return out;
}

async function requestPage(url: URL, apiKey: string, fetchImpl: typeof fetch, retryDelayMs: number): Promise<unknown> {
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "User-Agent": USER_AGENT, Accept: "application/json" };
  let res = await fetchImpl(url.toString(), { headers });
  if (res.status === 429 || res.status >= 500) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    res = await fetchImpl(url.toString(), { headers });
  }
  if (res.status === 401 || res.status === 403) throw new Error(`관리자 키가 거부되었습니다(HTTP ${res.status}). Console > Admin keys에서 키를 확인하세요.`);
  if (!res.ok) throw new Error(`cost_report HTTP ${res.status}`);
  return res.json();
}

/** from~to(양끝 포함, UTC 날짜)의 일별 비용. 31일 청크 × 페이지네이션 */
export async function fetchCostReport(opts: { apiKey: string; from: string; to: string; fetchImpl?: typeof fetch; retryDelayMs?: number }): Promise<ApiCostRow[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out: ApiCostRow[] = [];
  for (const chunk of chunkDateRange(opts.from, opts.to)) {
    let page: string | null = null;
    do {
      const url = new URL(ENDPOINT);
      url.searchParams.set("starting_at", `${chunk.from}T00:00:00Z`);
      url.searchParams.set("ending_at", `${addDays(chunk.to, 1)}T00:00:00Z`);
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.append("group_by[]", "workspace_id");
      url.searchParams.append("group_by[]", "description");
      url.searchParams.set("limit", "31");
      if (page) url.searchParams.set("page", page);
      const parsed = parseCostReport(await requestPage(url, opts.apiKey, fetchImpl, opts.retryDelayMs ?? 1000));
      out.push(...parsed.rows);
      page = parsed.hasMore ? parsed.nextPage : null;
    } while (page);
  }
  return mergeCostRows(out);
}

export async function upsertApiCost(admin: SupabaseClient, rows: ApiCostRow[]): Promise<{ upserted: number }> {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("claude_api_cost_daily").upsert(rows.slice(i, i + 500).map((r) => ({ ...r, synced_at: now })), { onConflict: "day,workspace_id,description" });
    if (error) throw new Error(`claude_api_cost_daily: ${error.message}`);
  }
  return { upserted: rows.length };
}

/** env 키로 수집해 저장. 키가 없으면 throw — 라우트가 먼저 isApiCostAvailable()로 걸러야 한다 */
export async function syncApiCost(admin: SupabaseClient, from: string, to: string): Promise<{ upserted: number }> {
  const apiKey = process.env[ADMIN_KEY_ENV];
  if (!apiKey) throw new Error("CLAUDE_ADMIN_API_KEY가 설정되지 않았습니다.");
  const rows = await fetchCostReport({ apiKey, from, to });
  return upsertApiCost(admin, rows);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-cost-report.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: API 비용 조회·수집 라우트**

```ts
// frontend/src/app/api/admin/claude-cost/api-cost/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { isApiCostAvailable } from "@/lib/claude-cost/anthropic-cost-report";
import { selectAll } from "@/lib/work-metrics/common";
import type { ApiCostRow } from "@/types/claude-cost";

/** GET ?from&to — Admin API 일별 비용(기본 30일). 키가 없으면 available:false만(화면은 탭을 그리지 않는다) */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isApiCostAvailable()) return NextResponse.json({ available: false, rows: [], lastSyncedAt: null });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  if (from > to) return NextResponse.json({ error: "from이 to보다 늦습니다." }, { status: 400 });
  const rows = await selectAll<ApiCostRow & { synced_at: string }>(() => c.admin.from("claude_api_cost_daily").select("day, workspace_id, description, cost_type, model, amount_cents, currency, synced_at", { count: "exact" }).gte("day", from).lte("day", to).order("day").order("workspace_id").order("description"));
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });
  const last = await c.admin.from("claude_api_cost_daily").select("synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({
    available: true,
    rows: rows.data.map(({ synced_at: _s, ...r }) => ({ ...r, amount_cents: String(r.amount_cents) })),
    lastSyncedAt: (last.data?.synced_at as string | undefined) ?? null,
  });
}
```

```ts
// frontend/src/app/api/admin/claude-cost/api-cost/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { isApiCostAvailable, syncApiCost } from "@/lib/claude-cost/anthropic-cost-report";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_DAYS = 93;

/** POST { from, to } — 지금 수집(최대 93일). 키가 없으면 404 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isApiCostAvailable()) return NextResponse.json({ error: "Admin API 키가 설정되지 않았습니다." }, { status: 404 });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const body = (await request.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
  const from = typeof body?.from === "string" ? body.from : null;
  const to = typeof body?.to === "string" ? body.to : null;
  if (!isYmd(from) || !isYmd(to) || from > to) return NextResponse.json({ error: "from·to(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) return NextResponse.json({ error: `기간은 최대 ${MAX_DAYS}일입니다.` }, { status: 400 });
  try {
    const r = await syncApiCost(c.admin, from, to);
    await logAudit(c.admin, request, { userId: auth.userId, action: "claude_cost.api_sync", category: "usage", detail: { from, to, upserted: r.upserted } });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
```

- [ ] **Step 6: Cron 라우트 + vercel.json**

```ts
// frontend/src/app/api/cron/claude-cost/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { addDays } from "@/lib/claude-usage/aggregate";
import { isApiCostAvailable, syncApiCost } from "@/lib/claude-cost/anthropic-cost-report";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/cron/claude-cost — Admin API cost_report 최근 3일 재수집(값이 사후 보정되므로 하루치만 받지 않는다).
 * 인증: Vercel Cron(Authorization: Bearer CRON_SECRET) 또는 관리자 세션. 키가 없으면 건너뛴다.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || bearer !== secret) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  if (!isApiCostAvailable()) return NextResponse.json({ skipped: "no_key" });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const to = new Date().toISOString().slice(0, 10);
  const from = addDays(to, -3);
  try {
    const r = await syncApiCost(c.admin, from, to);
    return NextResponse.json({ from, to, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
```

`frontend/vercel.json`의 `crons`에 추가(08:00 KST = 23:00 UTC):

```json
    { "path": "/api/cron/claude-cost", "schedule": "0 23 * * *" }
```

- [ ] **Step 7: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 오류 0

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/claude-cost/anthropic-cost-report.ts frontend/src/lib/__tests__/claude-cost-cost-report.test.ts frontend/src/app/api/admin/claude-cost/api-cost frontend/src/app/api/cron/claude-cost frontend/vercel.json
git commit -m "feat(claude-cost): Admin API cost_report 수집기·API 비용 라우트·일일 Cron

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 월별 집계(순수) · monthly 라우트

**Files:**
- Modify: `frontend/src/lib/claude-usage/aggregate.ts:60` (`function isActive` → `export function isActive`)
- Create: `frontend/src/lib/claude-cost/monthly.ts`
- Create: `frontend/src/app/api/admin/claude-cost/monthly/route.ts`
- Test: `frontend/src/lib/__tests__/claude-cost-monthly.test.ts`

**Interfaces:**
- Consumes: `monthOf`, `monthRange`, `lastMonths` (Task 1); `isActive`, `addDays` (aggregate); `applyIdentityMap`, `loadIdentityMap` (`@/lib/claude-usage/identity-map`); `selectAll` (`@/lib/work-metrics/common`); `isApiCostAvailable`; 타입 `ClaudeOrg`, `DailyRow`, `InvoiceRow`, `ApiCostRow`, `MonthlyCost`, `MonthlyOrgCost`
- Produces: `interface MonthlyInput { months: string[]; orgs: Pick<ClaudeOrg,"id"|"name"|"sort_order">[]; invoices: InvoiceRow[]; apiCost: ApiCostRow[] | null; daily: DailyRow[]; csv: { org_id: string; period_end: string; active: number }[] }`, `summarizeMonthly(input): MonthlyCost[]`; `GET /api/admin/claude-cost/monthly?months=12&org=` → `{ months: MonthlyCost[]; apiCostAvailable: boolean; orgs: ClaudeOrg[] }`

- [ ] **Step 1: aggregate.ts의 isActive를 export**

`frontend/src/lib/claude-usage/aggregate.ts` 60행 `function isActive(r: DailyRow): boolean {` → `export function isActive(r: DailyRow): boolean {`. 다른 변경 없음.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/claude-cost-monthly.test.ts
import { describe, it, expect } from "vitest";
import { summarizeMonthly, type MonthlyInput } from "@/lib/claude-cost/monthly";
import { emptyDailyMetrics, type DailyRow } from "@/types/claude-usage";
import type { InvoiceRow } from "@/types/claude-cost";

const orgs = [{ id: "ax", name: "Innogrid-ax", sort_order: 0 }, { id: "bx", name: "Innogrid-bx", sort_order: 1 }];
const inv = (over: Partial<InvoiceRow> & Pick<InvoiceRow, "id" | "invoice_number" | "org_id" | "issued_on" | "total_cents">): InvoiceRow => ({
  bill_to: over.org_id ?? "?", period_start: null, period_end: null, currency: "USD", subtotal_cents: Math.round(over.total_cents / 1.1), tax_cents: over.total_cents - Math.round(over.total_cents / 1.1),
  seats: null, plan: null, source: "link", source_url: null, created_at: "2026-08-23T00:00:00Z", ...over,
});
const daily = (day: string, org_id: string, user_email: string, over: Partial<DailyRow> = {}): DailyRow => ({ ...emptyDailyMetrics(), day, org_id, user_email, account_uuid: null, sessions: 1, prompts: 3, prompts_auto: 1, cost_usd: 2.5, ...over });
const base: MonthlyInput = { months: ["2026-07", "2026-08"], orgs, invoices: [], apiCost: null, daily: [], csv: [] };

describe("summarizeMonthly", () => {
  it("월별 청구 합·좌석·누락 조직·미배정 금액", () => {
    const r = summarizeMonthly({
      ...base,
      invoices: [
        inv({ id: "1", invoice_number: "A-1", org_id: "ax", issued_on: "2026-08-23", total_cents: 660000, subtotal_cents: 600000, tax_cents: 60000, seats: 97, plan: "Team plan - Premium" }),
        inv({ id: "2", invoice_number: "A-2", org_id: "ax", issued_on: "2026-08-30", total_cents: 110000, subtotal_cents: 100000, tax_cents: 10000, seats: 100, plan: "Team plan - Premium" }),
        inv({ id: "3", invoice_number: "U-1", org_id: null, issued_on: "2026-08-25", total_cents: 11000, subtotal_cents: 10000, tax_cents: 1000 }),
        inv({ id: "4", invoice_number: "B-7", org_id: "bx", issued_on: "2026-07-23", total_cents: 220000, subtotal_cents: 200000, tax_cents: 20000, seats: 10 }),
      ],
    });
    const aug = r.find((m) => m.month === "2026-08")!;
    expect(aug.invoices).toBe(3);
    expect(aug.billed).toEqual({ subtotalCents: 710000, taxCents: 71000, totalCents: 781000 });
    expect(aug.seats).toBe(100); // 같은 달 2장 → 가장 늦게 발행된 것의 좌석
    expect(aug.missingOrgs).toEqual(["Innogrid-bx"]);
    expect(aug.unassignedCents).toBe(11000);
    const ax = aug.perOrg.find((o) => o.orgId === "ax")!;
    expect(ax.totalCents).toBe(770000);
    expect(ax.seats).toBe(100);
    expect(ax.invoices.map((i) => i.invoice_number)).toEqual(["A-1", "A-2"]);
    expect(aug.perOrg.find((o) => o.orgId === null)?.totalCents).toBe(11000);
    const jul = r.find((m) => m.month === "2026-07")!;
    expect(jul.seats).toBe(10);
    expect(jul.missingOrgs).toEqual(["Innogrid-ax"]);
    expect(jul.unassignedCents).toBe(0);
  });

  it("인보이스가 없는 달은 seats null·합 0, 모든 조직 누락", () => {
    const r = summarizeMonthly(base);
    expect(r[0]).toMatchObject({ month: "2026-07", invoices: 0, seats: null, billed: { totalCents: 0 }, missingOrgs: ["Innogrid-ax", "Innogrid-bx"], apiCostCents: null, csvActiveMembers: null });
  });

  it("좌석이 없는 인보이스(seats null)는 좌석 계산에서 건너뛰고 직전 좌석을 쓴다", () => {
    const r = summarizeMonthly({ ...base, invoices: [
      inv({ id: "1", invoice_number: "A-1", org_id: "ax", issued_on: "2026-08-01", total_cents: 110, seats: 50 }),
      inv({ id: "2", invoice_number: "A-2", org_id: "ax", issued_on: "2026-08-20", total_cents: 110, seats: null }),
    ] });
    expect(r[1].seats).toBe(50);
  });

  it("OTel 사용량: 활성 사용자 distinct, 사람 프롬프트 = prompts − prompts_auto, 조직별로도", () => {
    const r = summarizeMonthly({ ...base, daily: [
      daily("2026-08-01", "ax", "a@x.com"), daily("2026-08-02", "ax", "a@x.com"), daily("2026-08-02", "ax", "b@x.com"),
      daily("2026-08-03", "bx", "c@x.com", { sessions: 0, prompts: 0, cost_usd: 0 }), // 비활성 행
      daily("2026-07-31", "ax", "z@x.com"),
    ] });
    const aug = r[1];
    expect(aug.usage).toEqual({ activeUsers: 2, sessions: 3, promptsHuman: 6, estCostUsd: 7.5 });
    expect(aug.perOrg.find((o) => o.orgId === "ax")).toMatchObject({ activeUsers: 2, estCostUsd: 7.5 });
    expect(aug.perOrg.find((o) => o.orgId === "bx")).toMatchObject({ activeUsers: 0, estCostUsd: 0 });
    expect(r[0].usage.activeUsers).toBe(1);
  });

  it("API 비용은 월합(소수 센트), CSV 활성 멤버는 그 달 조직별 최신 period_end만", () => {
    const r = summarizeMonthly({
      ...base,
      apiCost: [
        { day: "2026-08-01", workspace_id: "", description: "d", cost_type: null, model: null, amount_cents: "100.5", currency: "USD" },
        { day: "2026-08-31", workspace_id: "w", description: "d", cost_type: null, model: null, amount_cents: "0.25", currency: "USD" },
        { day: "2026-07-01", workspace_id: "", description: "d", cost_type: null, model: null, amount_cents: "7", currency: "USD" },
      ],
      csv: [
        { org_id: "ax", period_end: "2026-08-13", active: 40 },
        { org_id: "ax", period_end: "2026-08-27", active: 45 },
        { org_id: "bx", period_end: "2026-08-27", active: 5 },
        { org_id: "bx", period_end: "2026-07-27", active: 4 },
      ],
    });
    expect(r[1].apiCostCents).toBeCloseTo(100.75, 6);
    expect(r[0].apiCostCents).toBe(7);
    expect(r[1].csvActiveMembers).toBe(50);
    expect(r[0].csvActiveMembers).toBe(4);
  });

  it("조직 순서는 sort_order, 미배정은 마지막·인보이스 있을 때만", () => {
    const r = summarizeMonthly({ ...base, orgs: [orgs[1], orgs[0]], invoices: [inv({ id: "3", invoice_number: "U-1", org_id: null, issued_on: "2026-08-25", total_cents: 11000 })] });
    expect(r[1].perOrg.map((o) => o.orgId)).toEqual(["ax", "bx", null]);
    expect(r[0].perOrg.map((o) => o.orgId)).toEqual(["ax", "bx"]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-monthly.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: monthly.ts 구현**

```ts
// frontend/src/lib/claude-cost/monthly.ts
/**
 * 월별 비용 집계 — 순수 함수. 월 = 인보이스 발행일의 달력 월(재무팀이 보는 카드 청구와 같은 기준).
 * 청구 합계는 인보이스만. Admin API 비용은 대조용 별도 값이라 합계에 더하지 않는다.
 * 사용량은 OTel(claude_code_daily, KST day)을 같은 달로 묶고, CSV 활성 멤버는 그 달에 끝나는 CSV 중 조직별 최신 것만 쓴다.
 */
import { isActive } from "@/lib/claude-usage/aggregate";
import { monthOf } from "./money";
import type { ClaudeOrg, DailyRow } from "@/types/claude-usage";
import type { ApiCostRow, InvoiceRow, MonthlyCost, MonthlyOrgCost } from "@/types/claude-cost";

export interface MonthlyInput {
  months: string[];
  orgs: Pick<ClaudeOrg, "id" | "name" | "sort_order">[];
  invoices: InvoiceRow[];
  /** null = Admin API 키 없음(열 자체를 그리지 않는다) */
  apiCost: ApiCostRow[] | null;
  daily: DailyRow[];
  csv: { org_id: string; period_end: string; active: number }[];
}

const UNASSIGNED_NAME = "미배정";

function orgCost(orgId: string | null, name: string, invoices: InvoiceRow[], daily: DailyRow[]): MonthlyOrgCost {
  const sorted = [...invoices].sort((a, b) => a.issued_on.localeCompare(b.issued_on) || a.invoice_number.localeCompare(b.invoice_number));
  // 좌석은 seats가 파싱된 인보이스 중 가장 늦게 발행된 것 — Console 인보이스처럼 좌석이 없는 장은 건너뛴다
  const withSeats = sorted.filter((i) => i.seats !== null);
  const latest = withSeats[withSeats.length - 1];
  const emails = new Set<string>();
  let estCostUsd = 0;
  for (const r of daily) {
    if (r.org_id !== orgId) continue;
    if (isActive(r)) emails.add(r.user_email);
    estCostUsd += Number(r.cost_usd) || 0;
  }
  return {
    orgId,
    name,
    invoices: sorted,
    totalCents: sorted.reduce((a, i) => a + i.total_cents, 0),
    seats: latest?.seats ?? null,
    plan: latest?.plan ?? null,
    activeUsers: emails.size,
    estCostUsd,
  };
}

export function summarizeMonthly(input: MonthlyInput): MonthlyCost[] {
  const orgs = [...input.orgs].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko"));
  return input.months.map((month) => {
    const invoices = input.invoices.filter((i) => monthOf(i.issued_on) === month);
    const daily = input.daily.filter((r) => monthOf(r.day) === month);

    const perOrg: MonthlyOrgCost[] = orgs.map((o) => orgCost(o.id, o.name, invoices.filter((i) => i.org_id === o.id), daily));
    const unassigned = invoices.filter((i) => i.org_id === null);
    if (unassigned.length) perOrg.push(orgCost(null, UNASSIGNED_NAME, unassigned, []));

    const seatOrgs = perOrg.filter((o) => o.seats !== null);
    const emails = new Set<string>();
    const usage = { activeUsers: 0, sessions: 0, promptsHuman: 0, estCostUsd: 0 };
    for (const r of daily) {
      if (isActive(r)) emails.add(r.user_email);
      usage.sessions += Number(r.sessions) || 0;
      usage.promptsHuman += Math.max(0, (Number(r.prompts) || 0) - (Number(r.prompts_auto) || 0));
      usage.estCostUsd += Number(r.cost_usd) || 0;
    }
    usage.activeUsers = emails.size;

    let apiCostCents: number | null = null;
    if (input.apiCost) apiCostCents = input.apiCost.filter((r) => monthOf(r.day) === month).reduce((a, r) => a + (Number(r.amount_cents) || 0), 0);

    // CSV는 30일 롤링이라 조직별로 그 달에 끝나는 것 중 최신 한 장만
    const latestCsv = new Map<string, { period_end: string; active: number }>();
    for (const c of input.csv) {
      if (monthOf(c.period_end) !== month) continue;
      const cur = latestCsv.get(c.org_id);
      if (!cur || c.period_end > cur.period_end) latestCsv.set(c.org_id, c);
    }
    const csvActiveMembers = latestCsv.size ? [...latestCsv.values()].reduce((a, c) => a + c.active, 0) : null;

    return {
      month,
      invoices: invoices.length,
      billed: {
        subtotalCents: invoices.reduce((a, i) => a + i.subtotal_cents, 0),
        taxCents: invoices.reduce((a, i) => a + i.tax_cents, 0),
        totalCents: invoices.reduce((a, i) => a + i.total_cents, 0),
      },
      seats: seatOrgs.length ? seatOrgs.reduce((a, o) => a + (o.seats ?? 0), 0) : null,
      missingOrgs: orgs.filter((o) => !invoices.some((i) => i.org_id === o.id)).map((o) => o.name),
      unassignedCents: unassigned.reduce((a, i) => a + i.total_cents, 0),
      apiCostCents,
      usage,
      csvActiveMembers,
      perOrg,
    };
  });
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/claude-cost-monthly.test.ts src/lib/__tests__/claude-usage-aggregate.test.ts`
Expected: PASS(기존 aggregate 테스트도 그대로)

- [ ] **Step 6: monthly 라우트**

```ts
// frontend/src/app/api/admin/claude-cost/monthly/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { applyIdentityMap, loadIdentityMap } from "@/lib/claude-usage/identity-map";
import { orgCategory } from "@/lib/claude-usage/org-options";
import { selectAll } from "@/lib/work-metrics/common";
import { lastMonths, monthRange } from "@/lib/claude-cost/money";
import { summarizeMonthly } from "@/lib/claude-cost/monthly";
import { isApiCostAvailable } from "@/lib/claude-cost/anthropic-cost-report";
import { INVOICE_COLUMNS } from "@/lib/claude-cost/invoice-ingest";
import type { ClaudeOrg, DailyRow } from "@/types/claude-usage";
import type { ApiCostRow, InvoiceRow } from "@/types/claude-cost";

/**
 * GET /api/admin/claude-cost/monthly?months=12&org=all|<id>
 * 조직은 Team 조직만(개인 조직은 인보이스가 없다). org=<id>면 그 조직 하나.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const sp = request.nextUrl.searchParams;
  const n = Math.min(36, Math.max(1, Number(sp.get("months") ?? 12) || 12));
  const months = lastMonths(n);
  const from = `${months[0]}-01`;
  const to = monthRange(months[months.length - 1]).to;
  const orgParam = sp.get("org") || "all";

  try {
    const orgsRes = await admin.from("claude_orgs").select("id, name, seats_total, sort_order, category").order("sort_order").order("name");
    if (orgsRes.error) throw new Error(orgsRes.error.message);
    const allOrgs = (orgsRes.data ?? []) as ClaudeOrg[];
    const teamOrgs = allOrgs.filter((o) => orgCategory(o) === "team");
    const orgs = orgParam === "all" ? teamOrgs : teamOrgs.filter((o) => o.id === orgParam);
    const orgIds = orgs.map((o) => o.id);
    const apiAvailable = isApiCostAvailable();

    const invQ = admin.from("claude_invoices").select(INVOICE_COLUMNS).gte("issued_on", from).lte("issued_on", to).order("issued_on");
    const [invoices, identities, apiCost, dailyRes, importsRes] = await Promise.all([
      orgParam === "all" ? invQ : invQ.eq("org_id", orgParam),
      loadIdentityMap(admin),
      apiAvailable && orgParam === "all"
        ? selectAll<ApiCostRow>(() => admin.from("claude_api_cost_daily").select("day, workspace_id, description, cost_type, model, amount_cents, currency", { count: "exact" }).gte("day", from).lte("day", to).order("day").order("workspace_id").order("description"))
        : Promise.resolve({ data: null as ApiCostRow[] | null, error: null }),
      selectAll<DailyRow>(() => admin.from("claude_code_daily").select("*", { count: "exact" }).in("org_id", orgIds.length ? orgIds : ["__none__"]).gte("day", from).lte("day", to).order("day").order("user_email")),
      admin.from("claude_csv_imports").select("id, org_id, period_end").in("org_id", orgIds.length ? orgIds : ["__none__"]).gte("period_end", from).lte("period_end", to),
    ]);
    if (invoices.error) throw new Error(invoices.error.message);
    if (apiCost.error) throw new Error(apiCost.error.message);
    if (dailyRes.error) throw new Error(dailyRes.error.message);
    if (importsRes.error) throw new Error(importsRes.error.message);

    // CSV 활성 멤버: 그 회차에 채팅·Code·Cowork 중 하나라도 있는 멤버 수
    const imports = (importsRes.data ?? []) as { id: string; org_id: string; period_end: string }[];
    const csv: { org_id: string; period_end: string; active: number }[] = [];
    if (imports.length) {
      const members = await selectAll<{ import_id: string; chats: number; code_sessions: number; cowork_sessions: number }>(() =>
        admin.from("claude_member_activity").select("import_id, chats, code_sessions, cowork_sessions", { count: "exact" }).in("import_id", imports.map((i) => i.id)).order("import_id").order("email"));
      if (members.error) throw new Error(members.error.message);
      const active = new Map<string, number>();
      for (const m of members.data) if (Number(m.chats) + Number(m.code_sessions) + Number(m.cowork_sessions) > 0) active.set(m.import_id, (active.get(m.import_id) ?? 0) + 1);
      for (const i of imports) csv.push({ org_id: i.org_id, period_end: i.period_end, active: active.get(i.id) ?? 0 });
    }

    const daily = applyIdentityMap(dailyRes.data.map((r) => ({ ...r, sessions: Number(r.sessions), prompts: Number(r.prompts), prompts_auto: Number(r.prompts_auto), cost_usd: Number(r.cost_usd) })), identities);
    const result = summarizeMonthly({
      months,
      orgs,
      invoices: (invoices.data ?? []) as unknown as InvoiceRow[],
      apiCost: apiAvailable ? (apiCost.data ?? []).map((r) => ({ ...r, amount_cents: String(r.amount_cents) })) : null,
      daily,
      csv,
    });
    return NextResponse.json({ months: result, apiCostAvailable: apiAvailable, orgs: teamOrgs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 7: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 오류 0. `selectAll`의 `make()` 빌더에 `{ count: "exact" }`를 넣어야 페이지 종료 판정이 정확하다(기존 perf 라우트와 같음).

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/claude-usage/aggregate.ts frontend/src/lib/claude-cost/monthly.ts frontend/src/lib/__tests__/claude-cost-monthly.test.ts frontend/src/app/api/admin/claude-cost/monthly
git commit -m "feat(claude-cost): 월별 청구·사용량 집계와 monthly 라우트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 페이지 골격 · 관리자 메뉴 · 월별 개요 탭

**Files:**
- Create: `frontend/src/lib/claude-cost/hints.ts`
- Create: `frontend/src/components/admin/claude-cost/MonthlyBars.tsx`
- Create: `frontend/src/components/admin/claude-cost/MonthOrgDetail.tsx`
- Create: `frontend/src/components/admin/claude-cost/CostOverviewTab.tsx`
- Create: `frontend/src/app/admin/claude-cost/page.tsx`
- Modify: `frontend/src/app/admin/layout.tsx:10-23` (`ADMIN_NAV`)

**Interfaces:**
- Consumes: `GET /api/admin/claude-cost/monthly` (Task 6) 응답 `{ months: MonthlyCost[]; apiCostAvailable; orgs: ClaudeOrg[] }`; `formatCents` (Task 1); `SortableTable`·`Column`·`sumBy`, `OrgSelect`, `format.ts`의 `usd`·`int` (`@/components/admin/claude-usage/`); `downloadCsv` (`@/lib/claude-usage/csv-download`)
- Produces: `MonthlyBars({ data: MonthlyCost[], showApi: boolean })`, `MonthOrgDetail({ month: MonthlyCost })`, `CostOverviewTab({ onMeta }: { onMeta: (m: { apiCostAvailable: boolean; orgs: ClaudeOrg[] }) => void })`; 페이지 탭 값 `overview | invoices | api`

- [ ] **Step 1: 툴팁 문구**

```ts
// frontend/src/lib/claude-cost/hints.ts
/** 비용 관리 화면 지표 설명(헤더 툴팁). 숫자가 왜 그렇게 보이는지 한 곳에 모아 둔다 */
export const BILLED_HINT = "등록한 Anthropic(Stripe) 인보이스의 총액(VAT 포함) 합입니다. 월은 인보이스 발행일 기준이라 서비스 기간(예: 8/23~9/23)과 다를 수 있습니다.";
export const SEATS_HINT = "그 달에 발행된 인보이스 중 좌석이 적힌 마지막 장의 좌석 수(조직 합). 좌석 변경이 있으면 프로레이션 라인 중 양수(+) 라인의 수량입니다.";
export const API_COST_HINT = "Anthropic Admin API cost_report로 받은 Claude Console API 사용분(RFP 매핑·마케팅 AI 등)입니다. 대조용이며 청구 합계에는 더하지 않습니다. 값은 30일 동안 사후 보정될 수 있습니다.";
export const EST_COST_HINT = "Claude Code OTel이 보고한 API 환산 추정 비용(cost_usd)의 월합입니다. 좌석제라 실제 청구와 무관한 참고값입니다.";
export const ACTIVE_USERS_HINT = "그 달에 Claude Code 세션·프롬프트·비용이 한 번이라도 기록된 사용자 수(OTel, Team 조직). 채팅만 쓴 사용자는 포함되지 않습니다.";
export const CSV_ACTIVE_HINT = "그 달에 끝나는 멤버 활동 CSV(30일 롤링, 조직별 최신 회차)에서 채팅·Claude Code·Cowork 중 하나라도 있는 멤버 수입니다. CSV가 없는 달은 비어 있습니다.";
export const PER_SEAT_HINT = "청구 총액 ÷ 좌석 수. 좌석이 없는 달은 비어 있습니다.";
export const PER_USER_HINT = "청구 총액 ÷ Claude Code 활성 사용자. 활성 사용자가 0이면 비어 있습니다.";
```

- [ ] **Step 2: 월별 막대**

```tsx
// frontend/src/components/admin/claude-cost/MonthlyBars.tsx
"use client";

import { formatCents } from "@/lib/claude-cost/money";
import type { MonthlyCost } from "@/types/claude-cost";

/**
 * 월별 막대 — 세전·VAT를 한 막대에 쌓고, API 비용은 옆에 가는 막대로 따로 그린다(합계에 더하지 않는다는 규칙을 그림으로도 지킨다).
 */
export default function MonthlyBars({ data, showApi }: { data: MonthlyCost[]; showApi: boolean }) {
  const max = Math.max(1, ...data.map((m) => Math.max(m.billed.totalCents, m.apiCostCents ?? 0)));
  const w = 720;
  const h = 150;
  const pad = 8;
  const slot = data.length ? (w - pad * 2) / data.length : 0;
  const barW = showApi ? slot * 0.5 : slot * 0.7;
  const apiW = slot * 0.18;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>월별 청구(세전 + VAT){showApi ? " · API 비용(별도)" : ""}</span>
        <span>최대 {formatCents(max)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h + 18}`} className="w-full h-44" role="img" aria-label="월별 청구 금액">
        {data.map((m, i) => {
          const x = pad + i * slot + (slot - barW - (showApi ? apiW + 2 : 0)) / 2;
          const subH = (m.billed.subtotalCents / max) * h;
          const taxH = (m.billed.taxCents / max) * h;
          const apiH = ((m.apiCostCents ?? 0) / max) * h;
          return (
            <g key={m.month}>
              <rect x={x} y={h - subH} width={barW} height={subH} className="fill-primary/80">
                <title>{`${m.month} 세전 ${formatCents(m.billed.subtotalCents)}`}</title>
              </rect>
              <rect x={x} y={h - subH - taxH} width={barW} height={taxH} className="fill-primary/40">
                <title>{`${m.month} VAT ${formatCents(m.billed.taxCents)}`}</title>
              </rect>
              {showApi && (
                <rect x={x + barW + 2} y={h - apiH} width={apiW} height={apiH} className="fill-amber-500/70">
                  <title>{`${m.month} API 비용 ${formatCents(m.apiCostCents ?? 0)}`}</title>
                </rect>
              )}
              <text x={pad + i * slot + slot / 2} y={h + 13} textAnchor="middle" className="fill-muted-foreground" fontSize="9">{m.month.slice(2)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: 월 상세(조직별)**

```tsx
// frontend/src/components/admin/claude-cost/MonthOrgDetail.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { usd, int } from "@/components/admin/claude-usage/format";
import { formatCents } from "@/lib/claude-cost/money";
import { SEATS_HINT, ACTIVE_USERS_HINT, EST_COST_HINT } from "@/lib/claude-cost/hints";
import type { MonthlyCost, MonthlyOrgCost } from "@/types/claude-cost";

/** 한 달의 조직별 청구·인보이스·사용량. 인보이스는 장별로 번호·발행일·기간·PDF 링크 */
export default function MonthOrgDetail({ month }: { month: MonthlyCost }) {
  const columns: Column<MonthlyOrgCost>[] = [
    { key: "name", header: "조직", value: (o) => o.name, render: (o) => (o.orgId === null ? <Badge variant="destructive">{o.name}</Badge> : o.name) },
    { key: "invoices", header: "인보이스", value: (o) => o.invoices.length, align: "right",
      render: (o) => (o.invoices.length === 0 ? <span className="text-destructive">없음</span> : (
        <div className="space-y-0.5 text-xs text-left">
          {o.invoices.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-x-2">
              <span className="font-mono">{i.invoice_number}</span>
              <span className="text-muted-foreground">{i.issued_on}{i.period_start && i.period_end ? ` · ${i.period_start}~${i.period_end}` : ""}</span>
              <a className="underline" href={`/api/admin/claude-cost/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
              {i.source_url && <a className="underline text-muted-foreground" href={i.source_url} target="_blank" rel="noreferrer">원본</a>}
            </div>
          ))}
        </div>
      )) },
    { key: "plan", header: "티어", value: (o) => o.plan ?? "" , render: (o) => o.plan ?? "—" },
    { key: "seats", header: "좌석", hint: SEATS_HINT, value: (o) => o.seats, align: "right", total: (rows) => int(rows.reduce((a, r) => a + (r.seats ?? 0), 0)) },
    { key: "total", header: "청구 총액", value: (o) => o.totalCents / 100, align: "right", render: (o) => formatCents(o.totalCents), total: (rows) => formatCents(rows.reduce((a, r) => a + r.totalCents, 0)) },
    { key: "perSeat", header: "좌석당", value: (o) => (o.seats ? o.totalCents / 100 / o.seats : null), align: "right", render: (o) => (o.seats ? formatCents(o.totalCents / o.seats) : "—") },
    { key: "active", header: "Claude Code\n활성 사용자", hint: ACTIVE_USERS_HINT, value: (o) => o.activeUsers, align: "right", total: "sum" },
    { key: "perUser", header: "1인당", value: (o) => (o.activeUsers ? o.totalCents / 100 / o.activeUsers : null), align: "right", render: (o) => (o.activeUsers ? formatCents(o.totalCents / o.activeUsers) : "—") },
    { key: "est", header: "추정 비용\n(OTel)", hint: EST_COST_HINT, value: (o) => o.estCostUsd, align: "right", render: (o) => usd(o.estCostUsd), total: (rows) => usd(rows.reduce((a, r) => a + r.estCostUsd, 0)) },
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{month.month} 조직별</span>
        {month.missingOrgs.length > 0 && <Badge variant="outline" className="text-destructive border-destructive/40">인보이스 없음: {month.missingOrgs.join(", ")}</Badge>}
        {month.unassignedCents > 0 && <Badge variant="destructive">미배정 {formatCents(month.unassignedCents)}</Badge>}
      </div>
      <SortableTable rows={month.perOrg} columns={columns} rowKey={(o) => o.orgId ?? "unassigned"} defaultSort={{ key: "total", dir: "desc" }} totalLabel={`총계 (${month.perOrg.length}개 조직)`} emptyText="Team 조직이 없습니다." />
    </div>
  );
}
```

- [ ] **Step 4: 월별 개요 탭**

```tsx
// frontend/src/components/admin/claude-cost/CostOverviewTab.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2 } from "lucide-react";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import OrgSelect from "@/components/admin/claude-usage/OrgSelect";
import { usd, int } from "@/components/admin/claude-usage/format";
import { downloadCsv } from "@/lib/claude-usage/csv-download";
import { formatCents } from "@/lib/claude-cost/money";
import { ACTIVE_USERS_HINT, API_COST_HINT, BILLED_HINT, CSV_ACTIVE_HINT, EST_COST_HINT, PER_SEAT_HINT, PER_USER_HINT, SEATS_HINT } from "@/lib/claude-cost/hints";
import MonthlyBars from "./MonthlyBars";
import MonthOrgDetail from "./MonthOrgDetail";
import type { ClaudeOrg } from "@/types/claude-usage";
import type { MonthlyCost } from "@/types/claude-cost";

interface MonthlyResponse { months: MonthlyCost[]; apiCostAvailable: boolean; orgs: ClaudeOrg[] }

const perSeat = (m: MonthlyCost): number | null => (m.seats ? m.billed.totalCents / m.seats : null);
const perUser = (m: MonthlyCost): number | null => (m.usage.activeUsers ? m.billed.totalCents / m.usage.activeUsers : null);

/** 월별 청구(인보이스) vs 사용량(OTel·CSV). 기간·조직을 고르고, 월 행을 누르면 조직별 상세 */
export default function CostOverviewTab({ onMeta }: { onMeta: (m: { apiCostAvailable: boolean; orgs: ClaudeOrg[] }) => void }) {
  const [months, setMonths] = useState("12");
  const [org, setOrg] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const key = `${months}|${org}`;
  const [result, setResult] = useState<{ key: string; data?: MonthlyResponse; error?: string } | null>(null);
  const loading = result?.key !== key;
  const data = result?.key === key ? result.data ?? null : null;
  const error = result?.key === key ? result.error ?? null : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/claude-cost/monthly?months=${months}&org=${encodeURIComponent(org)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as MonthlyResponse; })
      .then((j) => { if (alive) { setResult({ key, data: j }); onMeta({ apiCostAvailable: j.apiCostAvailable, orgs: j.orgs }); } })
      .catch((e) => { if (alive) setResult({ key, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [key, months, org, onMeta]);

  const rows = useMemo(() => (data?.months ?? []).slice().reverse(), [data]); // 표는 최신 달이 위
  const showApi = !!data?.apiCostAvailable;
  const latest = useMemo(() => rows.find((m) => m.invoices > 0) ?? null, [rows]);
  const selectedMonth = rows.find((m) => m.month === selected) ?? null;

  const columns: Column<MonthlyCost>[] = [
    { key: "month", header: "월", value: (m) => m.month, render: (m) => (
      <button type="button" className="underline-offset-2 hover:underline font-medium" onClick={() => setSelected(m.month)}>{m.month}</button>) },
    { key: "invoices", header: "인보이스", value: (m) => m.invoices, align: "right", render: (m) => (
      <span className="inline-flex items-center gap-1">{int(m.invoices)}{m.missingOrgs.length > 0 && m.invoices > 0 && <Badge variant="outline" className="text-destructive border-destructive/40 text-[10px]">누락 {m.missingOrgs.length}</Badge>}{m.unassignedCents > 0 && <Badge variant="destructive" className="text-[10px]">미배정</Badge>}</span>) },
    { key: "seats", header: "좌석", hint: SEATS_HINT, value: (m) => m.seats, align: "right" },
    { key: "subtotal", header: "청구 세전", value: (m) => m.billed.subtotalCents / 100, align: "right", render: (m) => formatCents(m.billed.subtotalCents), total: (rs) => formatCents(rs.reduce((a, r) => a + r.billed.subtotalCents, 0)) },
    { key: "tax", header: "VAT", value: (m) => m.billed.taxCents / 100, align: "right", render: (m) => formatCents(m.billed.taxCents), total: (rs) => formatCents(rs.reduce((a, r) => a + r.billed.taxCents, 0)) },
    { key: "total", header: "청구 총액", hint: BILLED_HINT, value: (m) => m.billed.totalCents / 100, align: "right", className: "font-semibold", render: (m) => formatCents(m.billed.totalCents), total: (rs) => formatCents(rs.reduce((a, r) => a + r.billed.totalCents, 0)) },
    ...(showApi ? [{ key: "api", header: "API 비용\n(Console)", hint: API_COST_HINT, value: (m: MonthlyCost) => (m.apiCostCents ?? 0) / 100, align: "right" as const, render: (m: MonthlyCost) => formatCents(m.apiCostCents ?? 0), total: (rs: MonthlyCost[]) => formatCents(rs.reduce((a, r) => a + (r.apiCostCents ?? 0), 0)) }] : []),
    { key: "est", header: "추정 비용\n(OTel)", hint: EST_COST_HINT, value: (m) => m.usage.estCostUsd, align: "right", render: (m) => usd(m.usage.estCostUsd), total: (rs) => usd(rs.reduce((a, r) => a + r.usage.estCostUsd, 0)) },
    { key: "active", header: "Claude Code\n활성 사용자", hint: ACTIVE_USERS_HINT, value: (m) => m.usage.activeUsers, align: "right" },
    { key: "csv", header: "활성 멤버\n(CSV)", hint: CSV_ACTIVE_HINT, value: (m) => m.csvActiveMembers, align: "right" },
    { key: "sessions", header: "세션", value: (m) => m.usage.sessions, align: "right", total: "sum" },
    { key: "prompts", header: "사람 프롬프트", value: (m) => m.usage.promptsHuman, align: "right", total: "sum" },
    { key: "perSeat", header: "좌석당", hint: PER_SEAT_HINT, value: (m) => (perSeat(m) === null ? null : (perSeat(m) as number) / 100), align: "right", render: (m) => (perSeat(m) === null ? "—" : formatCents(perSeat(m) as number)) },
    { key: "perUser", header: "1인당", hint: PER_USER_HINT, value: (m) => (perUser(m) === null ? null : (perUser(m) as number) / 100), align: "right", render: (m) => (perUser(m) === null ? "—" : formatCents(perUser(m) as number)) },
  ];

  const exportCsv = () => {
    const head = ["month", "invoices", "seats", "subtotal_usd", "vat_usd", "total_usd", ...(showApi ? ["api_cost_usd"] : []), "est_cost_usd", "code_active_users", "csv_active_members", "sessions", "prompts_human", "per_seat_usd", "per_user_usd", "missing_orgs"];
    downloadCsv(`claude-cost-monthly-${months}m.csv`, head, rows.map((m) => [m.month, m.invoices, m.seats ?? "", (m.billed.subtotalCents / 100).toFixed(2), (m.billed.taxCents / 100).toFixed(2), (m.billed.totalCents / 100).toFixed(2), ...(showApi ? [((m.apiCostCents ?? 0) / 100).toFixed(2)] : []), m.usage.estCostUsd.toFixed(2), m.usage.activeUsers, m.csvActiveMembers ?? "", m.usage.sessions, m.usage.promptsHuman, perSeat(m) === null ? "" : ((perSeat(m) as number) / 100).toFixed(2), perUser(m) === null ? "" : ((perUser(m) as number) / 100).toFixed(2), m.missingOrgs.join("; ")]));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={months} onValueChange={setMonths}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{["6", "12", "24"].map((n) => <SelectItem key={n} value={n}>최근 {n}개월</SelectItem>)}</SelectContent>
        </Select>
        <OrgSelect orgs={data?.orgs ?? []} value={org} onChange={setOrg} />
        <Button variant="outline" size="sm" className="h-8" onClick={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      {latest && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">{latest.month} 청구 총액</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{formatCents(latest.billed.totalCents)}<div className="text-xs text-muted-foreground">세전 {formatCents(latest.billed.subtotalCents)} · VAT {formatCents(latest.billed.taxCents)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">좌석</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{latest.seats === null ? "—" : int(latest.seats)}<div className="text-xs text-muted-foreground">인보이스 {latest.invoices}장{latest.missingOrgs.length ? ` · 누락 ${latest.missingOrgs.length}개 조직` : ""}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">좌석당 월 비용</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{perSeat(latest) === null ? "—" : formatCents(perSeat(latest) as number)}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">활성 사용자당</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{perUser(latest) === null ? "—" : formatCents(perUser(latest) as number)}<div className="text-xs text-muted-foreground">Claude Code 활성 {int(latest.usage.activeUsers)}명{latest.csvActiveMembers !== null ? ` · CSV 활성 ${int(latest.csvActiveMembers)}명` : ""}</div></CardContent></Card>
        </div>
      )}

      {data && <MonthlyBars data={data.months} showApi={showApi} />}
      <SortableTable rows={rows} columns={columns} rowKey={(m) => m.month} defaultSort={{ key: "month", dir: "desc" }} totalLabel={`총계 (${rows.length}개월)`} emptyText={loading ? "불러오는 중..." : "데이터가 없습니다. 인보이스 등록 탭에서 Stripe 링크를 등록하세요."} />
      {selectedMonth && <MonthOrgDetail month={selectedMonth} />}
    </div>
  );
}
```

- [ ] **Step 5: 페이지 + 메뉴**

```tsx
// frontend/src/app/admin/claude-cost/page.tsx
"use client";

import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Receipt } from "lucide-react";
import CostOverviewTab from "@/components/admin/claude-cost/CostOverviewTab";
import InvoiceImportTab from "@/components/admin/claude-cost/InvoiceImportTab";
import ApiCostTab from "@/components/admin/claude-cost/ApiCostTab";
import type { ClaudeOrg } from "@/types/claude-usage";

export default function ClaudeCostPage() {
  const [meta, setMeta] = useState<{ apiCostAvailable: boolean; orgs: ClaudeOrg[] }>({ apiCostAvailable: false, orgs: [] });
  const onMeta = useCallback((m: { apiCostAvailable: boolean; orgs: ClaudeOrg[] }) => setMeta(m), []);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Receipt className="h-5 w-5" />비용 관리</h1>
        <p className="text-sm text-muted-foreground">월별 실제 청구 금액(Anthropic 인보이스)과 사용량(Claude Code OTel · 채팅 CSV)을 나란히 봅니다. 결제 메일의 Stripe 인보이스 링크를 붙여 넣으면 PDF를 받아 자동으로 읽습니다.</p>
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">월별 개요</TabsTrigger>
          <TabsTrigger value="invoices">인보이스 등록</TabsTrigger>
          {meta.apiCostAvailable && <TabsTrigger value="api">API 비용</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview"><CostOverviewTab onMeta={onMeta} /></TabsContent>
        <TabsContent value="invoices"><InvoiceImportTab orgs={meta.orgs} /></TabsContent>
        {meta.apiCostAvailable && <TabsContent value="api"><ApiCostTab /></TabsContent>}
      </Tabs>
    </div>
  );
}
```

Task 8·9 전에 빌드가 깨지지 않게 두 컴포넌트의 **임시 파일은 만들지 않는다** — 이 Task는 Task 8·9와 같은 커밋 흐름에서 `tsc`를 통과시키므로, Task 7의 `tsc` 확인은 Task 9 끝에서 한다(아래 Step 7 참고).

`frontend/src/app/admin/layout.tsx`: import에 `Receipt` 추가, `ADMIN_NAV`의 `"/admin/claude-chat"` 항목 다음에

```ts
  { href: "/admin/claude-cost", label: "비용 관리", icon: Receipt },
```

- [ ] **Step 6: 커밋(부분 — 페이지는 Task 9 뒤 tsc 통과 후 함께)**

```bash
git add frontend/src/lib/claude-cost/hints.ts frontend/src/components/admin/claude-cost/MonthlyBars.tsx frontend/src/components/admin/claude-cost/MonthOrgDetail.tsx frontend/src/components/admin/claude-cost/CostOverviewTab.tsx frontend/src/app/admin/layout.tsx
git commit -m "feat(claude-cost): 월별 개요 탭(카드·막대·표·조직별 상세)과 관리자 메뉴

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

`page.tsx`는 아직 스테이징하지 않는다(Task 8·9 컴포넌트가 없어 tsc가 실패한다).

- [ ] **Step 7: (Task 9 완료 후) 전체 타입·린트**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 오류 0

---

### Task 8: 인보이스 등록 탭

**Files:**
- Create: `frontend/src/components/admin/claude-cost/InvoiceImportTab.tsx`

**Interfaces:**
- Consumes: `POST/GET /api/admin/claude-cost/invoices`, `PATCH/DELETE …/invoices/[id]` (Task 4); `formatCents`; `SortableTable`, `Textarea`(`@/components/ui/textarea`), `Input`, `Button`, `Badge`, `Select`
- Produces: `InvoiceImportTab({ orgs }: { orgs: ClaudeOrg[] })`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// frontend/src/components/admin/claude-cost/InvoiceImportTab.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, Upload, Link2 } from "lucide-react";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { formatCents } from "@/lib/claude-cost/money";
import type { ClaudeOrg } from "@/types/claude-usage";
import type { InvoiceRow } from "@/types/claude-cost";

interface ImportResult { input: string; ok: boolean; invoice?: InvoiceRow; duplicate?: { invoice_number: string; issued_on: string; org_id: string | null }; errors?: string[] }
const UNASSIGNED = "__unassigned__";

/**
 * 인보이스 등록: 결제 메일의 Stripe 링크를 여러 줄 붙여 넣거나(주) PDF를 올린다(보조). 건별 결과를 그대로 보여주고,
 * 등록된 인보이스 표에서 Bill to 자동 매칭이 안 된 장을 조직에 배정하거나 삭제한다.
 */
export default function InvoiceImportTab({ orgs }: { orgs: ClaudeOrg[] }) {
  const [urls, setUrls] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  const reload = useCallback(() => {
    fetch("/api/admin/claude-cost/invoices")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as { invoices: InvoiceRow[] }; })
      .then((j) => { setListError(null); setInvoices(j.invoices); })
      .catch((e) => setListError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const submit = async (body: FormData | { urls: string[] }) => {
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await fetch("/api/admin/claude-cost/invoices", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResults((j as { results: ImportResult[] }).results);
      reload();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const submitUrls = () => {
    const list = urls.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) { setSubmitError("Stripe 인보이스 링크를 한 줄에 하나씩 붙여 넣으세요."); return; }
    void submit({ urls: list });
  };
  const submitFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    void submit(fd);
    if (fileRef.current) fileRef.current.value = "";
  };

  const assign = async (id: string, value: string) => {
    setRowError(null);
    const r = await fetch(`/api/admin/claude-cost/invoices/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: value === UNASSIGNED ? null : value }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setRowError((j as { error?: string }).error ?? `HTTP ${r.status}`); return; }
    reload();
  };
  const remove = async (inv: InvoiceRow) => {
    if (!window.confirm(`${inv.invoice_number} (${inv.bill_to}, ${formatCents(inv.total_cents)}) 인보이스를 삭제할까요? 원본 PDF도 함께 지워집니다.`)) return;
    setRowError(null);
    const r = await fetch(`/api/admin/claude-cost/invoices/${inv.id}`, { method: "DELETE" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setRowError((j as { error?: string }).error ?? `HTTP ${r.status}`); return; }
    reload();
  };

  const columns: Column<InvoiceRow>[] = [
    { key: "issued", header: "발행일", value: (i) => i.issued_on },
    { key: "number", header: "번호", value: (i) => i.invoice_number, render: (i) => <span className="font-mono text-xs">{i.invoice_number}</span> },
    { key: "org", header: "조직", value: (i) => (i.org_id ? orgName.get(i.org_id) ?? i.org_id : ""), render: (i) => (
      <Select value={i.org_id ?? UNASSIGNED} onValueChange={(v) => assign(i.id, v)}>
        <SelectTrigger className={`h-7 w-[170px] text-xs ${i.org_id ? "" : "border-destructive text-destructive"}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>미배정</SelectItem>
          {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
        </SelectContent>
      </Select>) },
    { key: "billTo", header: "Bill to", value: (i) => i.bill_to },
    { key: "period", header: "서비스 기간", value: (i) => i.period_start ?? "", render: (i) => (i.period_start && i.period_end ? `${i.period_start} ~ ${i.period_end}` : "—") },
    { key: "plan", header: "티어", value: (i) => i.plan ?? "", render: (i) => i.plan ?? "—" },
    { key: "seats", header: "좌석", value: (i) => i.seats, align: "right" },
    { key: "subtotal", header: "세전", value: (i) => i.subtotal_cents / 100, align: "right", render: (i) => formatCents(i.subtotal_cents) },
    { key: "tax", header: "VAT", value: (i) => i.tax_cents / 100, align: "right", render: (i) => formatCents(i.tax_cents) },
    { key: "total", header: "총액", value: (i) => i.total_cents / 100, align: "right", className: "font-semibold", render: (i) => formatCents(i.total_cents), total: (rows) => formatCents(rows.reduce((a, r) => a + r.total_cents, 0)) },
    { key: "source", header: "원본", value: (i) => i.source, render: (i) => (
      <span className="inline-flex items-center gap-2 text-xs">
        <a className="underline" href={`/api/admin/claude-cost/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
        {i.source_url && <a className="underline text-muted-foreground" href={i.source_url} target="_blank" rel="noreferrer">Stripe</a>}
      </span>) },
    { key: "actions", header: "", value: () => "", render: (i) => <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => remove(i)} aria-label="삭제"><Trash2 className="h-3.5 w-3.5" /></Button> },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Link2 className="h-4 w-4" />Stripe 인보이스 링크로 등록</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">결제 메일의 &quot;View invoice&quot; 링크(<span className="font-mono">https://invoice.stripe.com/i/…</span>)를 한 줄에 하나씩. 7개 조직을 한 번에 붙여 넣어도 됩니다. 서버가 PDF를 받아 번호·조직(Bill to)·기간·좌석·금액을 읽고 합계를 검증합니다.</p>
          <Textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={4} placeholder={"https://invoice.stripe.com/i/acct_…/live_…?s=ap\nhttps://invoice.stripe.com/i/acct_…/live_…?s=ap"} className="font-mono text-xs" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={submitUrls} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}링크로 등록</Button>
            <span className="text-xs text-muted-foreground">또는</span>
            <Input ref={fileRef} type="file" accept="application/pdf" multiple className="h-8 w-[260px] text-xs" disabled={busy} onChange={(e) => submitFiles(e.target.files)} />
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Upload className="h-3.5 w-3.5" />PDF 직접 업로드(각 2MB)</span>
          </div>
          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          {results && (
            <ul className="space-y-1 text-xs">
              {results.map((r, i) => (
                <li key={i} className="flex flex-wrap items-start gap-2">
                  {r.ok ? <Badge>등록</Badge> : r.duplicate ? <Badge variant="outline">이미 등록됨</Badge> : <Badge variant="destructive">실패</Badge>}
                  <span className="font-mono break-all text-muted-foreground">{r.input.length > 70 ? `${r.input.slice(0, 70)}…` : r.input}</span>
                  {r.ok && r.invoice && <span>{r.invoice.invoice_number} · {r.invoice.bill_to} · {r.invoice.issued_on} · {formatCents(r.invoice.total_cents)}{r.invoice.org_id ? "" : " · 조직 미배정"}</span>}
                  {r.duplicate && <span>{r.duplicate.invoice_number} ({r.duplicate.issued_on})</span>}
                  {r.errors && <span className="text-destructive">{r.errors.join(" / ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">등록된 인보이스 <Badge variant="outline">{invoices.length}장</Badge>{invoices.some((i) => !i.org_id) && <Badge variant="destructive">미배정 {invoices.filter((i) => !i.org_id).length}장 — 조직을 골라 주세요</Badge>}</div>
        {(listError || rowError) && <p className="text-sm text-destructive">{listError ?? rowError}</p>}
        <SortableTable rows={invoices} columns={columns} rowKey={(i) => i.id} defaultSort={{ key: "issued", dir: "desc" }} totalLabel={`총계 (${invoices.length}장)`} rowClassName={(i) => (i.org_id ? "" : "bg-destructive/5")} emptyText="등록된 인보이스가 없습니다." />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/components/admin/claude-cost/InvoiceImportTab.tsx
git commit -m "feat(claude-cost): 인보이스 등록 탭(링크·PDF, 건별 결과, 배정·삭제)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: API 비용 탭 · 페이지 완성

**Files:**
- Create: `frontend/src/components/admin/claude-cost/ApiCostTab.tsx`
- Commit: `frontend/src/app/admin/claude-cost/page.tsx` (Task 7에서 작성)

**Interfaces:**
- Consumes: `GET /api/admin/claude-cost/api-cost?from&to`, `POST …/api-cost/sync` (Task 5); `DailyBars` (`@/components/admin/claude-usage/DailyBars`); `dateRangePreset`, `addDays` (aggregate); `fmtDateTime`
- Produces: `ApiCostTab()`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// frontend/src/components/admin/claude-cost/ApiCostTab.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw } from "lucide-react";
import DailyBars from "@/components/admin/claude-usage/DailyBars";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { fmtDateTime } from "@/components/admin/claude-usage/format";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { formatCents } from "@/lib/claude-cost/money";
import { API_COST_HINT } from "@/lib/claude-cost/hints";
import type { ApiCostRow } from "@/types/claude-cost";

interface ApiCostResponse { available: boolean; rows: ApiCostRow[]; lastSyncedAt: string | null }
interface DescRow { description: string; cost_type: string | null; model: string | null; cents: number; days: number }

/** Admin API cost_report(Console API 사용분). 이 탭은 CLAUDE_ADMIN_API_KEY가 있을 때만 그려진다 */
export default function ApiCostTab() {
  const preset = useMemo(() => dateRangePreset("30d"), []);
  const [from, setFrom] = useState(preset.from);
  const [to, setTo] = useState(preset.to);
  const [tick, setTick] = useState(0);
  const key = `${from}|${to}|${tick}`;
  const [result, setResult] = useState<{ key: string; data?: ApiCostResponse; error?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const loading = result?.key !== key;
  const data = result?.key === key ? result.data ?? null : null;
  const error = result?.key === key ? result.error ?? null : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/claude-cost/api-cost?from=${from}&to=${to}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as ApiCostResponse; })
      .then((j) => { if (alive) setResult({ key, data: j }); })
      .catch((e) => { if (alive) setResult({ key, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [key, from, to]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch("/api/admin/claude-cost/api-cost/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSyncMsg(`${(j as { upserted: number }).upserted}행 수집`);
      setTick((t) => t + 1);
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [from, to]);

  const daily = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of data?.rows ?? []) byDay.set(r.day, (byDay.get(r.day) ?? 0) + Number(r.amount_cents));
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, cents]) => ({ day, usd: cents / 100 }));
  }, [data]);
  const byDesc = useMemo<DescRow[]>(() => {
    const m = new Map<string, DescRow>();
    for (const r of data?.rows ?? []) {
      const cur = m.get(r.description) ?? { description: r.description, cost_type: r.cost_type, model: r.model, cents: 0, days: 0 };
      cur.cents += Number(r.amount_cents);
      cur.days += 1;
      m.set(r.description, cur);
    }
    return [...m.values()];
  }, [data]);
  const total = byDesc.reduce((a, r) => a + r.cents, 0);

  const columns: Column<DescRow>[] = [
    { key: "description", header: "항목", value: (r) => r.description },
    { key: "model", header: "모델", value: (r) => r.model ?? "", render: (r) => r.model ?? "—" },
    { key: "type", header: "종류", value: (r) => r.cost_type ?? "", render: (r) => r.cost_type ?? "—" },
    { key: "cents", header: "비용", hint: API_COST_HINT, value: (r) => r.cents / 100, align: "right", render: (r) => formatCents(r.cents), total: (rows) => formatCents(rows.reduce((a, r) => a + r.cents, 0)) },
    { key: "share", header: "비중", value: (r) => (total ? (r.cents / total) * 100 : 0), align: "right", render: (r) => (total ? `${((r.cents / total) * 100).toFixed(1)}%` : "—") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[150px] text-xs" />
        <span className="text-muted-foreground">~</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[150px] text-xs" />
        <Button size="sm" variant="outline" className="h-8" onClick={sync} disabled={syncing}>{syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}지금 수집</Button>
        {syncMsg && <span className="text-xs text-muted-foreground">{syncMsg}</span>}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {error && <span className="text-destructive">{error}</span>}
        <span className="ml-auto text-xs text-muted-foreground">마지막 수집 {data?.lastSyncedAt ? fmtDateTime(data.lastSyncedAt) : "—"} · 매일 08:00 KST 최근 3일 재수집</span>
      </div>
      <p className="text-xs text-muted-foreground">{API_COST_HINT}</p>
      <DailyBars data={daily} valueKey="usd" label="일별 API 비용(USD)" format={(v) => formatCents(v * 100)} />
      <SortableTable rows={byDesc} columns={columns} rowKey={(r) => r.description} defaultSort={{ key: "cents", dir: "desc" }} totalLabel={`총계 (${byDesc.length}항목)`} emptyText={loading ? "불러오는 중..." : "이 기간에 수집된 API 비용이 없습니다. '지금 수집'을 누르세요."} />
    </div>
  );
}
```

- [ ] **Step 2: 전체 타입·린트·테스트**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run`
Expected: 오류 0, 모든 테스트 PASS(기존 118개 + 신규)

- [ ] **Step 3: 커밋(페이지 포함)**

```bash
git add frontend/src/components/admin/claude-cost/ApiCostTab.tsx frontend/src/app/admin/claude-cost/page.tsx
git commit -m "feat(claude-cost): API 비용 탭과 /admin/claude-cost 페이지

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 문서 · 로컬 확인 · 배포 준비

**Files:**
- Create: `docs/claude-cost.md`
- Modify: `CLAUDE.md` (App Router Pages / API Routes / Supabase Tables / Environment Variables 절)

- [ ] **Step 1: 런북 작성**

```markdown
# Claude 비용 관리 런북

`/admin/claude-cost` — 월별 실제 청구(Anthropic 인보이스) + Admin API cost_report + 사용량(OTel·CSV). 설계 `docs/superpowers/specs/2026-09-18-claude-cost-design.md`.

## 1. 최초 설정 (1회)
1. SQL `docs/sql/2026-09-18-claude-cost.sql` 실행 — 테이블 `claude_invoices`·`claude_invoice_lines`·`claude_api_cost_daily`, Storage 버킷 `claude-invoices`(비공개 2MB).
2. (선택) Claude Console > Settings > Admin keys에서 Admin API 키(`sk-ant-admin01-…`) 발급 → Vercel env `CLAUDE_ADMIN_API_KEY`. 없으면 "API 비용" 탭이 보이지 않는다.
3. `vercel.json` cron `/api/cron/claude-cost`(23:00 UTC = 08:00 KST)은 배포와 함께 등록된다. `CRON_SECRET`은 기존 값을 쓴다.

## 2. 매달 인보이스 등록 (조직 7개, 1분)
1. 결제 메일(Anthropic, PBC / Stripe)의 "View invoice" 링크 7개를 복사한다 — `https://invoice.stripe.com/i/acct_…/live_…?s=ap`.
2. 비용 관리 > 인보이스 등록 탭 textarea에 한 줄씩 붙여 넣고 "링크로 등록".
3. 건별 결과 확인: `등록` / `이미 등록됨`(같은 번호) / `실패`(원인 문구). 실패하면 Stripe 페이지에서 "Download invoice"로 받은 PDF를 업로드한다.
4. "조직 미배정"이 뜨면(Bill to가 `claude_orgs.name`과 다를 때) 표의 조직 드롭다운으로 배정한다. 조직 이름은 `/admin/directory` 조직·설정 탭에서 Bill to와 맞춰 두면 다음 달부터 자동 매칭된다.

## 3. 숫자 읽는 법
- 월 = 인보이스 **발행일**의 달력 월. 서비스 기간(8/23~9/23)이 아니다. 카드 청구서와 같은 기준.
- 청구 총액 = 인보이스 총액(VAT 포함) 합. API 비용은 대조용이며 합계에 없다.
- 좌석 = 그 달 마지막 인보이스(좌석이 적힌 것)의 좌석. 프로레이션(Remaining/Unused) 인보이스는 + 라인의 수량.
- 활성 사용자(OTel)는 Claude Code 사용자만. 채팅 포함 활성은 "활성 멤버(CSV)" 열(그 달에 끝나는 CSV 회차가 있을 때).

## 4. 장애 대응
- `Anthropic 인보이스가 아닙니다` / `라인 아이템 표를 찾을 수 없습니다`: Stripe가 PDF 레이아웃을 바꿨을 수 있다. `frontend/src/lib/claude-cost/stripe-invoice.ts`의 정규식과 테스트 픽스처를 새 레이아웃으로 맞춘다. 저장된 `raw_text`(service role로만 조회)로 줄 모양을 확인할 수 있다.
- `라인 합이 소계와 다릅니다`: 라인 한 줄이 정규식에 안 걸린 것. 위와 같이 처리.
- `PDF를 받지 못했습니다`: 링크 만료·리디렉션. PDF 업로드로 대체.
- `관리자 키가 거부되었습니다`: 키가 회수됐거나 워크스페이스 키를 넣은 것. Admin 키(`sk-ant-admin01-`)여야 한다.
- cost_report 값은 30일간 사후 보정된다 — cron이 매일 최근 3일을 다시 받는다. 더 과거는 "지금 수집"으로 기간을 지정한다.

## 5. 테스트
`cd frontend && npx vitest run src/lib/__tests__/claude-cost-*.test.ts` — 금액·날짜, 인보이스 파서(가공 픽스처), PDF fetch 가드, cost_report 파서·페이지네이션, 월별 집계.
실물 PDF는 저장소에 넣지 않는다.
```

- [ ] **Step 2: CLAUDE.md 갱신**

App Router Pages 목록의 `/admin/claude-chat` 항목 다음에:

```markdown
- `/admin/claude-cost` — 비용 관리(admin): 월별 **실제 청구 금액**(Anthropic Stripe 인보이스 — 결제 메일 링크 붙여넣기 → 서버가 `pay.stripe.com/…/pdf`로 PDF를 받아 파싱, PDF 업로드는 보조) + Admin API `cost_report`(Console API 사용분, `CLAUDE_ADMIN_API_KEY` 있을 때만 탭 표시) + 사용량(OTel 활성 사용자·세션·추정 비용, CSV 활성 멤버) 나란히. 월 = 발행일 기준, 청구 합계는 인보이스만(API 비용은 대조용). 조직별 상세·인보이스 등록/배정/삭제·PDF. 런북 `docs/claude-cost.md`
```

API Routes 목록에:

```markdown
- `/api/admin/claude-cost/{invoices, invoices/[id], invoices/[id]/pdf, monthly, api-cost, api-cost/sync}`, `GET /api/cron/claude-cost`(매일 08:00 KST 최근 3일 재수집) — 비용 관리(admin). 파서·집계 `lib/claude-cost/`(money·stripe-invoice·invoice-ingest·anthropic-cost-report·monthly, 순수 함수는 vitest)
```

Supabase Tables에 새 절:

```markdown
### Supabase Tables (Claude 비용 관리)
- `claude_invoices`(invoice_number 유니크·org_id null 허용=미배정·issued_on·subtotal/tax/total_cents 정수·seats·plan·source link|pdf·source_url·storage_path·raw_text), `claude_invoice_lines`(라인·프로레이션 음수·기간·seats/plan), `claude_api_cost_daily`(pk day·workspace_id·description, amount_cents numeric 소수 센트) — RLS 정책 없음 = service role 전용. Storage 버킷 `claude-invoices`(비공개). SQL `docs/sql/2026-09-18-claude-cost.sql`
```

Environment Variables에:

```markdown
- `CLAUDE_ADMIN_API_KEY` — (선택) Anthropic Admin API 키(`sk-ant-admin01-…`, Console > Admin keys). 비용 관리의 API 비용 수집(`cost_report`)에만 쓰고, 없으면 그 탭을 숨긴다. settings 저장 금지
```

- [ ] **Step 3: 전체 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: 전부 통과. `npm run build`는 몇 분 걸린다(라우트 등록 확인용).

- [ ] **Step 4: (로컬) 화면 확인**

`./frontend/scripts/restart-frontend.sh` 후 `http://localhost:3003/admin/claude-cost` — SQL이 운영 DB에 아직 없으면 API가 500을 내므로, 이 단계는 SQL 적용 뒤에 한다. 확인 항목: 메뉴 "비용 관리" 노출, 3탭(API 비용 탭은 키 없으면 없음), 인보이스 등록 탭에서 실물 링크 1개 등록 → 조직 자동 매칭·금액·기간 확인 → 월별 개요에 반영 → 삭제.

- [ ] **Step 5: 커밋**

```bash
git add docs/claude-cost.md CLAUDE.md
git commit -m "docs(claude-cost): 비용 관리 런북과 CLAUDE.md 갱신

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: 배포 체크리스트(사용자 확인 후)**

1. Supabase에 `docs/sql/2026-09-18-claude-cost.sql` 적용(MCP 미연결이면 Management API — 메모리 `supabase-sql-via-management-api`).
2. `frontend/`에서 `vercel --prod`(반드시 frontend 폴더에서). 배포 URL·alias 확인.
3. 운영에서 인보이스 7장 링크 등록 → 조직 매칭·합계 확인.
4. Admin 키가 준비되면 Vercel env `CLAUDE_ADMIN_API_KEY` 추가 → 재배포 → "API 비용" 탭 → "지금 수집"으로 백필.
