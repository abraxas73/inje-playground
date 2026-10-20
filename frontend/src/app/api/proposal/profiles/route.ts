import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { bad, caller } from "@/lib/proposal/api";
import { cleanName, isOwnUploadPath, PROFILE_COLUMNS, PROPOSAL_BUCKET } from "@/lib/proposal/core";
import { createProposalService } from "@/lib/proposal/run";

export const runtime = "nodejs";
export const maxDuration = 120;

/** GET — 일반현황 버전 목록(최신 순, 숨긴 것 포함 — 화면이 나눠 보여 준다) */
export async function GET() {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.admin.from("proposal_profiles").select(PROFILE_COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (error) return bad("목록을 불러오지 못했습니다.", 500);
  return NextResponse.json({ items: data ?? [] });
}

/** POST {storagePath, fileName, title, asOf?} — 올린 파일을 서비스로 열어 장 수를 확인한 뒤 새 버전으로 등록(최신이 된다) */
export async function POST(request: NextRequest) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = cleanName(b.title);
  const fileName = cleanName(b.fileName, 200);
  const asOf = typeof b.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.asOf) ? b.asOf : null;
  if (!isOwnUploadPath(b.storagePath, "profile") || !title || !fileName) return bad("제목과 파일이 필요합니다.");
  const signed = await auth.admin.storage.from(PROPOSAL_BUCKET).createSignedUrl(b.storagePath, 600);
  if (signed.error || !signed.data) return bad("올린 파일을 찾을 수 없습니다. 다시 올려 주세요.");
  let slides: number;
  try {
    slides = (await createProposalService().outline({ profileUrl: signed.data.signedUrl })).profile?.length ?? 0;
  } catch (e) {
    await auth.admin.storage.from(PROPOSAL_BUCKET).remove([b.storagePath]);
    return bad(e instanceof Error ? e.message : "PPT를 열 수 없습니다.", 422);
  }
  if (slides < 1 || slides > 80) return bad("일반현황 PPT는 1~80장이어야 합니다.", 422);
  const { data, error } = await auth.admin.from("proposal_profiles")
    .insert({ title, as_of: asOf, storage_path: b.storagePath, file_name: fileName, slide_count: slides, uploaded_by: auth.userId, uploader_name: auth.name })
    .select(PROFILE_COLUMNS).single();
  if (error || !data) return bad("등록하지 못했습니다.", 500);
  await logAudit(auth.admin, request, { userId: auth.userId, userEmail: auth.email, action: "일반현황 PPT 등록", category: "proposal", detail: { slides } });
  return NextResponse.json({ item: data }, { status: 201 });
}
