import { isOAuthNavigation, oauthNotice } from "./mobile/oauth-notice";
import { createServerClient } from "@supabase/ssr";
import { after, NextResponse, type NextRequest } from "next/server";
import { auditProxyRequest } from "./audit-proxy";
import { canUsePage, isPagePermissions, matchesPath, pagesForPath } from "./page-access";
import { bearerToken, createBearerSupabase } from "./supabase-server";
import type { UserRole } from "./roles";

/**
 * 로그인 없이 열리는 경로. RFP 공유 링크(`/rfp/shared/…`)는 사외 공유용이라
 * 로그인 리다이렉트와 역할 검사를 모두 건너뛴다 — 실제 열람 권한은 라우트가 토큰으로 판단하고,
 * private 링크는 그 라우트에서 401(login_required)로 막는다.
 */
const PUBLIC_PREFIXES = ["/login", "/auth", "/api", "/privacy", "/account-deletion", "/survey", "/rfp/shared", "/ppt/s", "/.well-known"];

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
  { prefix: "/oauth", minRole: "user" }, // OAuth 동의(Claude 커넥터) — /api/mcp와 같은 user 이상
];

const ROLE_PRIORITY: Record<string, number> = { guest: 0, user: 1, admin: 2 };

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;
  const pageKeys = pagesForPath(pathname);
  const api = matchesPath(pathname, "/api");
  const adminPath = matchesPath(pathname, "/admin") || matchesPath(pathname, "/guide/admin");
  const publicSurvey = matchesPath(pathname, "/survey") || matchesPath(pathname, "/api/surveys");
  function deny(status: number, message: string) {
    const response = isOAuthNavigation(pathname, request.method) ? oauthNotice(message, status) : api ? NextResponse.json({ error: message }, { status }) : NextResponse.redirect(new URL(status === 401 ? "/login" : "/access-denied", request.url));
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  }

  try {
    // 모바일 앱의 네이티브 화면은 /api/*를 Bearer로 부른다 — 쿠키 갱신 없이 그 토큰으로 사용자·권한을 확인한다.
    const token = api ? bearerToken(request.headers) : null;
    const supabase = token
      ? createBearerSupabase(token)
      : createServerClient(
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

    // 조회·변경 요청(GET·POST·PUT·PATCH·DELETE)은 응답을 보낸 뒤 감사 기록한다 — 응답을 늦추지 않는다.
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
      // OAuth 동의 화면은 로그인 후 같은 인가 요청으로 돌아와야 한다(스펙 §5.2).
      if (matchesPath(pathname, "/oauth")) url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
      return NextResponse.redirect(url);
    }

    // Page permissions also cover feature APIs; anonymous public surveys keep their own access_mode checks.
    // /api/mcp는 401에 WWW-Authenticate(OAuth 리소스 메타데이터)가 있어야 Claude가 사인인을 시작한다 — 미인증 응답은 라우트가 만든다.
    if (!user && pageKeys.length && !publicSurvey && !matchesPath(pathname, "/api/mcp")) return deny(401, "로그인이 필요합니다.");
    if (user && (pageKeys.length || adminPath)) {
      const profile = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
      if (profile.error || !["guest", "user", "admin"].includes(profile.data?.role)) return deny(503, "접근 권한을 확인하지 못했습니다.");
      const role = profile.data.role as UserRole;
      if (adminPath && role !== "admin") return deny(403, "관리자 권한이 필요합니다.");
      if (pageKeys.includes("marketing")) {
        const access = await supabase.rpc("has_page_access", { p_page: "marketing" });
        if (access.error) return deny(503, "접근 권한을 확인하지 못했습니다.");
        if (access.data !== true) return deny(403, "마케팅 DB 접근 권한이 없습니다.");
      } else if (role !== "admin" && pageKeys.length) {
        const access = await supabase.from("user_page_access").select("permissions").eq("user_id", user.id).maybeSingle();
        if (access.error || (access.data && !isPagePermissions(access.data.permissions))) return deny(503, "접근 권한을 확인하지 못했습니다.");
        if (!pageKeys.some((key) => canUsePage(role, key, access.data?.permissions ?? {}))) return deny(403, "이 페이지에 접근할 권한이 없습니다.");
      }
    }
    // Legacy protected sections not listed in the page catalog.
    if (user && !isPublicPath(pathname) && !pageKeys.length && !adminPath) {
      const route = PROTECTED_ROUTES.find((r) => matchesPath(pathname, r.prefix));
      if (route) {
        const { data: roleData } = await supabase
          .from("user_profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        const userRole = roleData?.role ?? "guest";
        const required = ROLE_PRIORITY[route.minRole] ?? 0;
        const actual = ROLE_PRIORITY[userRole] ?? 0;

        if (actual < required) {
          const url = request.nextUrl.clone();
          url.pathname = route.prefix === "/oauth" ? "/access-denied" : "/"; // 동의 화면은 조용히 홈으로 보내면 Claude 연결이 이유 없이 멈춘다
          url.search = "";
          return NextResponse.redirect(url);
        }
      }
    }

    return supabaseResponse;
  } catch {
    if (pageKeys.length || adminPath) return deny(503, "접근 권한을 확인하지 못했습니다.");
    return NextResponse.next({ request });
  }
}
