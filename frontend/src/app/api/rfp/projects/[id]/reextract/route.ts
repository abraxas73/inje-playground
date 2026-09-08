import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { runExtraction } from "@/lib/rfp/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/** extracting 상태를 멈춘 것으로 볼 기준 시간(ms). Vercel maxDuration(300s)보다 넉넉히 잡는다. */
const STALE_EXTRACTING_MS = 6 * 60 * 1000;

/**
 * POST /api/rfp/projects/[id]/reextract {confirm?: boolean}
 * 편집된 행(updated_by not null)이 있고 confirm이 아니면 409 {needsConfirm, editedCount}. 아니면 extracting으로 되돌리고 after()로 추출.
 * status가 extracting이어도 updated_at이 6분 넘게 지났으면(after()가 죽어 멈춘 것으로 보고) 재추출을 허용한다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  const { data: project, error: projectError } = await auth.admin
    .from("rfp_projects").select("id, status, updated_at, mapping_status").eq("id", id).maybeSingle();
  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  if (project.status === "extracting" && Date.now() - Date.parse(project.updated_at) <= STALE_EXTRACTING_MS) {
    return NextResponse.json({ error: "이미 추출 중입니다." }, { status: 409 });
  }
  // 매핑이 도는 중에 요구사항을 갈아치우면 그 잡이 사라진 요구사항에 행을 쓰려다 실패하거나
  // 옛 세부 항목 키로 유령 행을 남긴다 — 끝난 뒤에 하도록 막는다.
  if (project.mapping_status === "running" && Date.now() - Date.parse(project.updated_at) <= STALE_EXTRACTING_MS) {
    return NextResponse.json({ error: "솔루션 매핑이 끝난 뒤 재추출할 수 있습니다." }, { status: 409 });
  }

  // 재추출은 요구사항을 전량 교체하고, 매핑 행은 FK cascade로 함께 사라진다(사람이 확정한 행까지).
  // 그래서 편집된 요구사항 수와 **매핑 행 수(확정 행 수)** 를 모두 세어 확인 문구에 담는다.
  const [edited, mappings, editedMappings] = await Promise.all([
    auth.admin.from("rfp_requirements").select("id", { count: "exact", head: true }).eq("project_id", id).not("updated_by", "is", null),
    auth.admin.from("rfp_requirement_mappings").select("id", { count: "exact", head: true }).eq("project_id", id),
    auth.admin.from("rfp_requirement_mappings").select("id", { count: "exact", head: true }).eq("project_id", id).eq("edited", true),
  ]);
  const countError = edited.error ?? mappings.error ?? editedMappings.error;
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  const editedCount = edited.count ?? 0;
  const mappingCount = mappings.count ?? 0;
  const editedMappingCount = editedMappings.count ?? 0;
  if ((editedCount > 0 || mappingCount > 0) && body.confirm !== true) {
    return NextResponse.json({ needsConfirm: true, editedCount, mappingCount, editedMappingCount }, { status: 409 });
  }
  // 상태 갱신이 실패하면 화면은 ready로 보이는데 백그라운드가 표를 갈아치운다 — 반드시 검사한다.
  const { error: upError } = await auth.admin.from("rfp_projects").update({ status: "extracting", error: null, updated_by: auth.userId }).eq("id", id);
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });
  const admin = auth.admin;
  after(async () => {
    await runExtraction(admin, id);
  });
  return NextResponse.json({ status: "extracting" }, { status: 202 });
}
