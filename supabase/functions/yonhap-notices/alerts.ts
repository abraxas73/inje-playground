import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitize, sendMail, SmtpError, type SmtpConfig } from "./smtp.ts";

export interface AlertMatch { id: number; sourceId: string; outlet: string; department: string | null; matchedText: string; title: string; summary: string; url: string; publishedAt: string }
export interface AlertRecipient { user_id: string; email: string }
export interface AlertSummary { matches: number; recipients: number; sent: number; failed: number; skipped?: "no-new-notices" | "no-matches" | "smtp-unconfigured" | "no-recipients" }
export interface AlertDeps { admin: SupabaseClient; runId: number; sourceIds: string[]; smtp: SmtpConfig | null; appUrl: string; send?: typeof sendMail; now?: () => Date }

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const kst = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
function kstDay(date: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${parts.month}월 ${parts.day}일`;
}

export function buildAlertDigest(matches: AlertMatch[], appUrl: string, now: Date): { subject: string; text: string; html: string } {
  const subject = `[부고 알림] 관리 매체·부서 일치 ${matches.length}건 · ${kstDay(now)}`;
  const label = (m: AlertMatch) => (m.department ? m.matchedText : `${m.outlet} (부서 무관)`);
  const text = [
    `관리 매체·부서와 일치하는 연합뉴스 부고 ${matches.length}건입니다.`, "",
    ...matches.flatMap((m) => [`■ ${label(m)}`, m.title, m.summary, `원문: ${m.url}`, `송고: ${kst.format(new Date(m.publishedAt))} KST`, ""]),
    `인사·부고 화면: ${appUrl}/people-news`, `관리 매체·부서 목록: ${appUrl}/media-directory`,
    "알림 해제는 인사·부고 화면의 '관리 매체·부서 부고 알림 받기'에서 할 수 있습니다.",
  ].join("\n");
  const items = matches.map((m) =>
    `<li style="margin:0 0 16px"><div style="font-size:12px;color:#0369a1;font-weight:600">${escapeHtml(label(m))}</div>` +
    `<div style="font-weight:600;margin:2px 0"><a href="${escapeHtml(m.url)}" style="color:#111">${escapeHtml(m.title)}</a></div>` +
    `<div style="color:#444;font-size:14px;line-height:1.5;white-space:pre-line">${escapeHtml(m.summary)}</div>` +
    `<div style="color:#888;font-size:12px">송고 ${escapeHtml(kst.format(new Date(m.publishedAt)))} KST · <a href="${escapeHtml(m.url)}">원문 보기</a></div></li>`).join("");
  const html = `<!doctype html><html lang="ko"><body style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">` +
    `<h1 style="font-size:18px;margin:0 0 4px">관리 매체·부서 부고 알림</h1><p style="margin:0 0 20px;color:#555">관리 매체·부서와 일치하는 연합뉴스 부고 ${matches.length}건입니다.</p>` +
    `<ul style="list-style:none;padding:0;margin:0">${items}</ul><hr style="border:0;border-top:1px solid #e5e5e5;margin:20px 0">` +
    `<p style="font-size:12px;color:#777"><a href="${escapeHtml(appUrl)}/people-news">인사·부고 화면</a> · <a href="${escapeHtml(appUrl)}/media-directory">관리 매체·부서 목록</a><br>알림 해제는 인사·부고 화면의 '관리 매체·부서 부고 알림 받기'에서 할 수 있습니다.</p></body></html>`;
  return { subject, text, html };
}

export async function runMediaAlerts({ admin, runId, sourceIds, smtp, appUrl, send = sendMail, now = () => new Date() }: AlertDeps): Promise<AlertSummary> {
  const summary: AlertSummary = { matches: 0, recipients: 0, sent: 0, failed: 0 };
  if (!sourceIds.length) return { ...summary, skipped: "no-new-notices" };
  const matched = await admin.rpc("media_match_notices", { p_source_ids: sourceIds, p_run_id: runId });
  if (matched.error) throw new Error("매체 매칭 실패");
  const matches = (matched.data ?? []) as AlertMatch[];
  summary.matches = matches.length;
  if (!matches.length) return { ...summary, skipped: "no-matches" };
  if (!smtp) { console.warn("[media-alerts] SMTP 미설정으로 발송 생략", matches.length); return { ...summary, skipped: "smtp-unconfigured" }; }
  const recipientsResult = await admin.rpc("media_alert_recipients");
  if (recipientsResult.error) throw new Error("알림 수신자 조회 실패");
  const recipients = (recipientsResult.data ?? []) as AlertRecipient[];
  summary.recipients = recipients.length;
  if (!recipients.length) return { ...summary, skipped: "no-recipients" };
  const digest = buildAlertDigest(matches, appUrl, now());
  const deliveries: Array<{ sync_run_id: number; recipient_user_id: string; recipient_email: string; match_count: number; status: "sent" | "failed"; error_message: string | null }> = [];
  const base = (r: AlertRecipient) => ({ sync_run_id: runId, recipient_user_id: r.user_id, recipient_email: r.email, match_count: matches.length });
  try {
    const result = await send(smtp, { from: { name: "인사·부고 알림", address: smtp.user }, to: recipients.map((r) => r.email), subject: digest.subject, text: digest.text, html: digest.html });
    const accepted = new Set(result.accepted.map((a) => a.toLowerCase()));
    for (const r of recipients) {
      const rejected = result.rejected.find((x) => x.address.toLowerCase() === r.email.toLowerCase());
      const ok = !rejected && accepted.has(r.email.toLowerCase());
      deliveries.push({ ...base(r), status: ok ? "sent" : "failed", error_message: ok ? null : `수신자 거절 (${rejected?.code ?? "unknown"})` });
    }
  } catch (error) {
    // SmtpError messages are already sanitized; anything else is scrubbed here.
    const message = error instanceof SmtpError ? error.message : sanitize(error instanceof Error ? error.message : "발송 실패");
    for (const r of recipients) deliveries.push({ ...base(r), status: "failed", error_message: message });
  }
  summary.sent = deliveries.filter((d) => d.status === "sent").length;
  summary.failed = deliveries.length - summary.sent;
  const saved = await admin.from("media_alert_deliveries").insert(deliveries);
  if (saved.error) throw new Error("알림 발송 이력 저장 실패");
  if (summary.sent) {
    const marked = await admin.from("media_obituary_matches").update({ notified_at: now().toISOString() }).in("id", matches.map((m) => m.id));
    if (marked.error) throw new Error("알림 완료 표시 실패");
  }
  return summary;
}
