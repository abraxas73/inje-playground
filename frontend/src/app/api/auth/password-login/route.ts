import { NextRequest, NextResponse } from "next/server";
import { logAudit, logLogin } from "@/lib/audit";
import { EMAIL_LOGIN_DENIED, emailLoginAllowed } from "@/lib/auth/test-account";
import { createServerSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";

/**
 * POST /api/auth/password-login — 웹 로그인 화면이 테스트 계정 비밀번호 로그인(signInWithPassword) 직후 한 번 부른다.
 * OAuth의 `/auth/callback`이 하는 기록(login_history + "로그인" 감사)을 이메일 로그인에도 남긴다.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (!emailLoginAllowed(user)) return NextResponse.json(EMAIL_LOGIN_DENIED, { status: 403 });
  await logLogin(supabase, request, { userId: user.id, userEmail: user.email ?? null });
  await logAudit(supabase, request, {
    userId: user.id, userEmail: user.email ?? null,
    action: "로그인", category: "auth",
    detail: { provider: user.app_metadata?.provider ?? null, test_account: user.app_metadata?.test_account === true },
  });
  return NextResponse.json({ ok: true });
}
