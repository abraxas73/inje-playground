import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { logAudit, logAuthEvent, logLogin } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase-admin";

/**
 * 실패한 로그인은 세션이 없어 login_history에 남길 수 없다 — service role로 action_history에
 * "로그인 실패"를 남긴다(뷰 audit_log의 kind login_failed). 키가 없으면 조용히 넘긴다.
 */
async function recordFailure(request: Request, reason: string, actor?: { id: string; email?: string | null } | null, provider?: string) {
  try {
    await logAuthEvent(createAdminClient(), request, {
      event: "failure", provider: provider ?? "unknown", reason,
      userId: actor?.id ?? null, email: actor?.email ?? null,
    });
  } catch {
    // 감사 기록이 로그인 화면 리다이렉트를 막지 않는다
  }
}

/** 이미 로그인된 세션이 있으면 그 사용자(실패를 누가 겪었는지 붙이고, 재접근인지 판단하는 데도 쓴다) */
async function currentActor(supabase: { auth: { getUser: () => Promise<{ data: { user: { id: string; email?: string | null } | null } }> } }) {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
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

  // 공급자가 거절하면 code 없이 error=…로 돌아온다(사용자 취소·정책 거부 등)
  const providerError = searchParams.get("error");
  if (providerError) {
    const description = searchParams.get("error_description") ?? searchParams.get("error_code");
    await recordFailure(request, `${providerError}${description ? `: ${description}` : ""}`, await currentActor(supabase));
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  if (code) {

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
    await recordFailure(request, error?.message ?? "코드 교환 실패", await currentActor(supabase));
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // code도 error도 없이 들어온 경우. **이미 로그인된 세션이면 로그인 실패가 아니다**
  // (새로고침·뒤로가기로 콜백 주소를 다시 열었을 뿐) → 기록하지 않고 홈으로 보낸다.
  const actor = await currentActor(supabase);
  if (actor) return NextResponse.redirect(`${origin}${next}`);
  await recordFailure(request, "인증 코드 없음", null);
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
