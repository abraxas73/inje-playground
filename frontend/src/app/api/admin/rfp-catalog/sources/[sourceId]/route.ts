import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";

export const runtime = "nodejs";

/** DELETE /api/admin/rfp-catalog/sources/[sourceId] → 204. 그 소스에서 온 기능은 남고 source_id만 null(FK set null). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { sourceId } = await params;
  const { data, error } = await a.admin.from("rfp_solution_sources").delete().eq("id", sourceId).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "소스가 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
