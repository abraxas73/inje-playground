import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

/** `Authorization: Bearer <jwt>`의 토큰. 모바일 앱(네이티브 화면)이 쿠키 대신 보낸다. */
export function bearerToken(h: { get(name: string): string | null }): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(h.get("authorization") ?? "");
  return m ? m[1] : null;
}

/**
 * 쿠키 세션 없이 사용자 JWT로 동작하는 클라이언트. PostgREST는 전역 헤더의 토큰으로 RLS를 적용한다.
 * supabase-js의 `getUser()`는 저장된 세션이 없으면 토큰을 보지 않으므로, 인자 없는 호출에 이 토큰을 기본값으로 넣어
 * 기존 라우트의 `supabase.auth.getUser()`가 그대로 동작하게 한다.
 */
export function createBearerSupabase(token: string): SupabaseClient {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = (jwt?: string) => getUser(jwt ?? token);
  return client;
}

export async function createServerSupabase() {
  const token = bearerToken(await headers());
  if (token) return createBearerSupabase(token);
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component에서는 쿠키 설정 불가
          }
        },
      },
    }
  );
}
