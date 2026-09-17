import type { SupabaseClient } from "@supabase/supabase-js";

export type YonhapAction = "collect" | "send-now" | "preview";
export interface YonhapCallResult { status: number; body: Record<string, unknown>; retryAfter: string | null }

/**
 * 세션 JWT를 붙여 Edge Function `yonhap-notices`를 호출한다(Edge Function이 JWT를 다시 검증).
 * 세션이 없으면 401, 네트워크·타임아웃 실패는 502 + failureMessage. 그 외에는 Edge Function 응답을 그대로 돌려준다.
 */
export async function callYonhapFunction(supabase: SupabaseClient, action: YonhapAction, options: { timeoutMs: number; failureMessage: string; payload?: Record<string, unknown> }, fetcher: typeof fetch = fetch): Promise<YonhapCallResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { status: 401, body: { error: "다시 로그인해 주세요." }, retryAfter: null };
  try {
    const response = await fetcher(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/yonhap-notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, ...options.payload }),
      signal: AbortSignal.timeout(options.timeoutMs),
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body, retryAfter: response.headers.get("Retry-After") };
  } catch {
    return { status: 502, body: { error: options.failureMessage }, retryAfter: null };
  }
}
