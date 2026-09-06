import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOURCE_COLUMNS, mapSource, type SourceDbRow } from "@/lib/rfp/catalog/store";
import { confluenceConfig, ConfluenceUrlError, parseConfluencePageId } from "@/lib/rfp/catalog/confluence";
import { detectSourceKind } from "@/lib/rfp/catalog/source-kind";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { FolderResolveError, GraphError, resolveItem } from "@/lib/ms/graph-drive";

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

const ATLASSIAN_ENV_MISSING = "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다.";

/**
 * POST /api/admin/rfp-catalog/solutions/[code]/sources {url} → 201 (4단계 §4.1·§4.3)
 * 호스트로 종류를 판별한다. confluence: 페이지 id만 뽑는다(2단계). xlsx: 세션 사용자의 Graph 토큰으로 파일 링크를 해석해 drive_id·item id·파일명을 저장한다.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2000) return NextResponse.json({ error: "url이 필요합니다." }, { status: 400 });

  const cfg = confluenceConfig();
  const kind = detectSourceKind(url, cfg?.host ?? null);
  if (!kind) {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* 형식 오류 */ }
    if (!cfg && host.endsWith(".atlassian.net")) return NextResponse.json({ error: ATLASSIAN_ENV_MISSING }, { status: 400 });
    return NextResponse.json({ error: "Confluence 페이지 URL 또는 SharePoint 파일 링크만 등록할 수 있습니다." }, { status: 400 });
  }
  const { data: sol } = await a.admin.from("rfp_solutions").select("code").eq("code", code).maybeSingle();
  if (!sol) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });

  let row: Record<string, unknown>;
  if (kind === "confluence") {
    let pageId: string;
    try {
      pageId = parseConfluencePageId(url, cfg!.host);
    } catch (e) {
      if (e instanceof ConfluenceUrlError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
    row = { solution_code: code, kind, url, page_id: pageId, created_by: auth.userId };
  } else {
    const tok = await graphTokenForRoute(a.admin, auth.userId);
    if (!tok.ok) return tok.response;
    try {
      const item = await resolveItem(tok.token, url);
      row = { solution_code: code, kind, url, page_id: item.itemId, drive_id: item.driveId, title: item.name, created_by: auth.userId };
    } catch (e) {
      if (e instanceof FolderResolveError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof GraphError) {
        console.error(`[rfp] xlsx 소스 해석 실패 ${e.code} (${e.status}) request-id=${e.requestId ?? "-"}`);
        return NextResponse.json({ error: `SharePoint 응답 오류(${e.status})` }, { status: 502 });
      }
      throw e;
    }
  }

  const { data, error } = await a.admin.from("rfp_solution_sources").insert(row).select(SOURCE_COLUMNS).single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: kind === "xlsx" ? "같은 파일이 이미 등록돼 있습니다." : "같은 페이지가 이미 등록돼 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(mapSource(data as SourceDbRow), { status: 201 });
}
