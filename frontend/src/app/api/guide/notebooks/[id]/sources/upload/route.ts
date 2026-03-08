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
    const files = formData.getAll("file") as File[];
    if (files.length === 0) {
      return NextResponse.json(
        { error: "파일이 필요합니다." },
        { status: 400 }
      );
    }

    const results = [];

    for (const file of files) {
      // 파일명에서 특수문자 제거 — Supabase Storage 키 호환
      const ext = file.name.split(".").pop() || "";
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = `${id}/${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("nlm-files")
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        return NextResponse.json(
          { error: `파일 업로드 실패 (${file.name}): ${uploadError.message}` },
          { status: 500 }
        );
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from("nlm-files")
        .createSignedUrl(filePath, 3600);

      if (signedError || !signedData?.signedUrl) {
        return NextResponse.json(
          { error: `Signed URL 생성 실패 (${file.name})` },
          { status: 500 }
        );
      }

      results.push({
        url: signedData.signedUrl,
        fileName: file.name,
        filePath,
      });
    }

    return NextResponse.json({ files: results });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "파일 업로드에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
