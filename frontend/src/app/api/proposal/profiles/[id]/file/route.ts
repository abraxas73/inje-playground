import { NextRequest, NextResponse } from "next/server";
import { bad, caller } from "@/lib/proposal/api";
import { PROPOSAL_BUCKET } from "@/lib/proposal/core";

/** GET — 일반현황 PPT 원본 내려받기(60초 서명 URL, 올릴 때의 파일 이름) */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return bad("없는 버전입니다.", 404);
  const { data: row } = await auth.admin.from("proposal_profiles").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (!row) return bad("없는 버전입니다.", 404);
  const { data, error } = await auth.admin.storage.from(PROPOSAL_BUCKET).createSignedUrl(row.storage_path, 60, { download: row.file_name });
  if (error || !data) return bad("내려받기 주소를 만들지 못했습니다.", 500);
  return NextResponse.redirect(data.signedUrl, 302);
}
