import { NextResponse } from "next/server";
import { requireNewsUser } from "@/lib/people-news/auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { digestAppUrl, loadDigest } from "@/lib/people-news/load-digest";
import { loadMsConfig } from "@/lib/ms/config";
import { getAccessTokenForUser } from "@/lib/ms/connections";
import { sendUserDigest } from "@/lib/people-news/mail";

export const maxDuration = 90;
const headers = { "Cache-Control": "private, no-store" };

/** Read-only preview uses the exact production template; it does not send or claim a slot. */
export async function GET() {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  try {
    const to = new Date().toISOString();
    const from = new Date(Date.parse(to) - 86_400_000).toISOString();
    const { digest, count } = await loadDigest(createAdminClient(), from, to, digestAppUrl());
    return NextResponse.json({ ...digest, count, from, to }, { headers });
  } catch {
    return NextResponse.json({ error: "메일 미리보기를 불러오지 못했습니다." }, { status: 500, headers });
  }
}

/** Always sends to the verified caller, regardless of any client-provided body. */
export async function POST() {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  if (!auth.user.email || !auth.user.email_confirmed_at) return NextResponse.json({ error: "계정 이메일 인증이 필요합니다." }, { status: 400 });
  let deliveryId: string | undefined;
  const admin = createAdminClient();
  try {
    const appUrl = digestAppUrl();
    const config = await loadMsConfig(admin);
    if (!config.ok) throw new Error("Microsoft 메일 발송 설정이 필요합니다.");
    const claim = await auth.supabase.rpc("claim_yonhap_notice_send_now");
    if (claim.error) return NextResponse.json({ error: claim.error.code === "55000" ? "본인 Microsoft 계정을 연결하고 메일 발송 권한에 동의해 주세요." : "즉시 수신 요청을 처리하지 못했습니다." }, { status: claim.error.code === "55000" ? 409 : 500 });
    const job = claim.data?.[0];
    if (!job) return NextResponse.json({ error: "1분 후 다시 수신할 수 있습니다." }, { status: 429, headers: { "Retry-After": "60" } });
    deliveryId = job.delivery_id;
    const { digest, count } = await loadDigest(admin, job.period_from, job.period_to, appUrl);
    const token = await getAccessTokenForUser(admin, auth.user.id, { ...config.config, mail: true });
    const providerId = await sendUserDigest(token, auth.user.email, digest);
    const saved = await admin.from("yonhap_notice_manual_deliveries").update({ status: "sent", finished_at: new Date().toISOString(), item_count: count, provider_id: providerId }).eq("id", deliveryId);
    if (saved.error) throw new Error("메일 발송 결과 저장 실패");
    return NextResponse.json({ count, from: job.period_from, to: job.period_to }, { headers });
  } catch (error) {
    if (deliveryId) await admin.from("yonhap_notice_manual_deliveries").update({ status: "failed", finished_at: new Date().toISOString(), error_message: error instanceof Error ? error.message.slice(0, 200) : "발송 실패" }).eq("id", deliveryId);
    return NextResponse.json({ error: "메일 발송을 확인하지 못했습니다. 받은편지함을 확인하고 Microsoft 연결 상태를 확인해 주세요." }, { status: 502, headers });
  }
}
