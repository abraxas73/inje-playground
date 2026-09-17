import type { SupabaseClient, User } from "@supabase/supabase-js";
import { fetchNotices, type Notice } from "./feed.ts";
import { runMediaAlerts, type AlertDeps, type AlertSummary } from "./alerts.ts";
import { enrichSummaries, needsArticleText } from "./article.ts";
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
  /** 요약이 머리글뿐인 기사에 원문 한 줄을 붙인다(article.ts) */
  enrich?: typeof enrichSummaries;
  digests?: DigestRunners;
}
const ACTIONS = ["collect", "send-digests", "send-now", "preview"] as const;
export type Action = (typeof ACTIONS)[number];
/** send-now·preview 요청 옵션 — "이전 발송 내역 제외"(null이면 사용자의 저장된 설정을 따른다) */
export interface RequestOptions { excludeSent: boolean | null }
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
export async function readAction(request: Request): Promise<{ action: Action; options: RequestOptions } | null> {
  const text = await request.text();
  if (!text.trim()) return { action: "collect", options: { excludeSent: null } };
  try {
    const body = JSON.parse(text) ?? {};
    const action = body.action ?? "collect";
    if (!(ACTIONS as readonly string[]).includes(action)) return null;
    return { action: action as Action, options: { excludeSent: typeof body.excludeSent === "boolean" ? body.excludeSent : null } };
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

export function createHandler({ secret, createAdmin, createUserClient, collect = fetchNotices, smtp, appUrl, alerts = runMediaAlerts, enrich = enrichSummaries, digests = defaultDigests }: Dependencies) {
  async function collectRun(admin: SupabaseClient, scheduled: boolean): Promise<Response> {
    let runId: number | undefined;
    try {
      const started = await admin.from("yonhap_notice_sync_runs").insert({ status: "running", trigger_source: scheduled ? "cron" : "manual" }).select("id").single();
      if (started.error) throw new Error("수집 이력 생성 실패");
      runId = started.data.id;
      const notices = await collect();
      // 저장된 요약까지 함께 읽어 (1) 알림 대상 새 부고와 (2) 원문 보강이 필요한 기사를 가린다.
      const known = new Map<string, string>();
      if (notices.length) {
        const existing = await admin.from("yonhap_notices").select("source_id, summary").in("source_id", notices.map((notice) => notice.source_id));
        if (existing.error) throw new Error("기존 인사·부고 조회 실패");
        for (const row of (existing.data ?? []) as { source_id: string; summary: string | null }[]) known.set(row.source_id, row.summary ?? "");
      }
      // Only obituaries stored for the first time in this run are eligible for alerts.
      const newObituaryIds = notices.filter((notice) => notice.category === "obituary" && !known.has(notice.source_id)).map((notice) => notice.source_id);
      // 새 기사이거나 저장된 요약이 아직 머리글뿐인 기사만 원문을 읽는다 — 한 번 보강되면 다시 읽지 않는다.
      const pending = notices.filter((notice) => !known.has(notice.source_id) || needsArticleText(known.get(notice.source_id)!));
      let enriched = 0;
      try {
        ({ enriched } = await enrich(pending));
      } catch (error) {
        // 보강은 부가 기능이라 수집을 실패시키지 않는다.
        console.error("[yonhap-notices] 원문 보강 실패", error instanceof Error ? error.message.slice(0, 200) : "unknown");
      }
      // RSS 요약은 매번 머리글뿐이라, 이미 보강해 둔 저장분을 upsert가 되돌리지 않도록 지킨다.
      for (const notice of notices) {
        const stored = known.get(notice.source_id);
        if (stored && needsArticleText(notice.summary) && !needsArticleText(stored)) notice.summary = stored;
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
      return Response.json({ ok: true, count: notices.length, runId, enriched, alerts: alertSummary });
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
    const parsed = await readAction(request);
    if (!parsed) return Response.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    const { action, options } = parsed;
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
        if (action === "preview") return Response.json(await digests.preview({ admin, appUrl, userId: verified.user.id, excludeSent: options.excludeSent }), { headers: noStore });
        if (action === "send-now") {
          const { user } = verified;
          const result = await digests.sendNow({ admin, smtp, appUrl, excludeSent: options.excludeSent, user: { client: createUserClient(jwt), id: user.id, email: user.email ?? null, emailConfirmed: !!user.email_confirmed_at } });
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
