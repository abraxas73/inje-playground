import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { PROJECT_COLUMNS, type ProjectDbRow } from "@/lib/rfp/mappers";
import { buildProjectWorkbook } from "@/lib/rfp/sharepoint";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/rfp/projects/[id]/xlsx — 샘플과 같은 시트 구성의 엑셀. SharePoint 업로드(3단계)와 같은 buildProjectWorkbook을 쓴다. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: project, error } = await auth.admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });

  let built: { buffer: Buffer; fileName: string };
  try {
    built = await buildProjectWorkbook(auth.admin, project as ProjectDbRow);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "엑셀을 만들지 못했습니다." }, { status: 500 });
  }
  return new NextResponse(new Uint8Array(built.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="requirements.xlsx"; filename*=UTF-8''${encodeURIComponent(built.fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
