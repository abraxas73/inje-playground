import { after, NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { bad, caller, canSee, loadJob, settleStale } from "@/lib/proposal/api";
import { cleanName, isOwnUploadPath, JOB_COLUMNS, latestProfile, PROPOSAL_MODES, type JobRow, type ProfileRow, type ProposalMode } from "@/lib/proposal/core";
import { runProposalJob } from "@/lib/proposal/run";

export const runtime = "nodejs";
export const maxDuration = 800;

/** GET ?scope=mine|shared — 내 결과 / 공유된 결과(누구 것이든 share_enabled) */
export async function GET(request: NextRequest) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const shared = request.nextUrl.searchParams.get("scope") === "shared";
  let q = auth.admin.from("proposal_jobs").select(JOB_COLUMNS).order("created_at", { ascending: false }).limit(200);
  q = shared ? q.eq("share_enabled", true) : q.eq("owner_id", auth.userId);
  const { data, error } = await q;
  if (error) return bad("목록을 불러오지 못했습니다.", 500);
  return NextResponse.json({ items: ((data ?? []) as JobRow[]).map((j) => settleStale(j)) });
}

/**
 * POST {projectName, mode, profileId?, templatePath+templateName | fromJobId} — 생성 요청. 201 {id} 뒤 after()에서 돈다.
 * fromJobId: 그 결과의 고객사 템플릿을 다시 써서(다른 방식·다른 버전으로) 새로 만든다.
 */
export async function POST(request: NextRequest) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const projectName = cleanName(b.projectName);
  if (!projectName) return bad("프로젝트명을 입력해 주세요(100자 이하).");
  const mode = (PROPOSAL_MODES as readonly unknown[]).includes(b.mode) ? (b.mode as ProposalMode) : null;
  if (!mode) return bad("적용 방식을 골라 주세요.");
  let template: { path: string; name: string };
  if (typeof b.fromJobId === "string") {
    const from = await loadJob(auth.admin, b.fromJobId);
    if (!from || !canSee(from, auth.userId)) return bad("다시 만들 결과를 찾을 수 없습니다.", 404);
    template = { path: from.template_path, name: from.template_name };
  } else {
    const name = cleanName(b.templateName, 200);
    if (!isOwnUploadPath(b.templatePath, "template") || !name) return bad("고객사 템플릿을 올려 주세요.");
    template = { path: b.templatePath, name };
  }
  const { data: profiles } = await auth.admin.from("proposal_profiles").select("id, hidden, created_at");
  const rows = (profiles ?? []) as Pick<ProfileRow, "id" | "hidden" | "created_at">[];
  const profile = typeof b.profileId === "string" ? rows.find((p) => p.id === b.profileId) : latestProfile(rows);
  if (!profile) return bad("일반현황 PPT가 없습니다. 먼저 일반현황 버전을 올려 주세요.");
  const { data, error } = await auth.admin.from("proposal_jobs").insert({
    owner_id: auth.userId, owner_name: auth.name, project_name: projectName, profile_id: profile.id,
    template_path: template.path, template_name: template.name, mode,
  }).select("id").single();
  if (error || !data) return bad("생성 요청을 저장하지 못했습니다.", 500);
  const id = data.id as string;
  after(() => runProposalJob(auth.admin, id));
  await logAudit(auth.admin, request, { userId: auth.userId, userEmail: auth.email, action: "일반현황 생성 요청", category: "proposal", detail: { mode } });
  return NextResponse.json({ id }, { status: 201 });
}
