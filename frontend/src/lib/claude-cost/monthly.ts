/**
 * 월별 비용 집계 — 순수 함수. 두 가지 월 배정 기준을 지원한다.
 * - issued(기본): 인보이스 발행일의 달력 월. 재무팀이 보는 카드 청구와 같은 기준.
 * - period: 서비스 기간 [period_start, period_end) 을 겹치는 일수 비례로 달마다 배분(연간 인보이스를 12개월로 나눠 보는 용도).
 *   반올림 잔여는 그 인보이스의 마지막 달에 붙여 합계를 보존하고, VAT = 총액 − 세전으로 맞춘다. 기간이 없는 장은 발행 월에 전액.
 * 청구 합계는 인보이스만. Admin API 비용은 대조용 별도 값이라 합계에 더하지 않는다.
 * "누락 조직"은 기준과 무관하게 서비스 기간이 그 달을 덮는 인보이스가 없는 Team 조직이다 — 연간 플랜 조직이 매달 누락으로 보이지 않게.
 * 사용량은 OTel(claude_code_daily, KST day)을 같은 달로 묶고, CSV 활성 멤버는 그 달에 끝나는 CSV 중 조직별 최신 것만 쓴다.
 */
import { isActive } from "@/lib/claude-usage/aggregate";
import { daysBetween, monthOf, monthsCovering, overlapDays } from "./money";
import type { ClaudeOrg, DailyRow } from "@/types/claude-usage";
import type { ApiCostRow, InvoiceAllocation, InvoiceRow, MonthBasis, MonthlyCost, MonthlyOrgCost, MonthlyTier } from "@/types/claude-cost";

export interface MonthlyInput {
  months: string[];
  orgs: Pick<ClaudeOrg, "id" | "name" | "sort_order">[];
  /** period 기준이면 기간이 months와 겹치는 인보이스까지 넘겨야 한다(라우트가 조회 범위를 넓힌다) */
  invoices: InvoiceRow[];
  /** null = Admin API 키 없음(열 자체를 그리지 않는다) */
  apiCost: ApiCostRow[] | null;
  daily: DailyRow[];
  csv: { org_id: string; period_end: string; active: number }[];
}

export interface MonthlyOptions {
  basis?: MonthBasis;
}

const UNASSIGNED_NAME = "미배정";
export const NO_TIER = "(티어 없음)";

/**
 * 티어별 집계. 금액은 그 달에 기여한 인보이스를 헤더 티어로 묶고(조직마다 티어가 하나라 헤더로 충분),
 * 좌석은 조직별 대표 장(orgCost의 seats/plan)을 티어로 묶는다 — Standard($25대)와 Premium($125대)을 섞어 나눈 좌석당 비용은 뜻이 없어서다.
 */
function tierSummary(contribs: Contribution[], perOrg: MonthlyOrgCost[]): MonthlyTier[] {
  const byPlan = new Map<string, MonthlyTier>();
  const get = (plan: string): MonthlyTier => {
    let t = byPlan.get(plan);
    if (!t) { t = { plan, seats: null, subtotalCents: 0, totalCents: 0, invoices: 0 }; byPlan.set(plan, t); }
    return t;
  };
  for (const c of contribs) {
    const t = get(c.invoice.plan ?? NO_TIER);
    t.totalCents += c.totalCents;
    t.subtotalCents += c.subtotalCents;
    t.invoices += 1;
  }
  for (const o of perOrg) {
    if (o.seats === null) continue;
    const t = get(o.plan ?? NO_TIER);
    t.seats = (t.seats ?? 0) + o.seats;
  }
  return [...byPlan.values()].sort((a, b) => b.totalCents - a.totalCents || a.plan.localeCompare(b.plan));
}

function servicePeriod(i: InvoiceRow): { start: string; end: string } | null {
  return i.period_start && i.period_end && i.period_end > i.period_start ? { start: i.period_start, end: i.period_end } : null;
}

/** 서비스 기간이 그 달을 덮는가(기간이 없으면 발행 월) */
export function coversMonth(i: InvoiceRow, month: string): boolean {
  const p = servicePeriod(i);
  return p ? overlapDays(p.start, p.end, month) > 0 : monthOf(i.issued_on) === month;
}

