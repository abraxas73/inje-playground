import { NextRequest, NextResponse } from "next/server";
import { logLogin } from "@/lib/audit";
import { isPagePermissions, type PagePermissions } from "@/lib/page-access";
import { createServerSupabase } from "@/lib/supabase-server";
import type { UserRole } from "@/lib/roles";

export const runtime = "nodejs";

/**
 * POST /api/mobile/login — 모바일 앱이 Microsoft OAuth 직후 한 번 부른다(Bearer).
 * 웹 /auth/callback처럼 login_history를 남기고(Audit 로그 kind login, user_agent로 앱 구분) 역할·페이지 권한을 돌려준다.
 * guest도 기록은 남긴다 — 네이티브 기능 차단은 앱이 역할로 한다.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const profile = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  const role: UserRole = profile.data?.role === "admin" || profile.data?.role === "user" ? profile.data.role : "guest";
  let permissions: PagePermissions = {};
  if (role === "user") {
    const access = await supabase.from("user_page_access").select("permissions").eq("user_id", user.id).maybeSingle();
    if (access.data && isPagePermissions(access.data.permissions)) permissions = access.data.permissions;
  }
  await logLogin(supabase, request, { userId: user.id, userEmail: user.email ?? null });
  return NextResponse.json({ email: user.email ?? null, role, permissions }, { headers: { "Cache-Control": "no-store" } });
}
