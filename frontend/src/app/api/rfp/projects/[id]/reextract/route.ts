import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { runExtraction } from "@/lib/rfp/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/rfp/projects/[id]/reextract {confirm?: boolean}
 * 편집된 행(updated_by not null)이 있고 confirm이 아니면 409 {needsConfirm, editedCount}. 아니면 extracting으로 되돌리고 after()로 추출.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  const { data: project } = await auth.admin.from("rfp_projects").select("id, status").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  if (project.status === "extracting") return NextResponse.json({ error: "이미 추출 중입니다." }, { status: 409 });

  const { count, error: countError } = await auth.admin
    .from("rfp_requirements")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id)
    .not("updated_by", "is", null);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  if ((count ?? 0) > 0 && body.confirm !== true) {
    return NextResponse.json({ needsConfirm: true, editedCount: count }, { status: 409 });
  }
  await auth.admin.from("rfp_projects").update({ status: "extracting", error: null, updated_by: auth.userId }).eq("id", id);
  const admin = auth.admin;
  after(async () => {
    await runExtraction(admin, id);
  });
  return NextResponse.json({ status: "extracting" }, { status: 202 });
}
