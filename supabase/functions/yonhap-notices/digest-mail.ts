import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDigest, type Digest } from "./digest.ts";
import { sanitize, sendMail, SmtpError, type SmtpConfig } from "./smtp.ts";

/** 인사·부고 소식 메일(예약·지금 수신)을 SMTP 릴레이로 보낸다. 슬롯·쿨다운 규칙은 RPC가 담당하고 여기서는 발송·이력만 다룬다. */
export const SENDER_NAME = "인사·부고 알림";
export interface DigestMailDeps { admin: SupabaseClient; smtp: SmtpConfig | null; appUrl: string; send?: typeof sendMail; now?: () => Date }
export interface ScheduledSummary { claimed: number; sent: number; failed: number; cancelled: number; skipped?: "smtp-unconfigured" }
export interface ActionResult { status: number; body: Record<string, unknown>; headers?: Record<string, string> }
export interface SendNowUser { client: SupabaseClient; id: string; email: string | null; emailConfirmed: boolean }
interface ScheduledJob { delivery_id: string; recipient_id: string; recipient_email: string; period_from: string; period_to: string }
interface ManualJob { delivery_id: string; period_from: string; period_to: string }

function failureMessage(error: unknown): string {
  return error instanceof SmtpError ? error.message : sanitize(error instanceof Error ? error.message : "발송 실패");
}

/** 한 통 보내고 Message-ID를 돌려준다. 수신자 거절도 SmtpError로 통일해 이력에 같은 형식으로 남긴다. */
async function deliver(send: typeof sendMail, smtp: SmtpConfig, to: string, digest: Digest): Promise<string> {
  const result = await send(smtp, { from: { name: SENDER_NAME, address: smtp.user }, to: [to], subject: digest.subject, text: digest.text, html: digest.html });
  const rejected = result.rejected[0];
  if (rejected || !result.accepted.length) throw new SmtpError("rcpt-to", rejected?.code ?? null, "recipient rejected");
  return result.messageId;
}

/** 매분 cron: due 구독을 claim해 순차 발송. SMTP 미설정이면 claim조차 하지 않아 예약이 소비되지 않는다. */
export async function runScheduledDigests({ admin, smtp, appUrl, send = sendMail, now = () => new Date(), limit = 10 }: DigestMailDeps & { limit?: number }): Promise<ScheduledSummary> {
  const summary: ScheduledSummary = { claimed: 0, sent: 0, failed: 0, cancelled: 0 };
  if (!smtp) { console.warn("[yonhap-digest] SMTP 미설정으로 예약 발송 생략"); return { ...summary, skipped: "smtp-unconfigured" }; }
  const claimed = await admin.rpc("claim_yonhap_notice_emails", { p_limit: limit });
  if (claimed.error) throw new Error("발송 예약 조회 실패");
  const jobs = (claimed.data ?? []) as ScheduledJob[];
  summary.claimed = jobs.length;
  for (const job of jobs) {
    const finish = (patch: Record<string, unknown>) => admin.from("yonhap_notice_email_deliveries").update({ ...patch, finished_at: now().toISOString() }).eq("id", job.delivery_id);
    try {
      const subscription = await admin.from("yonhap_notice_subscriptions").select("enabled").eq("user_id", job.recipient_id).maybeSingle();
      if (subscription.error) throw new Error("수신 설정 확인 실패");
      if (!subscription.data?.enabled) {
        const cancelled = await finish({ status: "cancelled" });
        if (cancelled.error) throw new Error("발송 취소 기록 실패");
        summary.cancelled++; continue;
      }
      const { digest, count } = await loadDigest(admin, job.period_from, job.period_to, appUrl);
      const messageId = await deliver(send, smtp, job.recipient_email, digest);
      const saved = await finish({ status: "sent", item_count: count, provider_id: messageId });
      if (saved.error) throw new Error("메일 발송 결과 저장 실패");
      summary.sent++;
    } catch (error) {
      summary.failed++;
      const message = failureMessage(error);
      console.error("[yonhap-digest] 예약 발송 실패", job.delivery_id, message);
      const failed = await finish({ status: "failed", error_message: message });
      if (failed.error) console.error("[yonhap-digest] 실패 이력 저장 실패", job.delivery_id);
    }
  }
  return summary;
}

/** 사용자 요청: 본인 세션 클라이언트로 claim(auth.uid 기준 1분 쿨다운) 후 최근 24시간 수집분을 로그인 이메일로 보낸다. */
export async function runSendNow({ admin, smtp, appUrl, user, send = sendMail, now = () => new Date() }: DigestMailDeps & { user: SendNowUser }): Promise<ActionResult> {
  if (!user.email || !user.emailConfirmed) return { status: 400, body: { error: "계정 이메일 인증이 필요합니다." } };
  if (!smtp) return { status: 503, body: { error: "메일 발송 서버가 설정되지 않았습니다. 관리자에게 문의해 주세요." } };
  const claim = await user.client.rpc("claim_yonhap_notice_send_now");
  if (claim.error) {
    if (claim.error.code === "42501") return { status: 403, body: { error: "사용자 권한이 필요합니다." } };
    if (claim.error.code === "22023") return { status: 400, body: { error: "계정 이메일 인증이 필요합니다." } };
    return { status: 500, body: { error: "즉시 수신 요청을 처리하지 못했습니다." } };
  }
  const job = ((claim.data ?? []) as ManualJob[])[0];
  if (!job) return { status: 429, body: { error: "1분 후 다시 수신할 수 있습니다." }, headers: { "Retry-After": "60" } };
  const finish = (patch: Record<string, unknown>) => admin.from("yonhap_notice_manual_deliveries").update({ ...patch, finished_at: now().toISOString() }).eq("id", job.delivery_id);
  try {
    const { digest, count } = await loadDigest(admin, job.period_from, job.period_to, appUrl);
    const messageId = await deliver(send, smtp, user.email, digest);
    const saved = await finish({ status: "sent", item_count: count, provider_id: messageId });
    if (saved.error) throw new Error("메일 발송 결과 저장 실패");
    return { status: 200, body: { count, from: job.period_from, to: job.period_to } };
  } catch (error) {
    const message = failureMessage(error);
    console.error("[yonhap-digest] 즉시 발송 실패", message);
    const failed = await finish({ status: "failed", error_message: message });
    if (failed.error) console.error("[yonhap-digest] 실패 이력 저장 실패");
    return { status: 502, body: { error: "메일 발송을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." } };
  }
}

/** 읽기 전용 미리보기: 최근 24시간 수집분을 실제 발송과 같은 양식으로 돌려준다. 발송·이력 기록 없음. */
export async function previewDigest({ admin, appUrl, now = () => new Date() }: { admin: SupabaseClient; appUrl: string; now?: () => Date }): Promise<Record<string, unknown>> {
  const to = now().toISOString();
  const from = new Date(Date.parse(to) - 86_400_000).toISOString();
  const { digest, count } = await loadDigest(admin, from, to, appUrl);
  return { ...digest, count, from, to };
}
