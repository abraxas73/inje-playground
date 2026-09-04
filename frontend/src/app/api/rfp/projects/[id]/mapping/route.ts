import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/rfp/require-user";
import { loadCatalog } from "@/lib/rfp/catalog/store";
import { buildCatalogPrompt } from "@/lib/rfp/mapping/prompt";
import { runMapping, type MappingMode } from "@/lib/rfp/mapping/run-job";
import { STALE_RUNNING_MS } from "@/lib/rfp/mapping/types";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow, type ProjectDbRow } from "@/lib/rfp/mappers";
import type { MappingResponse, RfpMapping } from "@/types/rfp";

export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ id: string }> };

const COLUMNS = "id, status, mapping_status, mapping_error, mapping_warnings, mapping_at, updated_at";
type Row = Pick<ProjectDbRow, "id" | "status" | "mapping_status" | "mapping_error" | "mapping_warnings" | "mapping_at" | "updated_at">;

async function loadMappings(admin: SupabaseClient, projectId: string): Promise<RfpMapping[]> {
  const { data, error } = await admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS).eq("project_id", projectId).order("sort_order");
  if (error) throw new Error(error.message);
  return ((data ?? []) as MappingDbRow[]).map(mapMapping);
}

/** GET /api/rfp/projects/[id]/mapping — 매핑 행 + 상태(실행이 끝난 뒤 행만 다시 받을 때) */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data, error } = await auth.admin.from("rfp_projects").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const row = data as Row;
  try {
    const res: MappingResponse = {
      mappingStatus: row.mapping_status, mappingError: row.mapping_error,
      mappingWarnings: Array.isArray(row.mapping_warnings) ? (row.mapping_warnings as string[]) : [],
      mappingAt: row.mapping_at, mappings: await loadMappings(auth.admin, id),
    };
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "매핑을 불러오지 못했습니다." }, { status: 500 });
  }
}

/**
 * POST /api/rfp/projects/[id]/mapping {mode?: "all"|"missing", confirm?: boolean}  (스펙 §4.3)
 * 400(추출 미완·키 없음·카탈로그 비어 있음) / 409 {running} / 409 {needsConfirm, editedRequirements} / 202 {started, mode}
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { mode?: unknown; confirm?: unknown };
  const mode: MappingMode = body.mode === "missing" ? "missing" : "all";

  const { data, error } = await auth.admin.from("rfp_projects").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const row = data as Row;
  if (row.status !== "ready") return NextResponse.json({ error: "요구사항 추출이 끝난 뒤 매핑할 수 있습니다." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }, { status: 400 });
  if (row.mapping_status === "running" && Date.now() - Date.parse(row.updated_at) <= STALE_RUNNING_MS) {
    return NextResponse.json({ running: true, error: "이미 매핑 중입니다." }, { status: 409 });
  }

  let catalogEmpty: boolean;
  try {
    catalogEmpty = buildCatalogPrompt(await loadCatalog(auth.admin, { activeSolutionsOnly: true })).aliases.features.size === 0;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "카탈로그를 불러오지 못했습니다." }, { status: 500 });
  }
  if (catalogEmpty) return NextResponse.json({ error: "카탈로그가 비어 있습니다. 관리자에게 문의하세요." }, { status: 400 });

  if (mode === "all") {
    const { data: edited, error: editedError } = await auth.admin.from("rfp_requirement_mappings").select("requirement_id").eq("project_id", id).eq("edited", true);
    if (editedError) return NextResponse.json({ error: editedError.message }, { status: 500 });
    const n = new Set(((edited ?? []) as { requirement_id: string }[]).map((m) => m.requirement_id)).size;
    if (n > 0 && body.confirm !== true) return NextResponse.json({ needsConfirm: true, editedRequirements: n }, { status: 409 });
  }

  const { error: upError } = await auth.admin.from("rfp_projects").update({ mapping_status: "running", mapping_error: null, updated_by: auth.userId }).eq("id", id);
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });
  const admin = auth.admin;
  after(async () => {
    await runMapping(admin, id, mode);
  });
  return NextResponse.json({ started: true, mode }, { status: 202 });
}
