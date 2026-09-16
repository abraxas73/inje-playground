import type { SupabaseClient, User } from "@supabase/supabase-js";
import { fetchNotices, type Notice } from "./feed.ts";
import { runMediaAlerts, type AlertDeps, type AlertSummary } from "./alerts.ts";
import { previewDigest, runScheduledDigests, runSendNow } from "./digest-mail.ts";
import type { SmtpConfig } from "./smtp.ts";

export interface DigestRunners { scheduled: typeof runScheduledDigests; sendNow: typeof runSendNow; preview: typeof previewDigest }
interface Dependencies {
  secret: string | undefined;
  createAdmin: () => SupabaseClient;
  /** 사용자 JWT를 Authorization으로 붙인 anon 클라이언트 — auth.uid() 기반 RPC(지금 수신 claim)용. */
  createUserClient: (jwt: string) => SupabaseClient;
  collect?: () => Promise<Notice[]>;
  smtp: SmtpConfig | null;
  appUrl: string;
  alerts?: (deps: AlertDeps) => Promise<AlertSummary>;
  digests?: DigestRunners;
}
const ACTIONS = ["collect", "send-digests", "send-now", "preview"] as const;
export type Action = (typeof ACTIONS)[number];
const noStore = { "Cache-Control": "no-store" };

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

/** 본문이 비었거나 `{}`면 collect(기존 cron·'지금 가져오기' 호환). 알 수 없는 action·깨진 JSON은 null. */
export async function readAction(request: Request): Promise<Action | null> {
  const text = await request.text();
  if (!text.trim()) return "collect";
  try {
    const action = JSON.parse(text)?.action ?? "collect";
    return (ACTIONS as readonly string[]).includes(action) ? action as Action : null;
  } catch { return null; }
}

/** 사용자 세션 검증(JWT → user·role·people_news 접근). 브라우저가 보낸 API 키는 받지 않는다. */
export async function verifyUser(admin: SupabaseClient, jwt: string): Promise<{ ok: true; user: User } | { ok: false; response: Response }> {
  const fail = (error: string, status: number) => ({ ok: false as const, response: Response.json({ error }, { status }) });
  const { data: { user }, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !user) return fail("로그인이 필요합니다.", 401);
  const { data: profile, error: profileError } = await admin.from("user_profiles").select("role").eq("user_id", user.id).single();
  if (profileError || !["user", "admin"].includes(profile?.role)) return fail("사용자 권한이 필요합니다.", 403);
  if (profile.role !== "admin") {
    const access = await admin.from("user_page_access").select("permissions").eq("user_id", user.id).maybeSingle();
    if (access.error) return fail("접근 권한을 확인하지 못했습니다.", 503);
    if (access.data?.permissions?.people_news === false) return fail("인사·부고 접근 권한이 없습니다.", 403);
  }
  return { ok: true, user };
}

const defaultDigests: DigestRunners = { scheduled: runScheduledDigests, sendNow: runSendNow, preview: previewDigest };

