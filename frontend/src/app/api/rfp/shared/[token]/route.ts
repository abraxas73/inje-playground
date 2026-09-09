import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { isShareToken, recordShareView, resolveShareToken, toSharedProject } from "@/lib/rfp/share";
import { MAPPING_COLUMNS, PROJECT_COLUMNS, mapMapping, mapRequirement, type MappingDbRow, type ProjectDbRow, type RequirementDbRow } from "@/lib/rfp/mappers";
import { selectAll } from "@/lib/work-metrics/common";
import type { RfpRequirement, SharedProject } from "@/types/rfp";

export const runtime = "nodejs";
type Params = { params: Promise<{ token: string }> };

/**
 * GET /api/rfp/shared/[token] — 공유 링크 열람(읽기 전용).
 *
 * **인증을 요구하지 않는 유일한 RFP 라우트다.** 대신
 * - 토큰 형식을 먼저 검사하고, 없는 토큰은 404(존재 여부만 알려 준다),
 * - `private` 링크는 로그인 세션이 있어야 통과한다(없으면 401 {code:"login_required"}),
 * - 응답에서 파일·SharePoint·소유자 정보를 뺀다. 공개 링크는 근거 URL·비고까지 감춘다(`toSharedProject`).
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { token } = await params;
  if (!isShareToken(token)) return NextResponse.json({ error: "링크가 올바르지 않습니다." }, { status: 404 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "서버 설정이 완료되지 않았습니다." }, { status: 500 });
  }

  const link = await resolveShareToken(admin, token).catch(() => null);
  if (!link) return NextResponse.json({ error: "링크가 만료되었거나 폐기되었습니다." }, { status: 404 });

  if (link.visibility === "private") {
    const supabase = await createServerSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      return NextResponse.json({ error: "사내 계정으로 로그인한 뒤 볼 수 있는 링크입니다.", code: "login_required" }, { status: 401 });
    }
  }

  const { data: projectRow, error } = await admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", link.projectId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!projectRow) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const p = projectRow as ProjectDbRow;

  // 1000행 상한을 넘는 프로젝트도 온전히 보여야 하므로 페이지네이션으로 읽는다
  const [reqRes, mapRes, catalog] = await Promise.all([
    selectAll<RequirementDbRow>(() =>
      admin.from("rfp_requirements").select("*").eq("project_id", link.projectId).order("sort_order"),
    ),
    selectAll<MappingDbRow>(() =>
      admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("project_id", link.projectId).order("sort_order"),
    ),
    loadCatalog(admin, { activeSolutionsOnly: false }).catch(() => []),
  ]);
  if (reqRes.error) return NextResponse.json({ error: reqRes.error.message }, { status: 500 });
  if (mapRes.error) return NextResponse.json({ error: mapRes.error.message }, { status: 500 });

  const requirements: RfpRequirement[] = reqRes.data.map((r) => mapRequirement(r as unknown as RequirementDbRow));
  const body: SharedProject = toSharedProject(
    {
      id: p.id, name: p.name, agency: p.agency, period: p.period, budget: p.budget, bidMethod: p.bid_method,
      extra: (p.extra ?? {}) as Record<string, string>, requirementCount: p.requirement_count,
      mappingAt: p.mapping_at, updatedAt: p.updated_at,
    },
    requirements,
    mapRes.data.map(mapMapping),
    catalog,
    link.visibility,
  );

  await recordShareView(admin, token);
  // 공유 페이지는 항상 최신 상태를 보여야 한다(캐시 금지)
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
