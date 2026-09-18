import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { fetchInvoicePdf, ingestInvoice, INVOICE_COLUMNS, MAX_INVOICE_BYTES, type IngestResult } from "@/lib/claude-cost/invoice-ingest";
import type { InvoiceLineRow, InvoiceRow } from "@/types/claude-cost";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_URLS = 20;

/** GET /api/admin/claude-cost/invoices?from&to&org — 발행일 범위·조직(id | unassigned | all) */
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
      if (!got.ok) {
        results.push({ input: url, ok: false, errors: [got.error] });
        continue;
      }
      push(url, await ingestInvoice({ bytes: got.bytes, source: "link", sourceUrl: url }, deps));
    }
  } else {
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "PDF 파일이 필요합니다." }, { status: 400 });
    for (const file of files) {
      if (file.size > MAX_INVOICE_BYTES) {
        results.push({ input: file.name, ok: false, errors: ["PDF가 2MB를 초과합니다."] });
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      push(file.name, await ingestInvoice({ bytes, source: "pdf" }, deps));
    }
  }
  return NextResponse.json({ results });
}
