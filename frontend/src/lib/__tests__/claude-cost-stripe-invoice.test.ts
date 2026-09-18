import { describe, it, expect } from "vitest";
import { invoiceLinkToPdfUrl, matchOrg, parseStripeInvoice, isPdf, type InvoiceTextLine } from "@/lib/claude-cost/stripe-invoice";

const L = (text: string, frags?: { x0: number; text: string }[]): InvoiceTextLine => ({ text, frags: frags ?? [{ x0: 0, text }] });

/** 프로레이션 2줄(좌석 40→97), VAT 10% — 실물 레이아웃을 본뜬 가공값 */
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
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.invoice.billTo).toBe("Innogrid Cloud Team");
  });

  it("Bill to가 없으면 오류에 포함된다", () => {
    const r = parseStripeInvoice(PRORATED.filter((l) => !l.text.includes("Bill to")));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("Bill to"))).toBe(true);
  });

  it("연말을 걸치는 기간도 라인에 붙는다", () => {
    const lines = replaceLine(PRORATED, "Aug 23–Sep 23, 2026", "Dec 23–Jan 23, 2027");
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
