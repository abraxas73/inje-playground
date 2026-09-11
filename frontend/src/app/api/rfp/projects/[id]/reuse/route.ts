import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadReusePool, suggestReuse } from "@/lib/rfp/mapping/reuse";
import { detailUnitMap } from "@/lib/rfp/mapping/detail-items";
import type { ReuseResponse } from "@/types/rfp";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/rfp/projects/[id]/reuse?requirementId=&detailKey= → {suggestions}
 * 다른 요구사항에서 사람이 확정한 매핑 중 이 단위의 문장과 비슷한 것. 확정 작업 화면이 단위를 보여줄 때 부른다.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const requirementId = request.nextUrl.searchParams.get("requirementId") ?? "";
  const detailKey = (request.nextUrl.searchParams.get("detailKey") ?? "").trim() || null;
  if (!requirementId) return NextResponse.json({ error: "requirementId가 필요합니다." }, { status: 400 });

  const { data: req, error } = await auth.admin.from("rfp_requirements").select("id, project_id, title, details").eq("id", requirementId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!req || req.project_id !== id) return NextResponse.json({ error: "요구사항이 없습니다." }, { status: 404 });
  const q = req as { id: string; title: string; details: string };
  const detailText = detailKey ? detailUnitMap(q.details).get(detailKey)?.text ?? null : null;

  try {
    const pool = await loadReusePool(auth.admin);
    const body: ReuseResponse = { suggestions: suggestReuse({ title: q.title, detailText, details: q.details, excludeRequirementId: q.id }, pool) };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "재사용 제안을 만들지 못했습니다." }, { status: 500 });
  }
}
