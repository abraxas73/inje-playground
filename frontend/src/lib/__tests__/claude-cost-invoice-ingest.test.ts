import { describe, it, expect, vi } from "vitest";
import { fetchInvoicePdf, MAX_INVOICE_BYTES } from "@/lib/claude-cost/invoice-ingest";

// jsdom과 Node 영역의 Uint8Array가 달라 바이트는 Array.from으로 값 비교한다
const pdfBytes = new TextEncoder().encode("%PDF-1.4 fake");
const okResponse = (body: Uint8Array, headers: Record<string, string> = { "content-type": "application/pdf" }, status = 200) =>
  new Response(body, { status, headers });

describe("fetchInvoicePdf", () => {
  it("호스팅 링크를 PDF 링크로 바꿔 받고 바이트를 돌려준다", async () => {
    const fetchImpl = vi.fn(async () => okResponse(pdfBytes));
    const r = await fetchInvoicePdf("https://invoice.stripe.com/i/acct_1/live_2?s=ap", fetchImpl as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.pdfUrl).toBe("https://pay.stripe.com/invoice/acct_1/live_2/pdf?s=ap"); expect(Array.from(r.bytes)).toEqual(Array.from(pdfBytes)); }
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
