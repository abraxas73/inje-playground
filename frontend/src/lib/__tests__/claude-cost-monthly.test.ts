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
