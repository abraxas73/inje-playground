import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { fetchInvoicePdf, ingestInvoice } from "@/lib/claude-cost/invoice-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_ITEMS = 100;

type Item = { org_id: string; invoice_number: string; url: string };

/**
 * POST /api/admin/claude-cost/invoices/sync — Bearer OPS_INGEST_TOKEN
 * 운영자 Mac `scripts/claude-invoice-sync.mjs`가 claude.ai 결제 화면 목록(/api/stripe/<org>/invoices)을 그대로 보낸다.
 * { items: [{ org_id, invoice_number, url }] } — 이미 있는 번호는 PDF를 받지 않고 건너뛰고, 새 번호만 링크 등록과 같은 경로로 적재.
 */
export async function POST(request: NextRequest) {
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.OPS_INGEST_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const body = (await request.json().catch(() => null)) as { items?: unknown } | null;
  const items = (Array.isArray(body?.items) ? body!.items : []).filter(
    (i): i is Item => !!i && typeof i === "object" && ["org_id", "invoice_number", "url"].every((k) => typeof (i as Record<string, unknown>)[k] === "string"),
  );
  if (items.length === 0) return NextResponse.json({ error: "items가 필요합니다." }, { status: 400 });
  if (items.length > MAX_ITEMS) return NextResponse.json({ error: `한 번에 ${MAX_ITEMS}건까지입니다.` }, { status: 400 });

  const known = await admin.from("claude_invoices").select("invoice_number").in("invoice_number", items.map((i) => i.invoice_number));
  if (known.error) return NextResponse.json({ error: known.error.message }, { status: 500 });
  const have = new Set((known.data ?? []).map((r) => r.invoice_number as string));
  const orgs = await admin.from("claude_orgs").select("id, name").eq("category", "team");
  if (orgs.error) return NextResponse.json({ error: orgs.error.message }, { status: 500 });
  const deps = { admin, orgs: (orgs.data ?? []) as { id: string; name: string }[], uploadedBy: null, request };

  const results: { invoice_number: string; status: "added" | "exists" | "failed"; org_id?: string | null; error?: string }[] = [];
  for (const item of items) {
    if (have.has(item.invoice_number)) {
      results.push({ invoice_number: item.invoice_number, status: "exists" });
      continue;
    }
    const got = await fetchInvoicePdf(item.url);
    if (!got.ok) {
      results.push({ invoice_number: item.invoice_number, status: "failed", error: got.error });
      continue;
    }
    const r = await ingestInvoice({ bytes: got.bytes, source: "link", sourceUrl: item.url, orgId: item.org_id }, deps);
    if (r.ok) results.push({ invoice_number: item.invoice_number, status: "added", org_id: r.invoice.org_id });
    else if ("duplicate" in r) results.push({ invoice_number: item.invoice_number, status: "exists" });
    else results.push({ invoice_number: item.invoice_number, status: "failed", error: r.errors.join("; ") });
  }
  return NextResponse.json({ results });
}
