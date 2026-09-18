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
