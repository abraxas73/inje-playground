import { NextRequest, NextResponse, after } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { SOURCE_COLUMNS, mapSource, type SourceDbRow } from "@/lib/rfp/catalog/store";
import { confluenceConfig } from "@/lib/rfp/catalog/confluence";
import { runImport } from "@/lib/rfp/catalog/import-job";
import { STALE_RUNNING_MS } from "@/lib/rfp/mapping/types";

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
 * POST /api/admin/rfp-catalog/solutions/[code]/import {sourceIds?: string[]}
 * 400(env·소스 없음) / 409(6분 이내 running) / 202 {started, sourceIds} + after(runImport)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const { code } = await params;
  if (!confluenceConfig()) return NextResponse.json({ error: "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { sourceIds?: unknown };
  const wanted = Array.isArray(body.sourceIds) ? body.sourceIds.filter((s): s is string => typeof s === "string") : null;

  const { data, error } = await a.admin.from("rfp_solution_sources").select(SOURCE_COLUMNS).eq("solution_code", code).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const all = (data ?? []) as SourceDbRow[];
  const targets = wanted ? all.filter((s) => wanted.includes(s.id)) : all;
  if (!targets.length) return NextResponse.json({ error: "등록된 소스가 없습니다. Confluence 페이지 URL을 먼저 추가하세요." }, { status: 400 });
  if (targets.some(isRunning)) return NextResponse.json({ error: "이미 가져오는 중입니다. 잠시 뒤 다시 시도하세요." }, { status: 409 });

  const ids = targets.map((s) => s.id);
  const { error: upError } = await a.admin.from("rfp_solution_sources").update({ import_status: "running", error: null, note: null }).in("id", ids);
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });
  const admin = a.admin;
  after(async () => {
    await runImport(admin, code, ids);
  });
  return NextResponse.json({ started: true, sourceIds: ids }, { status: 202 });
}
