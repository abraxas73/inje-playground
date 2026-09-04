import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOURCE_COLUMNS, mapSource, type SourceDbRow } from "@/lib/rfp/catalog/store";
import { confluenceConfig, ConfluenceUrlError, parseConfluencePageId } from "@/lib/rfp/catalog/confluence";

export const runtime = "nodejs";
type Params = { params: Promise<{ code: string }> };

/** GET /api/admin/rfp-catalog/solutions/[code]/sources — 가져오기 폴링에도 쓴다 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const { data, error } = await a.admin.from("rfp_solution_sources").select(SOURCE_COLUMNS).eq("solution_code", code).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sources: ((data ?? []) as SourceDbRow[]).map(mapSource) });
}

/** POST /api/admin/rfp-catalog/solutions/[code]/sources {url} → 201. URL은 페이지 id만 뽑고 호스트를 검사한다(스펙 §3.2). */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const cfg = confluenceConfig();
  if (!cfg) return NextResponse.json({ error: "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다." }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2000) return NextResponse.json({ error: "url이 필요합니다." }, { status: 400 });
  let pageId: string;
  try {
    pageId = parseConfluencePageId(url, cfg.host);
  } catch (e) {
    if (e instanceof ConfluenceUrlError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const { data: sol } = await a.admin.from("rfp_solutions").select("code").eq("code", code).maybeSingle();
  if (!sol) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });
  const { data, error } = await a.admin
    .from("rfp_solution_sources")
    .insert({ solution_code: code, url, page_id: pageId, created_by: auth.userId })
    .select(SOURCE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 페이지가 이미 등록돼 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(mapSource(data as SourceDbRow), { status: 201 });
}
