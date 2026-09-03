import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { PROJECT_COLUMNS, toRequirementRow, type ProjectDbRow, type RequirementDbRow } from "@/lib/rfp/mappers";
import { buildWorkbook, xlsxFileName } from "@/lib/rfp/xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/rfp/projects/[id]/xlsx — 샘플과 같은 시트 구성의 엑셀 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: project } = await auth.admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const p = project as ProjectDbRow;
  const { data: reqs, error } = await auth.admin.from("rfp_requirements").select("*").eq("project_id", id).order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const xlsxProject = { name: p.name, agency: p.agency, period: p.period, budget: p.budget, bidMethod: p.bid_method, extra: p.extra ?? {} };
  const buf = await buildWorkbook(xlsxProject, ((reqs ?? []) as RequirementDbRow[]).map(toRequirementRow));
  const fileName = xlsxFileName(xlsxProject);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="requirements.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
