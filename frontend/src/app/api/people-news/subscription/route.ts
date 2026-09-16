import { NextRequest, NextResponse } from "next/server";
import { requireNewsUser } from "@/lib/people-news/auth";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const [subscription, delivery] = await Promise.all([
    supabase.from("yonhap_notice_subscriptions").select("enabled,send_time,next_send_at").eq("user_id", user.id).maybeSingle(),
    supabase.from("yonhap_notice_email_deliveries").select("status,finished_at,started_at,item_count").eq("user_id", user.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (subscription.error || delivery.error) return NextResponse.json({ error: "수신 설정을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({
    email: user.email ?? null, emailVerified: !!user.email_confirmed_at,
    subscription: subscription.data ?? { enabled: false, send_time: "07:10:00", next_send_at: null },
    latestDelivery: delivery.data,
  }, { headers });
}

export async function PUT(request: NextRequest) {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "올바른 설정을 입력해 주세요." }, { status: 400 }); }
  if (typeof body?.enabled !== "boolean" || typeof body?.sendTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.sendTime)) {
    return NextResponse.json({ error: "수신 여부와 수신 시간을 확인해 주세요." }, { status: 400 });
  }
  if (body.enabled && (!auth.user.email || !auth.user.email_confirmed_at)) {
    return NextResponse.json({ error: "계정 이메일 인증 후 수신을 설정할 수 있습니다." }, { status: 400 });
  }
  const { data, error } = await auth.supabase.rpc("set_yonhap_notice_subscription", { p_enabled: body.enabled, p_send_time: body.sendTime });
  if (error) return NextResponse.json({ error: error.code === "22023" ? "계정 이메일 인증 후 수신을 설정할 수 있습니다." : "수신 설정을 저장하지 못했습니다." }, { status: error.code === "22023" ? 400 : 500 });
  return NextResponse.json({ subscription: Array.isArray(data) ? data[0] : data }, { headers });
}