/** 한 인보이스의 금액을 서비스 기간 달마다 일수 비례로 나눈다. 잔여는 마지막 달에. 기간이 없으면 발행 월에 전액 */
export function allocateByDays(i: InvoiceRow, cents: number): Map<string, { cents: number; days: number | null; totalDays: number | null }> {
  const out = new Map<string, { cents: number; days: number | null; totalDays: number | null }>();
  const p = servicePeriod(i);
  if (!p) {
    out.set(monthOf(i.issued_on), { cents, days: null, totalDays: null });
    return out;
  }
  const totalDays = daysBetween(p.start, p.end);
  const months = monthsCovering(p.start, p.end);
  let assigned = 0;
  months.forEach((m, idx) => {
    const days = overlapDays(p.start, p.end, m);
    const share = idx === months.length - 1 ? cents - assigned : Math.round((cents * days) / totalDays);
    assigned += share;
    out.set(m, { cents: share, days, totalDays });
  });
  return out;
}

interface Contribution {
  invoice: InvoiceRow;
  totalCents: number;
  subtotalCents: number;
  days: number | null;
  totalDays: number | null;
}

/** 그 달에 기여하는 인보이스와 금액(기준에 따라 전액 또는 배분액) */
function contributions(invoices: InvoiceRow[], month: string, basis: MonthBasis): Contribution[] {
  const out: Contribution[] = [];
  for (const i of invoices) {
    if (basis === "issued") {
      if (monthOf(i.issued_on) === month) out.push({ invoice: i, totalCents: i.total_cents, subtotalCents: i.subtotal_cents, days: null, totalDays: null });
      continue;
    }
    const total = allocateByDays(i, i.total_cents).get(month);
    if (!total) continue;
    const sub = allocateByDays(i, i.subtotal_cents).get(month);
    out.push({ invoice: i, totalCents: total.cents, subtotalCents: sub?.cents ?? 0, days: total.days, totalDays: total.totalDays });
  }
  return out.sort((a, b) => a.invoice.issued_on.localeCompare(b.invoice.issued_on) || a.invoice.invoice_number.localeCompare(b.invoice.invoice_number));
}

function orgCost(orgId: string | null, name: string, contribs: Contribution[], month: string, daily: DailyRow[]): MonthlyOrgCost {
  // 좌석은 그 달을 덮는(issued 기준은 그 달 발행) 인보이스 중 seats가 파싱된 가장 늦은 장 — 좌석 없는 장(Console 등)은 건너뛴다
  const monthEnd = `${month}-31`;
  const withSeats = contribs.filter((c) => c.invoice.seats !== null && c.invoice.issued_on <= monthEnd);
  const latest = withSeats[withSeats.length - 1];
  const emails = new Set<string>();
  let estCostUsd = 0;
  for (const r of daily) {
    if (r.org_id !== orgId) continue;
    if (isActive(r)) emails.add(r.user_email);
    estCostUsd += Number(r.cost_usd) || 0;
  }
  const allocations: InvoiceAllocation[] = contribs.map((c) => ({ invoiceId: c.invoice.id, cents: c.totalCents, days: c.days, totalDays: c.totalDays }));
  return {
    orgId,
    name,
    invoices: contribs.map((c) => c.invoice),
    allocations,
    totalCents: contribs.reduce((a, c) => a + c.totalCents, 0),
    seats: latest?.invoice.seats ?? null,
    plan: latest?.invoice.plan ?? null,
    activeUsers: emails.size,
    estCostUsd,
  };
}

export function summarizeMonthly(input: MonthlyInput, opts: MonthlyOptions = {}): MonthlyCost[] {
  const basis: MonthBasis = opts.basis ?? "issued";
  const orgs = [...input.orgs].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko"));
  return input.months.map((month) => {
    const contribs = contributions(input.invoices, month, basis);
    const daily = input.daily.filter((r) => monthOf(r.day) === month);

    const perOrg: MonthlyOrgCost[] = orgs.map((o) => orgCost(o.id, o.name, contribs.filter((c) => c.invoice.org_id === o.id), month, daily));
    const unassigned = contribs.filter((c) => c.invoice.org_id === null);
    if (unassigned.length) perOrg.push(orgCost(null, UNASSIGNED_NAME, unassigned, month, []));

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

    const subtotalCents = contribs.reduce((a, c) => a + c.subtotalCents, 0);
    const totalCents = contribs.reduce((a, c) => a + c.totalCents, 0);
    return {
      month,
      basis,
      invoices: contribs.length,
      tiers: tierSummary(contribs, perOrg),
      billed: { subtotalCents, taxCents: totalCents - subtotalCents, totalCents },
      seats: seatOrgs.length ? seatOrgs.reduce((a, o) => a + (o.seats ?? 0), 0) : null,
      missingOrgs: orgs.filter((o) => !input.invoices.some((i) => i.org_id === o.id && coversMonth(i, month))).map((o) => o.name),
      unassignedCents: unassigned.reduce((a, c) => a + c.totalCents, 0),
      apiCostCents,
      usage,
      csvActiveMembers,
      perOrg,
    };
  });
}
