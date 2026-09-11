import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { loadDigest } from "@/lib/people-news/load-digest";
import { loadMsConfig } from "@/lib/ms/config";
import { getAccessTokenForUser } from "@/lib/ms/connections";
import { timingSafeEqual } from "node:crypto";
import { sendUserDigest } from "@/lib/people-news/mail";

export const runtime = "nodejs";
export const maxDuration = 180;

function cronAuthorized(request: Request): boolean {
  const secret = process.env.YONHAP_EMAIL_CRON_SECRET;
  if (!secret) return false;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let jobs: Array<{ delivery_id: string; recipient_id: string; recipient_email: string; period_from: string; period_to: string }> = [];
  try {
    const admin = createAdminClient();
    const config = await loadMsConfig(admin);
    if (!config.ok) throw new Error("Microsoft 메일 발송 설정이 누락되었습니다.");
    const msConfig = config.config;
    let sent = 0, failed = 0, cancelled = 0;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
    if (typeof appUrl !== "string" || !appUrl.startsWith("https://")) throw new Error("NEXT_PUBLIC_APP_URL이 HTTPS로 설정되어야 합니다.");
    const verifiedAppUrl: string = appUrl;
    // Configuration must be valid before advancing any user's schedule.
    const claimed = await admin.rpc("claim_yonhap_notice_emails", { p_limit: 10 });
    if (claimed.error) throw new Error("발송 예약 조회 실패");
    jobs = (claimed.data ?? []) as typeof jobs;
    if (!jobs.length) return NextResponse.json({ sent: 0, failed: 0, cancelled: 0 });
    const queue = [...jobs];
    async function worker() {
      while (queue.length) {
        const job = queue.shift()!;
        try {
          const { data: sub, error: subError } = await admin.from("yonhap_notice_subscriptions").select("enabled").eq("user_id", job.recipient_id).maybeSingle();
          if (subError) throw new Error("수신 설정 확인 실패");
          if (!sub?.enabled) {
            const cancelledResult = await admin.from("yonhap_notice_email_deliveries").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", job.delivery_id);
            if (cancelledResult.error) throw new Error("발송 취소 기록 실패");
            cancelled++; continue;
          }
          const { digest, count } = await loadDigest(admin, job.period_from, job.period_to, verifiedAppUrl);
          const token = await getAccessTokenForUser(admin, job.recipient_id, { app: msConfig.app, encKey: msConfig.encKey, mail: true });
          const providerId = await sendUserDigest(token, job.recipient_email, digest);
          const saved = await admin.from("yonhap_notice_email_deliveries").update({ status: "sent", finished_at: new Date().toISOString(), item_count: count, provider_id: providerId }).eq("id", job.delivery_id);
          if (saved.error) throw new Error("메일 발송 결과 저장 실패");
          sent++;
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message.slice(0, 200) : "메일 발송 실패";
          console.error("[yonhap-notice-email] 발송 실패", job.delivery_id, message);
          await admin.from("yonhap_notice_email_deliveries").update({ status: "failed", finished_at: new Date().toISOString(), error_message: message }).eq("id", job.delivery_id);
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    return NextResponse.json({ sent, failed, cancelled }, { status: failed ? 500 : 200 });
  } catch (error) {
    console.error("[yonhap-notice-email] 작업 실패", error instanceof Error ? error.message : "unknown");
    // Claimed rows remain visible as processing and are recovered by the next claim after 10 minutes.
    return NextResponse.json({ error: "메일 발송 작업에 실패했습니다." }, { status: 500 });
  }
}
