import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { logAudit, logAuthEvent, logLogin } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * 실패한 로그인은 세션이 없어 login_history에 남길 수 없다 — service role로 action_history에
 * "로그인 실패"를 남긴다(뷰 audit_log의 kind login_failed). 키가 없으면 조용히 넘긴다.
 */
async function recordFailure(request: Request, reason: string, provider?: string) {
  try {
    await logAuthEvent(createAdminClient(), request, { event: "failure", provider: provider ?? "unknown", reason });
  } catch {
    // 감사 기록이 로그인 화면 리다이렉트를 막지 않는다
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  // 공급자가 거절하면 code 없이 error=…로 돌아온다(사용자 취소·정책 거부 등)
  const providerError = searchParams.get("error");
  if (providerError) {
    const description = searchParams.get("error_description") ?? searchParams.get("error_code");
    await recordFailure(request, `${providerError}${description ? `: ${description}` : ""}`);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // 로그인 이력 + last_login_at, 그리고 Audit 로그(어떤 공급자로 들어왔는지)
      await logLogin(supabase, request, { userId: data.user.id, userEmail: data.user.email ?? null });
      await logAudit(supabase, request, {
        userId: data.user.id, userEmail: data.user.email ?? null,
        action: "로그인", category: "auth",
        detail: { provider: data.user.app_metadata?.provider ?? null, next },
      });
      return NextResponse.redirect(`${origin}${next}`);
    }
    // 코드 교환 실패(만료·재사용·설정 오류)
    await recordFailure(request, error?.message ?? "코드 교환 실패");
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // code도 error도 없이 들어온 경우(직접 접근·중단된 흐름)
  await recordFailure(request, "인증 코드 없음");
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
