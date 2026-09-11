import { createServerClient } from "@supabase/ssr";
import { after, NextResponse, type NextRequest } from "next/server";
import { auditProxyRequest } from "./audit-proxy";

/**
 * 로그인 없이 열리는 경로. RFP 공유 링크(`/rfp/shared/…`)는 사외 공유용이라
 * 로그인 리다이렉트와 역할 검사를 모두 건너뛴다 — 실제 열람 권한은 라우트가 토큰으로 판단하고,
 * private 링크는 그 라우트에서 401(login_required)로 막는다.
 */
const PUBLIC_PREFIXES = ["/login", "/auth", "/api", "/privacy", "/survey", "/rfp/shared"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Routes that require specific minimum roles */
const PROTECTED_ROUTES: { prefix: string; minRole: string }[] = [
  { prefix: "/admin", minRole: "admin" },
  { prefix: "/guide", minRole: "user" },
  { prefix: "/usage", minRole: "user" },
  { prefix: "/rfp", minRole: "user" },
  { prefix: "/people-news", minRole: "user" },
];

const ROLE_PRIORITY: Record<string, number> = { guest: 0, user: 1, admin: 2 };

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const pathname = request.nextUrl.pathname;

    // 변경 요청(POST·PUT·PATCH·DELETE)은 응답을 보낸 뒤 감사 기록한다 — 응답을 늦추지 않는다.
    // 이 블록은 자체 try/catch로 격리한다: 감사 기록이 실패해도 아래 로그인·권한 검사를 건너뛰면 안 된다.
    if (user) {
      try {
        after(() => auditProxyRequest(supabase, request, { id: user.id, email: user.email }));
      } catch (e) {
        console.error("[audit] proxy after() 실패", e instanceof Error ? e.message : e);
      }
    }

    // 로그인 안 된 경우 /login으로 리다이렉트 (공개 경로 제외)
    if (!user && !isPublicPath(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    // Role-based route protection (공개 경로는 검사하지 않는다 — guest 계정도 공유 링크를 열 수 있어야 한다)
    if (user && !isPublicPath(pathname)) {
      const route = PROTECTED_ROUTES.find((r) => pathname.startsWith(r.prefix));
      if (route) {
        const { data: roleData } = await supabase
          .from("user_profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        const userRole = roleData?.role ?? "user";
        const required = ROLE_PRIORITY[route.minRole] ?? 0;
        const actual = ROLE_PRIORITY[userRole] ?? 0;

        if (actual < required) {
          const url = request.nextUrl.clone();
          url.pathname = "/";
          return NextResponse.redirect(url);
        }
      }
    }

    return supabaseResponse;
  } catch {
    return NextResponse.next({ request });
  }
}
