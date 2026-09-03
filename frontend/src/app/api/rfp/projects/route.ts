import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { registerProject, runExtraction } from "@/lib/rfp/pipeline";
import { creatorNames } from "@/lib/rfp/creators";
import { PROJECT_COLUMNS, mapProjectSummary, type ProjectDbRow } from "@/lib/rfp/mappers";
import type { RegisterResponse } from "@/types/rfp";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET /api/rfp/projects?q= — 사업명·발주기관 검색(JS 필터, 프로젝트는 수백 건 이하) */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const { data, error } = await auth.admin.from("rfp_projects").select(PROJECT_COLUMNS).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as ProjectDbRow[];
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.agency ?? "").toLowerCase().includes(q)) : rows;
  const names = await creatorNames(auth.admin, filtered.map((r) => r.created_by));
  return NextResponse.json({ projects: filtered.map((r) => mapProjectSummary(r, names.get(r.created_by) ?? null)) });
}

/**
 * POST /api/rfp/projects {storagePath, fileName, sizeBytes, force?}
 * 200 {duplicate} | 200 {needsConfirm, candidates, overview} | 201 {created, projectId}. 등록되면 after()로 추출 실행.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // 서버가 파일 바이트로 sha256을 계산하므로 클라이언트 값은 쓰지 않는다(본문에 있어도 무시).
  const body = (await request.json().catch(() => null)) as
    | { storagePath?: string; fileName?: string; sizeBytes?: number; force?: boolean }
    | null;
  const storagePath = body?.storagePath ?? "";
  const fileName = body?.fileName?.trim() ?? "";
  const sizeBytes = Number(body?.sizeBytes);
  if (!storagePath.startsWith("uploads/") || !fileName || !Number.isFinite(sizeBytes)) {
    return NextResponse.json({ error: "storagePath, fileName, sizeBytes가 필요합니다." }, { status: 400 });
  }

  const result = await registerProject(auth.admin, { storagePath, fileName, sizeBytes, force: body?.force === true, userId: auth.userId });
  if (result.kind === "error") return NextResponse.json({ error: result.message }, { status: result.status });
  if (result.kind === "duplicate") {
    const res: RegisterResponse = { duplicate: true, projectId: result.projectId };
    return NextResponse.json(res);
  }
  if (result.kind === "needsConfirm") {
    const res: RegisterResponse = {
      needsConfirm: true,
      candidates: result.candidates.map((c) => ({ id: c.id, name: c.name, agency: c.agency, createdAt: c.createdAt })),
      overview: { name: result.overview.name, agency: result.overview.agency },
    };
    return NextResponse.json(res);
  }
  const admin = auth.admin;
  const projectId = result.projectId;
  after(async () => {
    await runExtraction(admin, projectId);
  });
  const res: RegisterResponse = { created: true, projectId };
  return NextResponse.json(res, { status: 201 });
}
