import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Routes that require specific minimum roles */
const PROTECTED_ROUTES: { prefix: string; minRole: string }[] = [
  { prefix: "/admin", minRole: "admin" },
  { prefix: "/guide", minRole: "user" },
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

    // 로그인 안 된 경우 /login으로 리다이렉트 (API, login, privacy 등 공개 페이지 제외)
    if (
      !user &&
      !pathname.startsWith("/login") &&
      !pathname.startsWith("/auth") &&
      !pathname.startsWith("/api") &&
      !pathname.startsWith("/privacy")
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
