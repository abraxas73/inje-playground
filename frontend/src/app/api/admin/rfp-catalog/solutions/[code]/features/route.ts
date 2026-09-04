import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { FEATURE_COLUMNS, mapAdminFeature, type FeatureDbRow } from "@/lib/rfp/catalog/store";
import { FEATURE_NAME_MAX, normalizeFeatureName } from "@/lib/rfp/catalog/merge-features";
import { selectAll } from "@/lib/work-metrics/common";

export const runtime = "nodejs";
type Params = { params: Promise<{ code: string }> };

/** GET /api/admin/rfp-catalog/solutions/[code]/features — 매핑 참조 수 포함(매핑은 프로젝트가 늘면 1000행을 넘을 수 있어 selectAll) */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const [feats, maps] = await Promise.all([
    a.admin.from("rfp_solution_features").select(FEATURE_COLUMNS).eq("solution_code", code).order("sort_order").order("name"),
    selectAll<{ feature_id: string | null }>(() => a.admin.from("rfp_requirement_mappings").select("feature_id", { count: "exact" }).eq("solution_code", code)),
  ]);
  if (feats.error) return NextResponse.json({ error: feats.error.message }, { status: 500 });
  if (maps.error) return NextResponse.json({ error: maps.error.message }, { status: 500 });
  const counts = new Map<string, number>();
  for (const m of maps.data) if (m.feature_id) counts.set(m.feature_id, (counts.get(m.feature_id) ?? 0) + 1);
  return NextResponse.json({ features: ((feats.data ?? []) as FeatureDbRow[]).map((f) => mapAdminFeature(f, counts.get(f.id) ?? 0)) });
}

/** POST /api/admin/rfp-catalog/solutions/[code]/features {name, description?, evidenceUrl?} → edited=true, 201 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as { name?: unknown; description?: unknown; evidenceUrl?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const evidenceUrl = typeof body?.evidenceUrl === "string" && body.evidenceUrl.trim() ? body.evidenceUrl.trim() : null;
  if (!name || name.length > FEATURE_NAME_MAX) return NextResponse.json({ error: `기능 이름은 1~${FEATURE_NAME_MAX}자입니다.` }, { status: 400 });
  if (description.length > 4000) return NextResponse.json({ error: "설명은 4000자 이하입니다." }, { status: 400 });
  if (evidenceUrl && evidenceUrl.length > 2000) return NextResponse.json({ error: "근거 URL이 너무 깁니다." }, { status: 400 });
  const { data: sol } = await a.admin.from("rfp_solutions").select("code").eq("code", code).maybeSingle();
  if (!sol) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });
  const { data: last } = await a.admin.from("rfp_solution_features").select("sort_order").eq("solution_code", code).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await a.admin
    .from("rfp_solution_features")
    .insert({
      solution_code: code, name, name_norm: normalizeFeatureName(name), description, evidence_url: evidenceUrl,
      edited: true, sort_order: ((last?.sort_order as number | undefined) ?? 0) + 1, updated_by: auth.userId,
    })
    .select(FEATURE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 이름의 기능이 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(mapAdminFeature(data as FeatureDbRow, 0), { status: 201 });
}
