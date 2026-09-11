import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNotices, type Notice } from "./feed.ts";

interface Dependencies {
  secret: string | undefined;
  createAdmin: () => SupabaseClient;
  collect?: () => Promise<Notice[]>;
}

/** Constant-time digest comparison; cron token is separate from Supabase API keys. */
export async function authorized(header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith("Bearer ")) return false;
  const digest = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([digest(header.slice(7)), digest(secret)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  return different === 0;
}

export function createHandler({ secret, createAdmin, collect = fetchNotices }: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return Response.json({ error: "POST 요청이 필요합니다." }, { status: 405, headers: { Allow: "POST" } });
    }
    if (!secret) return Response.json({ error: "수집 인증이 설정되지 않았습니다." }, { status: 503 });
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
    const scheduled = await authorized(header, secret);
    let admin: SupabaseClient | undefined;
    let runId: number | undefined;
    try {
      admin = createAdmin();
      if (!scheduled) {
        // Manual collection uses the caller's verified session, never an API key from the browser.
        const { data: { user }, error: authError } = await admin.auth.getUser(header.slice(7));
        if (authError || !user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
        const { data: profile, error: profileError } = await admin.from("user_profiles").select("role").eq("user_id", user.id).single();
        if (profileError || !["user", "admin"].includes(profile?.role)) {
          return Response.json({ error: "사용자 권한이 필요합니다." }, { status: 403 });
        }
        const { data: claimed, error: claimError } = await admin.rpc("claim_yonhap_notice_manual_sync");
        if (claimError) throw new Error("수집 실행 상태 확인 실패");
        if (!claimed) {
          return Response.json({ error: "방금 가져오기를 실행했습니다. 1분 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": "60" } });
        }
      }
      const started = await admin.from("yonhap_notice_sync_runs").insert({ status: "running", trigger_source: scheduled ? "cron" : "manual" }).select("id").single();
      if (started.error) throw new Error("수집 이력 생성 실패");
      runId = started.data.id;
      const notices = await collect();
      if (notices.length) {
        const { error } = await admin.from("yonhap_notices").upsert(
          notices.map((notice) => ({ ...notice, fetched_at: new Date().toISOString() })),
          { onConflict: "source_id" },
        );
        if (error) throw new Error("인사·부고 저장 실패");
      }
      const { error } = await admin.from("yonhap_notice_sync_runs").update({
        status: "success", item_count: notices.length, finished_at: new Date().toISOString(),
      }).eq("id", runId);
      if (error) throw new Error("수집 완료 이력 저장 실패");
      return Response.json({ ok: true, count: notices.length, runId });
    } catch (error) {
      // No response bodies, credentials, or article content in logs.
      const message = error instanceof Error ? error.message.slice(0, 300) : "수집 실패";
      console.error("[yonhap-notices]", message);
      if (admin && runId !== undefined) {
        try {
          const result = await admin.from("yonhap_notice_sync_runs").update({
            status: "failed", error_message: message, finished_at: new Date().toISOString(),
          }).eq("id", runId);
          if (result.error) console.error("[yonhap-notices] 실패 이력 저장 실패");
        } catch { console.error("[yonhap-notices] 실패 이력 저장 실패"); }
      }
      return Response.json({ error: "연합뉴스 수집에 실패했습니다." }, { status: 500 });
    }
  };
}
