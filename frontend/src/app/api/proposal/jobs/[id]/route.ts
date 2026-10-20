import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { bad, caller, canSee, loadJob, settleStale } from "@/lib/proposal/api";
import { PROPOSAL_BUCKET } from "@/lib/proposal/core";

type Ctx = { params: Promise<{ id: string }> };

/** GET — 결과 상세(본인 것 또는 공유된 것) */
export async function GET(_: NextRequest, { params }: Ctx) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const job = await loadJob(auth.admin, (await params).id);
  if (!job || !canSee(job, auth.userId)) return bad("결과를 찾을 수 없습니다.", 404);
  const { data: profile } = await auth.admin.from("proposal_profiles").select("id, title, as_of").eq("id", job.profile_id).maybeSingle();
  const { template_path: _t, result_path, ...rest } = job;
  return NextResponse.json({ item: { ...settleStale(rest), hasFile: !!result_path, mine: job.owner_id === auth.userId, profile } });
}

/** PATCH {shareEnabled} — 공유 켜기·끄기(본인만) */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const job = await loadJob(auth.admin, (await params).id);
  const b = (await request.json().catch(() => ({}))) as { shareEnabled?: unknown };
  if (!job || job.owner_id !== auth.userId) return bad("본인 결과만 바꿀 수 있습니다.", 404);
  if (typeof b.shareEnabled !== "boolean") return bad("shareEnabled가 필요합니다.");
  const { error } = await auth.admin.from("proposal_jobs").update({ share_enabled: b.shareEnabled }).eq("id", job.id);
  if (error) return bad("저장하지 못했습니다.", 500);
  await logAudit(auth.admin, request, { userId: auth.userId, userEmail: auth.email, action: b.shareEnabled ? "일반현황 결과 공유" : "일반현황 결과 공유 해제", category: "proposal", detail: {} });
  return NextResponse.json({ ok: true });
}

/** DELETE — 본인 결과 삭제(결과 파일도). 고객사 템플릿은 다른 결과가 다시 만들기에 쓸 수 있어 남은 참조가 없을 때만 지운다 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const job = await loadJob(auth.admin, (await params).id);
  if (!job || job.owner_id !== auth.userId) return bad("본인 결과만 지울 수 있습니다.", 404);
  if (job.status === "running" || job.status === "queued") return bad("만드는 중에는 지울 수 없습니다.", 409);
  const { error } = await auth.admin.from("proposal_jobs").delete().eq("id", job.id);
  if (error) return bad("지우지 못했습니다.", 500);
  const { count } = await auth.admin.from("proposal_jobs").select("id", { count: "exact", head: true }).eq("template_path", job.template_path);
  const remove = [job.result_path, count ? null : job.template_path].filter((p): p is string => !!p);
  if (remove.length) await auth.admin.storage.from(PROPOSAL_BUCKET).remove(remove);
  await logAudit(auth.admin, request, { userId: auth.userId, userEmail: auth.email, action: "일반현황 결과 삭제", category: "proposal", detail: {} });
  return NextResponse.json({ ok: true });
}
