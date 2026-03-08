import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

/** GET /api/guide/notebooks/[id]/sources/download?sourceId=X */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");

  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId 파라미터가 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const supabase = await createServerSupabase();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const { data: source, error } = await supabase
      .from("nlm_sources")
      .select("storage_path, original_filename")
      .eq("notebook_id", id)
      .eq("nlm_source_id", sourceId)
      .single();

    if (error || !source?.storage_path) {
      return NextResponse.json(
        { error: "다운로드 가능한 파일이 없습니다." },
        { status: 404 }
      );
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from("nlm-files")
      .createSignedUrl(source.storage_path, 300, {
        download: source.original_filename || undefined,
      });

    if (signedError || !signedData?.signedUrl) {
      return NextResponse.json(
        { error: "다운로드 URL 생성에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: signedData.signedUrl });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "다운로드 처리에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
