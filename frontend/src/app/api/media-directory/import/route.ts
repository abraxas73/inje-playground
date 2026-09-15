import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { MAX_IMPORT_ROWS } from "@/lib/media-directory/excel";
import { cleanName, noStore, rpcErrorResponse } from "@/lib/media-directory/server";
import type { ImportRow } from "@/types/media-directory";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  let body: { rows?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  if (!Array.isArray(body.rows) || body.rows.length > MAX_IMPORT_ROWS) return NextResponse.json({ error: "적재할 행이 올바르지 않습니다." }, { status: 400 });
  const rows: ImportRow[] = [];
  for (const raw of body.rows) {
    if (!raw || typeof raw !== "object" || typeof (raw as ImportRow).outlet !== "string") return NextResponse.json({ error: "행 형식이 올바르지 않습니다." }, { status: 400 });
    const department = (raw as ImportRow).department;
    if (department !== null && department !== undefined && typeof department !== "string") return NextResponse.json({ error: "행 형식이 올바르지 않습니다." }, { status: 400 });
    rows.push({ outlet: cleanName((raw as ImportRow).outlet), department: department ? cleanName(department) || null : null });
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("media_directory_import", { p_rows: rows });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json(data, noStore);
}
