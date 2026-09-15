import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { parseMediaListXlsx } from "@/lib/media-directory/excel";
import { buildImportPreview } from "@/lib/media-directory/preview";
import { loadDirectory, noStore } from "@/lib/media-directory/server";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "XLSX 파일을 선택해 주세요." }, { status: 400 });
    if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "파일은 2MB 이하여야 합니다." }, { status: 413 });
    const parsed = await parseMediaListXlsx(Buffer.from(await file.arrayBuffer()));
    const directory = await loadDirectory(await createServerSupabase());
    return NextResponse.json(buildImportPreview(parsed, directory.outlets, file.name), noStore);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "파일을 읽지 못했습니다." }, { status: 400 });
  }
}
