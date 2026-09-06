import { NextRequest, NextResponse, after } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOURCE_COLUMNS, mapSource, type SourceDbRow } from "@/lib/rfp/catalog/store";
import { confluenceConfig } from "@/lib/rfp/catalog/confluence";
import { runImport } from "@/lib/rfp/catalog/import-job";
import { isEngineKind, STALE_RUNNING_MS, type EngineKind } from "@/lib/rfp/mapping/types";
import { graphTokenForRoute } from "@/lib/ms/route-token";

export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ code: string }> };

function isRunning(s: SourceDbRow): boolean {
  return s.import_status === "running" && Date.now() - Date.parse(s.updated_at) <= STALE_RUNNING_MS;
}

/** GET /api/admin/rfp-catalog/solutions/[code]/import — {running, sources} 폴링용 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const { data, error } = await a.admin.from("rfp_solution_sources").select(SOURCE_COLUMNS).eq("solution_code", code).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as SourceDbRow[];
  return NextResponse.json({ running: rows.some(isRunning), sources: rows.map(mapSource) });
}

/**
 * POST /api/admin/rfp-catalog/solutions/[code]/import {sourceIds?: string[], engine?: "rules"|"llm"} (4단계 §6.1)
 * 400(engine 값·env·키·소스 없음) / 409(6분 이내 running) / 202 {started, sourceIds, engine} + after(runImport).
 * confluence 소스가 있으면 ATLASSIAN_*, llm이면 ANTHROPIC_API_KEY, xlsx 소스가 있으면 세션 사용자의 Graph 토큰이 필요하다.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  const body = (await request.json().catch(() => ({}))) as { sourceIds?: unknown; engine?: unknown };
  const engineRaw = body.engine ?? "rules";
  if (!isEngineKind(engineRaw)) return NextResponse.json({ error: "engine은 rules 또는 llm입니다." }, { status: 400 });
  const engine: EngineKind = engineRaw;
  const wanted = Array.isArray(body.sourceIds) ? body.sourceIds.filter((s): s is string => typeof s === "string") : null;

  const { data, error } = await a.admin.from("rfp_solution_sources").select(SOURCE_COLUMNS).eq("solution_code", code).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const all = (data ?? []) as SourceDbRow[];
  const targets = wanted ? all.filter((s) => wanted.includes(s.id)) : all;
  if (!targets.length) return NextResponse.json({ error: "등록된 소스가 없습니다. Confluence 페이지 URL이나 SharePoint xlsx 링크를 먼저 추가하세요." }, { status: 400 });
  const needsConfluence = targets.some((s) => s.kind === "confluence");
  const needsXlsx = targets.some((s) => s.kind === "xlsx");
  if (needsConfluence && !confluenceConfig()) return NextResponse.json({ error: "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다." }, { status: 400 });
  if (engine === "llm" && needsConfluence && !process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, { status: 400 });
  if (targets.some(isRunning)) return NextResponse.json({ error: "이미 가져오는 중입니다. 잠시 뒤 다시 시도하세요." }, { status: 409 });

  let graphToken: string | undefined;
  if (needsXlsx) {
    const tok = await graphTokenForRoute(a.admin, auth.userId);
    if (!tok.ok) return tok.response;
    graphToken = tok.token;
  }

  const ids = targets.map((s) => s.id);
  const { error: upError } = await a.admin.from("rfp_solution_sources").update({ import_status: "running", error: null, note: null }).in("id", ids);
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });
  const admin = a.admin;
  after(async () => {
    await runImport(admin, code, ids, { engine, graphToken });
  });
  return NextResponse.json({ started: true, sourceIds: ids, engine }, { status: 202 });
}
