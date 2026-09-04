import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { MAPPING_COLUMNS, mapMapping, PROJECT_COLUMNS, toRequirementRow, type MappingDbRow, type ProjectDbRow, type RequirementDbRow } from "@/lib/rfp/mappers";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { buildWorkbook, xlsxFileName, type XlsxMapping } from "@/lib/rfp/xlsx";
import { selectAll } from "@/lib/work-metrics/common";

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

  let mapping: XlsxMapping | undefined;
  if (p.mapping_status !== "none") {
    let catalog;
    try {
      catalog = await loadCatalog(auth.admin);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "카탈로그를 불러오지 못했습니다." }, { status: 500 });
    }
    const mapsRes = await selectAll<MappingDbRow>(() =>
      auth.admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS, { count: "exact" }).eq("project_id", id).order("sort_order"),
    );
    if (mapsRes.error) return NextResponse.json({ error: mapsRes.error.message }, { status: 500 });
    mapping = { rows: mapsRes.data.map(mapMapping), catalog, mappingAt: p.mapping_at };
  }
  const xlsxProject = { name: p.name, agency: p.agency, period: p.period, budget: p.budget, bidMethod: p.bid_method, extra: p.extra ?? {} };
  const buf = await buildWorkbook(xlsxProject, ((reqs ?? []) as RequirementDbRow[]).map(toRequirementRow), mapping);
  const fileName = xlsxFileName(xlsxProject);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="requirements.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
