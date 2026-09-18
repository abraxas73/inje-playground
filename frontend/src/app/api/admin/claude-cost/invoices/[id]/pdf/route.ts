import { NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { INVOICE_BUCKET } from "@/lib/claude-cost/invoice-ingest";

/** GET — 원본 PDF 서명 URL(5분)로 302. 관리자 화면의 "PDF" 링크가 새 탭으로 연다 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { id } = await params;
  const row = await c.admin.from("claude_invoices").select("storage_path").eq("id", id).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  if (!row.data) return NextResponse.json({ error: "없는 인보이스입니다." }, { status: 404 });
  const signed = await c.admin.storage.from(INVOICE_BUCKET).createSignedUrl(row.data.storage_path as string, 300);
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: signed.error?.message ?? "서명 URL 생성 실패" }, { status: 500 });
  return NextResponse.redirect(signed.data.signedUrl, 302);
}
