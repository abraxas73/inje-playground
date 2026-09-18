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