export function createHandler({ secret, createAdmin, createUserClient, collect = fetchNotices, smtp, appUrl, alerts = runMediaAlerts, digests = defaultDigests }: Dependencies) {
  async function collectRun(admin: SupabaseClient, scheduled: boolean): Promise<Response> {
    let runId: number | undefined;
    try {
      const started = await admin.from("yonhap_notice_sync_runs").insert({ status: "running", trigger_source: scheduled ? "cron" : "manual" }).select("id").single();
      if (started.error) throw new Error("수집 이력 생성 실패");
      runId = started.data.id;
      const notices = await collect();
      // Only obituaries stored for the first time in this run are eligible for alerts.
      const obituaryIds = notices.filter((notice) => notice.category === "obituary").map((notice) => notice.source_id);
      let newObituaryIds: string[] = [];
      if (obituaryIds.length) {
        const existing = await admin.from("yonhap_notices").select("source_id").in("source_id", obituaryIds);
        if (existing.error) throw new Error("기존 인사·부고 조회 실패");
        const known = new Set((existing.data ?? []).map((row: { source_id: string }) => row.source_id));
        newObituaryIds = obituaryIds.filter((id) => !known.has(id));
      }
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
      let alertSummary: AlertSummary | { error: "media-alerts-failed" };
      try {
        alertSummary = await alerts({ admin, runId: started.data.id as number, sourceIds: newObituaryIds, smtp, appUrl });
      } catch (error) {
        // Alerts are best-effort; the collection run above is already recorded as success.
        console.error("[media-alerts]", error instanceof Error ? error.message.slice(0, 200) : "알림 실패");
        alertSummary = { error: "media-alerts-failed" };
      }
      return Response.json({ ok: true, count: notices.length, runId, alerts: alertSummary });
    } catch (error) {
      // No response bodies, credentials, or article content in logs.
      const message = error instanceof Error ? error.message.slice(0, 300) : "수집 실패";
      console.error("[yonhap-notices]", message);
      if (runId !== undefined) {
        try {
          const result = await admin.from("yonhap_notice_sync_runs").update({
            status: "failed", error_message: message, finished_at: new Date().toISOString(),
          }).eq("id", runId);
          if (result.error) console.error("[yonhap-notices] 실패 이력 저장 실패");
        } catch { console.error("[yonhap-notices] 실패 이력 저장 실패"); }
      }
      return Response.json({ error: "연합뉴스 수집에 실패했습니다." }, { status: 500 });
    }
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return Response.json({ error: "POST 요청이 필요합니다." }, { status: 405, headers: { Allow: "POST" } });
    }
    if (!secret) return Response.json({ error: "수집 인증이 설정되지 않았습니다." }, { status: 503 });
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return Response.json({ error: "인증이 필요합니다." }, { status: 401 });
    const action = await readAction(request);
    if (!action) return Response.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    const scheduled = await authorized(header, secret);
    let admin: SupabaseClient;
    try {
      admin = createAdmin();
      if (action === "send-digests") {
        if (!scheduled) return Response.json({ error: "예약 발송은 스케줄러만 실행할 수 있습니다." }, { status: 403 });
        const summary = await digests.scheduled({ admin, smtp, appUrl });
        return Response.json({ ok: true, ...summary });
      }
      if (!scheduled) {
        // Manual requests use the caller's verified session, never an API key from the browser.
        const jwt = header.slice(7);
        const verified = await verifyUser(admin, jwt);
        if (!verified.ok) return verified.response;
        if (action === "preview") return Response.json(await digests.preview({ admin, appUrl }), { headers: noStore });
        if (action === "send-now") {
          const { user } = verified;
          const result = await digests.sendNow({ admin, smtp, appUrl, user: { client: createUserClient(jwt), id: user.id, email: user.email ?? null, emailConfirmed: !!user.email_confirmed_at } });
          return Response.json(result.body, { status: result.status, headers: { ...noStore, ...result.headers } });
        }
        const { data: claimed, error: claimError } = await admin.rpc("claim_yonhap_notice_manual_sync");
        if (claimError) throw new Error("수집 실행 상태 확인 실패");
        if (!claimed) {
          return Response.json({ error: "방금 가져오기를 실행했습니다. 1분 후 다시 시도해 주세요." }, { status: 429, headers: { "Retry-After": "60" } });
        }
      } else if (action !== "collect") {
        return Response.json({ error: "사용자 세션이 필요합니다." }, { status: 403 });
      }
    } catch (error) {
      console.error("[yonhap-notices]", error instanceof Error ? error.message.slice(0, 300) : "요청 처리 실패");
      return Response.json({ error: action === "collect" ? "연합뉴스 수집에 실패했습니다." : "메일 발송 작업에 실패했습니다." }, { status: 500 });
    }
    return collectRun(admin, scheduled);
  };
}
