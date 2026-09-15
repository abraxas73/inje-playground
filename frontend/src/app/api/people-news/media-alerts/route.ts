import { NextRequest, NextResponse } from "next/server";
import { requireNewsUser } from "@/lib/people-news/auth";
import type { MediaAlertSettings } from "@/types/media-directory";
const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const [subscription, delivery] = await Promise.all([
    supabase.from("media_alert_subscriptions").select("enabled,updated_at").eq("user_id", user.id).maybeSingle(),
    supabase.from("media_alert_deliveries").select("status,created_at,match_count,error_message").eq("recipient_user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (subscription.error || delivery.error) return NextResponse.json({ error: "알림 설정을 불러오지 못했습니다." }, { status: 500 });
  const body: MediaAlertSettings = {
    email: user.email ?? null, emailVerified: !!user.email_confirmed_at,
    enabled: subscription.data?.enabled === true, updatedAt: subscription.data?.updated_at ?? null,
    latestDelivery: delivery.data ?? null,
  };
  return NextResponse.json(body, noStore);
}

export async function PUT(request: NextRequest) {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  let body: { enabled?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "알림 수신 여부를 확인해 주세요." }, { status: 400 });
  if (body.enabled && (!auth.user.email || !auth.user.email_confirmed_at)) return NextResponse.json({ error: "계정 이메일 인증 후 알림을 켤 수 있습니다." }, { status: 400 });
  const { data, error } = await auth.supabase.rpc("set_media_alert_subscription", { p_enabled: body.enabled });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "인사·부고 접근 권한이 필요합니다." : "알림 설정을 저장하지 못했습니다." }, { status: error.code === "42501" ? 403 : 500 });
  const saved = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ enabled: saved?.enabled === true, updatedAt: saved?.updated_at ?? null }, noStore);
}
