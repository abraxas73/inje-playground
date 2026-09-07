import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { confluenceConfig, ConfluenceUrlError, parseConfluencePageId } from "@/lib/rfp/catalog/confluence";

export const runtime = "nodejs";
type Params = { params: Promise<{ code: string }> };

/** 한 번에 등록할 수 있는 최대 개수(Confluence 검색 상한과 맞춘다) */
const BULK_MAX = 50;

export interface BulkSourceResult {
  registered: number;
  skipped: number;
  failed: { url: string; error: string }[];
}

/**
 * POST /api/admin/rfp-catalog/solutions/[code]/sources/bulk {urls: string[]} → 200 {registered, skipped, failed}
 * Confluence 검색 결과를 한꺼번에 소스로 등록한다(5단계). 이미 등록된 페이지는 건너뛰고, 가져오기는 하지 않는다
 * (등록 후 화면이 "가져오기(규칙)"를 부른다). xlsx 링크는 Graph 토큰이 필요해 여기서 받지 않는다 — 단건 등록을 쓴다.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const body = (await request.json().catch(() => null)) as { urls?: unknown } | null;
  const urls = Array.isArray(body?.urls) ? body.urls.filter((u): u is string => typeof u === "string" && u.trim() !== "").map((u) => u.trim()) : [];
  if (!urls.length) return NextResponse.json({ error: "urls가 필요합니다." }, { status: 400 });
  if (urls.length > BULK_MAX) return NextResponse.json({ error: `한 번에 ${BULK_MAX}개까지 등록할 수 있습니다.` }, { status: 400 });

  const cfg = confluenceConfig();
  if (!cfg) return NextResponse.json({ error: "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다." }, { status: 400 });

  const { data: sol } = await a.admin.from("rfp_solutions").select("code").eq("code", code).maybeSingle();
  if (!sol) return NextResponse.json({ error: "솔루션이 없습니다." }, { status: 404 });

  const { data: existing, error: exError } = await a.admin.from("rfp_solution_sources").select("page_id").eq("solution_code", code);
  if (exError) return NextResponse.json({ error: exError.message }, { status: 500 });
  const already = new Set(((existing ?? []) as { page_id: string }[]).map((r) => r.page_id));

  const out: BulkSourceResult = { registered: 0, skipped: 0, failed: [] };
  const rows: { solution_code: string; kind: "confluence"; url: string; page_id: string; created_by: string }[] = [];
  for (const url of urls) {
    let pageId: string;
    try {
      pageId = parseConfluencePageId(url, cfg.host);
    } catch (e) {
      out.failed.push({ url, error: e instanceof ConfluenceUrlError ? e.message : "URL을 해석할 수 없습니다." });
      continue;
    }
    if (already.has(pageId)) {
      out.skipped += 1;
      continue;
    }
    already.add(pageId);
    rows.push({ solution_code: code, kind: "confluence", url, page_id: pageId, created_by: auth.userId });
  }

  if (rows.length) {
    const { error } = await a.admin.from("rfp_solution_sources").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    out.registered = rows.length;
  }
  return NextResponse.json(out);
}
