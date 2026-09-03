import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { creatorNames } from "@/lib/rfp/creators";
import { PROJECT_COLUMNS, mapProjectDetail, mapRequirement, type FileDbRow, type ProjectDbRow, type RequirementDbRow } from "@/lib/rfp/mappers";
import { normalizeAgency, normalizeName } from "@/lib/rfp/overview";
import { sortRequirements } from "@/lib/rfp/requirements";
import { RFP_BUCKET } from "@/lib/rfp/pipeline";
import type { StatusResponse } from "@/types/rfp";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/rfp/projects/[id] — 상세. ?fields=status면 상태만(폴링용). */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });
  const { data: project, error } = await auth.admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const row = project as ProjectDbRow;

  if (request.nextUrl.searchParams.get("fields") === "status") {
    const res: StatusResponse = { status: row.status, error: row.error, requirementCount: row.requirement_count, extractionMethod: row.extraction_method, updatedAt: row.updated_at };
    return NextResponse.json(res);
  }

  const [filesRes, reqsRes, names] = await Promise.all([
    auth.admin.from("rfp_files").select("id, original_filename, format, size_bytes, created_at").eq("project_id", id).order("created_at", { ascending: false }),
    auth.admin.from("rfp_requirements").select("*").eq("project_id", id).order("sort_order", { ascending: true }),
    creatorNames(auth.admin, [row.created_by]),
  ]);
  if (filesRes.error) return NextResponse.json({ error: filesRes.error.message }, { status: 500 });
  if (reqsRes.error) return NextResponse.json({ error: reqsRes.error.message }, { status: 500 });
  // 요구사항은 프로젝트당 수백 건이라 Supabase 1000행 상한에 걸리지 않는다. 넘길 가능성이 생기면 selectAll(lib/work-metrics/common.ts)로 바꾼다.
  const requirements = sortRequirements(((reqsRes.data ?? []) as RequirementDbRow[]).map(mapRequirement));
  return NextResponse.json(mapProjectDetail(row, names.get(row.created_by) ?? null, (filesRes.data ?? []) as FileDbRow[], requirements));
}

/** PATCH /api/rfp/projects/[id] {name?, agency?, period?, budget?, bidMethod?} — 개요 편집 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "본문이 필요합니다." }, { status: 400 });
  const pick = (k: string): string | null | undefined => {
    if (!(k in body)) return undefined;
    const v = body[k];
    if (v === null) return null;
    if (typeof v !== "string") throw new Error(`${k}는 문자열이어야 합니다.`);
    if (v.length > 500) throw new Error(`${k}는 500자 이하여야 합니다.`);
    return v.trim();
  };
  let patch: Record<string, unknown>;
  try {
    const name = pick("name");
    const agency = pick("agency");
    patch = {
      ...(name !== undefined && { name, name_norm: normalizeName(name ?? "") }),
      ...(agency !== undefined && { agency, agency_norm: agency ? normalizeAgency(agency) : null }),
      ...(pick("period") !== undefined && { period: pick("period") }),
      ...(pick("budget") !== undefined && { budget: pick("budget") }),
      ...(pick("bidMethod") !== undefined && { bid_method: pick("bidMethod") }),
      updated_by: auth.userId,
    };
    if (name !== undefined && !name) throw new Error("사업명은 비울 수 없습니다.");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "잘못된 요청" }, { status: 400 });
  }
  const { data, error } = await auth.admin.from("rfp_projects").update(patch).eq("id", id).select(PROJECT_COLUMNS).maybeSingle();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "같은 사업명·발주기관의 프로젝트가 이미 있습니다." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  const row = data as ProjectDbRow;
  return NextResponse.json({ id: row.id, name: row.name, agency: row.agency, period: row.period, budget: row.budget, bidMethod: row.bid_method, updatedAt: row.updated_at });
}

/** DELETE /api/rfp/projects/[id] — 등록자 또는 admin. 파일·요구사항 함께 삭제. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: project } = await auth.admin.from("rfp_projects").select("id, created_by").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  if (auth.role !== "admin" && project.created_by !== auth.userId) {
    return NextResponse.json({ error: "등록자 또는 관리자만 삭제할 수 있습니다." }, { status: 403 });
  }
  const { data: files } = await auth.admin.from("rfp_files").select("storage_path").eq("project_id", id);
  const paths = (files ?? []).map((f) => f.storage_path as string);
  if (paths.length) await auth.admin.storage.from(RFP_BUCKET).remove(paths);
  const { error } = await auth.admin.from("rfp_projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
