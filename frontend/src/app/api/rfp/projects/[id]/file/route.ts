import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { RFP_BUCKET } from "@/lib/rfp/pipeline";

export const runtime = "nodejs";

/** GET /api/rfp/projects/[id]/file → {url} 최신 원본 파일의 서명 다운로드 URL(5분) */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { data: file } = await auth.admin
    .from("rfp_files")
    .select("storage_path, original_filename")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: "원본 파일이 없습니다." }, { status: 404 });
  const { data, error } = await auth.admin.storage.from(RFP_BUCKET).createSignedUrl(file.storage_path, 300, { download: file.original_filename });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "다운로드 URL 생성에 실패했습니다." }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
