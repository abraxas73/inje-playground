import { describe, it, expect } from "vitest";
import { allocateByDays, coversMonth, NO_TIER, orgStartedBy, summarizeMonthly, type MonthlyInput } from "@/lib/claude-cost/monthly";
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
    expect(jul.missingOrgs).toEqual([]); // ax는 8월에 시작 → 7월은 시작 전이라 누락이 아니다
    expect(jul.unassignedCents).toBe(0);
  });

  it("인보이스가 없는 달은 seats null·합 0, 모든 조직 누락", () => {
    const r = summarizeMonthly(base);
    expect(r[0]).toMatchObject({ month: "2026-07", invoices: 0, seats: null, billed: { totalCents: 0 }, missingOrgs: [], apiCostCents: null, csvActiveMembers: null }); // 인보이스가 한 장도 없으면 시작 전
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

describe("서비스 기간 커버리지 기반 누락 판정", () => {
  const annual = inv({ id: "y", invoice_number: "Y-1", org_id: "ax", issued_on: "2026-05-17", total_cents: 1080000, subtotal_cents: 1080000, tax_cents: 0, seats: 9, period_start: "2026-05-17", period_end: "2027-05-17" });
  const monthly = inv({ id: "m", invoice_number: "M-1", org_id: "bx", issued_on: "2026-08-24", total_cents: 5500, seats: 2, period_start: "2026-08-24", period_end: "2026-09-24" });
  it("연간 조직은 기간 12개월 동안 누락이 아니고, 월 갱신 조직은 다음 장이 없는 달부터 누락", () => {
    const r = summarizeMonthly({ ...base, months: ["2026-05", "2026-06", "2026-08", "2026-09", "2026-10"], invoices: [annual, monthly] });
    expect(r.map((m) => m.missingOrgs)).toEqual([
      [],                            // 5월: ax 연간 시작, bx는 8월 시작이라 아직 대상 아님
      [],                            // 6월: ax 연간 덮음
      [],                            // 8월: 둘 다
      [],                            // 9월: bx 8/24~9/24가 9월을 덮음
      ["Innogrid-bx"],               // 10월: bx 다음 장 없음 → 누락
    ]);
    expect(coversMonth(monthly, "2026-09")).toBe(true);
    expect(coversMonth(monthly, "2026-10")).toBe(false);
  });
  it("기간이 없는 장은 발행 월만 덮는다", () => {
    const noPeriod = inv({ id: "n", invoice_number: "N-1", org_id: "ax", issued_on: "2026-08-23", total_cents: 110 });
    expect(coversMonth(noPeriod, "2026-08")).toBe(true);
    expect(coversMonth(noPeriod, "2026-09")).toBe(false);
  });
  it("issued 기준에서도 누락은 커버리지로 판정하되 금액은 발행 월에만 잡힌다", () => {
    const r = summarizeMonthly({ ...base, months: ["2026-05", "2026-06"], invoices: [annual] });
    expect(r[0].billed.totalCents).toBe(1080000);
    expect(r[1].billed.totalCents).toBe(0);
    expect(r[1].missingOrgs).toEqual([]); // bx는 인보이스가 없어 시작 전
    expect(r[1].invoices).toBe(0);
  });
});

describe("서비스 기간 일할 배분(basis: period)", () => {
  const annual = inv({ id: "y", invoice_number: "Y-1", org_id: "ax", issued_on: "2026-05-17", total_cents: 1080000, subtotal_cents: 1080000, tax_cents: 0, seats: 9, plan: "Team plan - Premium", period_start: "2026-05-17", period_end: "2027-05-17" });
  const prorated = inv({ id: "p", invoice_number: "P-1", org_id: "bx", issued_on: "2026-08-23", total_cents: 780338, subtotal_cents: 709398, tax_cents: 70940, seats: 97, period_start: "2026-08-23", period_end: "2026-09-23" });
  it("allocateByDays: 일수 비례, 잔여는 마지막 달, 합은 총액", () => {
    const a = allocateByDays(prorated, prorated.total_cents);
    expect(a.get("2026-08")).toEqual({ cents: Math.round((780338 * 9) / 31), days: 9, totalDays: 31 });
    expect(a.get("2026-09")!.days).toBe(22);
    expect([...a.values()].reduce((s, v) => s + v.cents, 0)).toBe(780338);
    const y = allocateByDays(annual, annual.total_cents);
    expect(y.size).toBe(13);
    expect([...y.values()].reduce((s, v) => s + v.cents, 0)).toBe(1080000);
    expect(y.get("2026-06")).toEqual({ cents: Math.round((1080000 * 30) / 365), days: 30, totalDays: 365 });
  });
  it("월별 합·VAT·좌석·배분 상세가 기간 기준으로 나온다", () => {
    const r = summarizeMonthly({ ...base, months: ["2026-08", "2026-09"], invoices: [annual, prorated] }, { basis: "period" });
    const aug = r[0];
    expect(aug.basis).toBe("period");
    expect(aug.invoices).toBe(2);
    const augAnnual = Math.round((1080000 * 31) / 365);
    const augPro = Math.round((780338 * 9) / 31);
    expect(aug.billed.totalCents).toBe(augAnnual + augPro);
    expect(aug.billed.subtotalCents).toBe(augAnnual + Math.round((709398 * 9) / 31));
    expect(aug.billed.taxCents).toBe(aug.billed.totalCents - aug.billed.subtotalCents);
    expect(aug.seats).toBe(9 + 97);
    expect(aug.missingOrgs).toEqual([]);
    const bx = aug.perOrg.find((o) => o.orgId === "bx")!;
    expect(bx.allocations).toEqual([{ invoiceId: "p", cents: augPro, days: 9, totalDays: 31 }]);
    const sep = r[1];
    expect(sep.perOrg.find((o) => o.orgId === "bx")!.totalCents).toBe(780338 - augPro);
    expect(sep.seats).toBe(9 + 97);
  });
  it("기간이 없는 장은 period 기준에서도 발행 월 전액", () => {
    const noPeriod = inv({ id: "n", invoice_number: "N-1", org_id: "ax", issued_on: "2026-08-23", total_cents: 110, subtotal_cents: 100, tax_cents: 10 });
    const r = summarizeMonthly({ ...base, months: ["2026-08", "2026-09"], invoices: [noPeriod] }, { basis: "period" });
    expect(r[0].billed).toEqual({ subtotalCents: 100, taxCents: 10, totalCents: 110 });
    expect(r[0].perOrg[0].allocations[0]).toEqual({ invoiceId: "n", cents: 110, days: null, totalDays: null });
    expect(r[1].billed.totalCents).toBe(0);
  });
  it("issued 기준(기본)은 basis 필드와 전액 배분(days null)을 낸다", () => {
    const r = summarizeMonthly({ ...base, months: ["2026-08"], invoices: [prorated] });
    expect(r[0].basis).toBe("issued");
    expect(r[0].perOrg.find((o) => o.orgId === "bx")!.allocations).toEqual([{ invoiceId: "p", cents: 780338, days: null, totalDays: null }]);
  });
});

describe("티어별 좌석·금액", () => {
  const orgs3 = [...orgs, { id: "cx", name: "Innogrid-cx", sort_order: 2 }];
  const premium = inv({ id: "p1", invoice_number: "P-1", org_id: "ax", issued_on: "2026-08-23", total_cents: 780338, subtotal_cents: 709398, tax_cents: 70940, seats: 97, plan: "Team plan - Premium" });
  const standard = inv({ id: "s1", invoice_number: "S-1", org_id: "bx", issued_on: "2026-08-24", total_cents: 306148, subtotal_cents: 278316, tax_cents: 27832, seats: 114, plan: "Team plan - Standard" });
  const noTier = inv({ id: "n1", invoice_number: "N-1", org_id: "cx", issued_on: "2026-08-25", total_cents: 5500, subtotal_cents: 5000, tax_cents: 500 });
  it("금액은 인보이스 티어로, 좌석은 조직 대표 장의 티어로 묶고 금액 큰 순", () => {
    const r = summarizeMonthly({ ...base, months: ["2026-08"], orgs: orgs3, invoices: [premium, standard, noTier] });
    expect(r[0].tiers).toEqual([
      { plan: "Team plan - Premium", seats: 97, subtotalCents: 709398, totalCents: 780338, invoices: 1 },
      { plan: "Team plan - Standard", seats: 114, subtotalCents: 278316, totalCents: 306148, invoices: 1 },
      { plan: NO_TIER, seats: null, subtotalCents: 5000, totalCents: 5500, invoices: 1 },
    ]);
    expect(r[0].seats).toBe(97 + 114);
  });
  it("같은 조직의 여러 장은 좌석은 마지막 장 하나, 금액은 전부 그 티어에", () => {
    const early = inv({ id: "p0", invoice_number: "P-0", org_id: "ax", issued_on: "2026-08-23", total_cents: 68750, subtotal_cents: 62500, tax_cents: 6250, seats: 5, plan: "Team plan - Premium" });
    const r = summarizeMonthly({ ...base, months: ["2026-08"], invoices: [early, premium] });
    expect(r[0].tiers).toEqual([{ plan: "Team plan - Premium", seats: 97, subtotalCents: 709398 + 62500, totalCents: 780338 + 68750, invoices: 2 }]);
  });
  it("period 기준에서는 배분액으로 묶인다", () => {
    const annual = inv({ id: "y", invoice_number: "Y-1", org_id: "ax", issued_on: "2026-05-17", total_cents: 1080000, subtotal_cents: 1080000, tax_cents: 0, seats: 9, plan: "Team plan - Premium", period_start: "2026-05-17", period_end: "2027-05-17" });
    const r = summarizeMonthly({ ...base, months: ["2026-06"], invoices: [annual] }, { basis: "period" });
    expect(r[0].tiers).toEqual([{ plan: "Team plan - Premium", seats: 9, subtotalCents: Math.round((1080000 * 30) / 365), totalCents: Math.round((1080000 * 30) / 365), invoices: 1 }]);
  });
  it("인보이스가 없는 달은 tiers 빈 배열", () => {
    expect(summarizeMonthly(base)[0].tiers).toEqual([]);
  });
});

describe("조직 시작 시점 — 첫 인보이스 전 달은 누락이 아니다", () => {
  const ax = inv({ id: "a1", invoice_number: "A-1", org_id: "ax", issued_on: "2026-08-23", total_cents: 110, period_start: "2026-08-23", period_end: "2026-09-23" });
  const bxApr = inv({ id: "b1", invoice_number: "B-1", org_id: "bx", issued_on: "2026-04-07", total_cents: 110, period_start: "2026-04-07", period_end: "2026-05-07" });
  it("orgStartedBy: 서비스 기간 시작(없으면 발행일)이 그 달 말 이전이면 시작", () => {
    expect(orgStartedBy([ax], "ax", "2026-07")).toBe(false);
    expect(orgStartedBy([ax], "ax", "2026-08")).toBe(true);
    expect(orgStartedBy([ax], "ax", "2026-12")).toBe(true);
    expect(orgStartedBy([ax], "bx", "2026-12")).toBe(false);
    const noPeriod = inv({ id: "n", invoice_number: "N-1", org_id: "ax", issued_on: "2026-06-15", total_cents: 110 });
    expect(orgStartedBy([noPeriod], "ax", "2026-06")).toBe(true);
    expect(orgStartedBy([noPeriod], "ax", "2026-05")).toBe(false);
  });
  it("8월 시작 조직은 5~7월 누락 없음, 4월 시작 조직은 6월부터(다음 장 없음) 누락", () => {
    const r = summarizeMonthly({ ...base, months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-10"], invoices: [ax, bxApr] });
    expect(r.map((m) => [m.month, m.missingOrgs])).toEqual([
      ["2026-05", []],                 // bx 4/7~5/7이 5월을 덮음, ax 시작 전
      ["2026-06", ["Innogrid-bx"]],    // bx 다음 장 없음
      ["2026-07", ["Innogrid-bx"]],
      ["2026-08", ["Innogrid-bx"]],    // ax 8월 시작·덮음
      ["2026-10", ["Innogrid-ax", "Innogrid-bx"]],
    ]);
  });
});
