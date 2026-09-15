import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/claude-usage/require-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { cleanName, noStore, rpcErrorResponse } from "@/lib/media-directory/server";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  const name = cleanName(body.name);
  if (name.length < 2) return NextResponse.json({ error: "매체명은 2자 이상이어야 합니다." }, { status: 400 });
  const aliases = Array.isArray(body.aliases) ? [...new Set(body.aliases.map((a) => cleanName(a)).filter(Boolean))].slice(0, 20) : [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("media_outlet_save", {
    p_id: typeof body.id === "string" ? body.id : null, p_name: name, p_aliases: aliases,
    p_any_department: typeof body.anyDepartment === "boolean" ? body.anyDepartment : null, p_active: typeof body.active === "boolean" ? body.active : null,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ outlet: data }, noStore);
}
