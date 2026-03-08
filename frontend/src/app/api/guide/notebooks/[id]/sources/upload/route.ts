import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const supabase = await createServerSupabase();

    // 인증 확인
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json(
        { error: "파일이 필요합니다." },
        { status: 400 }
      );
    }

    // Supabase Storage에 업로드
    const filePath = `${id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("nlm-files")
      .upload(filePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `파일 업로드 실패: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Signed URL 생성 (1시간 — NLM 서비스가 다운로드할 시간)
    const { data: signedData, error: signedError } = await supabase.storage
      .from("nlm-files")
      .createSignedUrl(filePath, 3600);

    if (signedError || !signedData?.signedUrl) {
      return NextResponse.json(
        { error: "Signed URL 생성 실패" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      url: signedData.signedUrl,
      fileName: file.name,
      filePath,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "파일 업로드에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
