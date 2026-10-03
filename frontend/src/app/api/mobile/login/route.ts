import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { logLogin } from "@/lib/audit";
import { isPagePermissions, type PagePermissions } from "@/lib/page-access";
import { createServerSupabase } from "@/lib/supabase-server";
import type { UserRole } from "@/lib/roles";

export const runtime = "nodejs";

/** 역할·페이지 권한 — 웹 /api/users/role과 같은 규칙(마케팅은 has_page_access RPC: 지정 검수자·고정 담당자 포함). */
async function sessionInfo(supabase: SupabaseClient, user: User) {
  const profile = await supabase.from("user_profiles").select("role,display_name").eq("user_id", user.id).single();
  const role: UserRole = profile.data?.role === "admin" || profile.data?.role === "user" ? profile.data.role : "guest";
  let permissions: PagePermissions = {};
  if (role === "user") {
    const access = await supabase.from("user_page_access").select("permissions").eq("user_id", user.id).maybeSingle();
    if (access.data && isPagePermissions(access.data.permissions)) permissions = { ...access.data.permissions };
    const marketing = await supabase.rpc("has_page_access", { p_page: "marketing" });
    permissions.marketing = !marketing.error && marketing.data === true;
  }
  // 홈 인사말용 이름 — 웹 프로필과 같은 우선순위(display_name → Azure full_name)
  const name = (profile.data?.display_name as string | null | undefined) ?? (user.user_metadata?.full_name as string | undefined) ?? null;
  return { email: user.email ?? null, name, role, permissions };
}

async function handle(request: NextRequest, record: boolean) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const info = await sessionInfo(supabase, user);
  if (record) await logLogin(supabase, request, { userId: user.id, userEmail: user.email ?? null });
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/mobile/login — 모바일 앱이 Microsoft OAuth 직후(signedIn) 한 번 부른다(Bearer).
 * 웹 /auth/callback처럼 login_history를 남기고(Audit 로그 kind login, user_agent로 앱 구분) 역할·페이지 권한을 돌려준다.
 * guest도 기록은 남긴다 — 네이티브 기능 차단은 앱이 역할로 한다.
 */
export async function POST(request: NextRequest) {
  return handle(request, true);
}

/** GET /api/mobile/login — 같은 응답, 기록 없음. 앱 콜드 스타트·세션 새로고침·guest "다시 확인"이 쓴다. */
export async function GET(request: NextRequest) {
  return handle(request, false);
}
