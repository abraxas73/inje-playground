import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

async function caller() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  if (profile?.role !== "user" && profile?.role !== "admin") return { ok: false as const, response: NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 }) };
  return { ok: true as const, supabase, user };
}

export async function GET() {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const [subscription, delivery, connection] = await Promise.all([
    supabase.from("yonhap_notice_subscriptions").select("enabled,send_time,next_send_at").eq("user_id", user.id).maybeSingle(),
    supabase.from("yonhap_notice_email_deliveries").select("status,finished_at,started_at,item_count").eq("user_id", user.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.rpc("yonhap_notice_mail_connection"),
  ]);
  if (subscription.error || delivery.error || connection.error) return NextResponse.json({ error: "수신 설정을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({
    email: user.email ?? null, emailVerified: !!user.email_confirmed_at,
    subscription: subscription.data ?? { enabled: false, send_time: "07:10:00", next_send_at: null },
    latestDelivery: delivery.data,
    mailReady: connection.data?.[0]?.ready === true,
    connectedEmail: connection.data?.[0]?.account_email ?? null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await caller();
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
  if (error) return NextResponse.json({ error: error.code === "55000" ? "로그인 이메일과 같은 Microsoft 계정을 연결하고 메일 발송 권한에 동의해 주세요." : "수신 설정을 저장하지 못했습니다." }, { status: error.code === "55000" ? 409 : 500 });
  return NextResponse.json({ subscription: Array.isArray(data) ? data[0] : data }, { headers: { "Cache-Control": "private, no-store" } });
}
