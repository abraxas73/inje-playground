import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
type Params = { params: Promise<{ shareId: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/rfp/shares/[shareId] — 공유 링크 폐기(등록자 또는 admin).
 * 유출된 링크를 막는 유일한 수단이라 즉시 무효가 되어야 한다(행 삭제).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { shareId } = await params;
  if (!UUID_RE.test(shareId)) return NextResponse.json({ error: "잘못된 링크 ID입니다." }, { status: 400 });

  // 토큰은 읽지 않는다 — 소유자 확인에 필요한 것은 프로젝트 id뿐이다
  const { data: link, error } = await auth.admin
    .from("rfp_share_links").select("id, project_id, visibility").eq("id", shareId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!link) return NextResponse.json({ error: "공유 링크가 없습니다." }, { status: 404 });
  const row = link as { id: string; project_id: string; visibility: string };

  const { data: project, error: pe } = await auth.admin
    .from("rfp_projects").select("id, created_by").eq("id", row.project_id).maybeSingle();
  if (pe) return NextResponse.json({ error: pe.message }, { status: 500 });
  const createdBy = (project as { created_by: string | null } | null)?.created_by ?? null;
  if (auth.role !== "admin" && createdBy !== auth.userId) {
    return NextResponse.json({ error: "이 프로젝트를 등록한 사람 또는 관리자만 폐기할 수 있습니다." }, { status: 403 });
  }

  const { error: de } = await auth.admin.from("rfp_share_links").delete().eq("id", shareId);
  if (de) return NextResponse.json({ error: de.message }, { status: 500 });
  await logAudit(auth.admin, request, {
    userId: auth.userId, action: "공유 링크 폐기", category: "rfp",
    detail: { projectId: row.project_id, linkId: row.id, visibility: row.visibility },
  });
  return new NextResponse(null, { status: 204 });
}
