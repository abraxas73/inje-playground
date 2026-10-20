import { NextRequest, NextResponse } from "next/server";
import { bad, caller, canSee, loadJob } from "@/lib/proposal/api";
import { PROPOSAL_BUCKET, resultFileName } from "@/lib/proposal/core";

/** GET — 결과 PPTX 내려받기(60초 서명 URL로 보낸다, 파일 이름은 프로젝트명_일반현황.pptx) */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const job = await loadJob(auth.admin, (await params).id);
  if (!job || !canSee(job, auth.userId) || job.status !== "done" || !job.result_path) return bad("내려받을 결과가 없습니다.", 404);
  const { data, error } = await auth.admin.storage.from(PROPOSAL_BUCKET).createSignedUrl(job.result_path, 60, { download: resultFileName(job.project_name) });
  if (error || !data) return bad("내려받기 주소를 만들지 못했습니다.", 500);
  return NextResponse.redirect(data.signedUrl, 302);
}
