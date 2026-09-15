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
  if (typeof body.outletId !== "string" || !body.outletId) return NextResponse.json({ error: "매체를 선택해 주세요." }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "부서명은 2자 이상이어야 합니다." }, { status: 400 });
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("media_department_save", {
    p_id: typeof body.id === "string" ? body.id : null, p_outlet_id: body.outletId, p_name: name, p_active: typeof body.active === "boolean" ? body.active : true,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ department: data }, noStore);
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "삭제할 부서를 확인해 주세요." }, { status: 400 });
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("media_department_delete", { p_id: id });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ department: data }, noStore);
}
