import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { confluenceConfig, ConfluenceFetchError } from "@/lib/rfp/catalog/confluence";
import { searchConfluencePages, SEARCH_LIMIT_DEFAULT } from "@/lib/rfp/catalog/confluence-search";

export const runtime = "nodejs";

/** GET /api/admin/rfp-catalog/confluence-search?q=&limit= → {results: ConfluenceSearchHit[]} (4단계 §4.6). admin. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const cfg = confluenceConfig();
  if (!cfg) return NextResponse.json({ error: "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다." }, { status: 400 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 100) return NextResponse.json({ error: "검색어는 2~100자입니다." }, { status: 400 });
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? SEARCH_LIMIT_DEFAULT);
  const limit = Number.isFinite(limitRaw) ? limitRaw : SEARCH_LIMIT_DEFAULT;
  try {
    return NextResponse.json({ results: await searchConfluencePages(cfg, q, limit) });
  } catch (e) {
    if (e instanceof ConfluenceFetchError) return NextResponse.json({ error: e.message }, { status: 502 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "검색에 실패했습니다." }, { status: 500 });
  }
}
