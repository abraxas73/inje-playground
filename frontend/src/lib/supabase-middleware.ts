import { createServerClient } from "@supabase/ssr";
import { after, NextResponse, type NextRequest } from "next/server";
import { auditProxyRequest } from "./audit-proxy";

/** Routes that require specific minimum roles */
const PROTECTED_ROUTES: { prefix: string; minRole: string }[] = [
  { prefix: "/admin", minRole: "admin" },
  { prefix: "/guide", minRole: "user" },
  { prefix: "/usage", minRole: "user" },
  { prefix: "/rfp", minRole: "user" },
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

    // 로그인 안 된 경우 /login으로 리다이렉트 (API, login, privacy, survey 등 공개 페이지 제외)
    if (
      !user &&
      !pathname.startsWith("/login") &&
      !pathname.startsWith("/auth") &&
      !pathname.startsWith("/api") &&
      !pathname.startsWith("/privacy") &&
      !pathname.startsWith("/survey")
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    // Role-based route protection
    if (user) {
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
