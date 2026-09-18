/**
 * 인보이스 등록: PDF 바이트(링크에서 받았든 업로드했든) → 파싱·검증 → 중복 확인 → Storage → DB → 감사 로그.
 * 라우트는 이 함수만 부른다. 실패는 예외가 아니라 결과 값으로 돌려 건별 결과를 화면에 그대로 보여준다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { extractInvoiceLines, invoiceLinkToPdfUrl, isPdf, matchOrg, parseStripeInvoice, type InvoiceTextLine } from "./stripe-invoice";
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

  let lines: InvoiceTextLine[];
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
