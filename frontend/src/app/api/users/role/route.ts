import { NextResponse } from "next/server";
import { isPagePermissions } from "@/lib/page-access";
import { createServerSupabase } from "@/lib/supabase-server";

/** GET /api/users/role — 현재 사용자의 역할 조회 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ role: "guest", userId: null, permissions: {} }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  const access = await supabase.from("user_page_access").select("permissions").eq("user_id", user.id).maybeSingle();
  if (error || !data || access.error || (access.data && !isPagePermissions(access.data.permissions))) return NextResponse.json({ error: "접근 권한을 확인하지 못했습니다." }, { status: 503 });
  return NextResponse.json({ role: data.role, userId: user.id, permissions: access.data?.permissions ?? {} }, { headers: { "Cache-Control": "private, no-store" } });
}
