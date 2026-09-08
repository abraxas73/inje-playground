import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { getNotifier, personalNotifyOverrides, USER_NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { checkWebhookUrl } from "@/lib/notify/url-guard";
import { loadUserSettings } from "@/lib/settings-server";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/** 개인 채널 알림 웹훅(Teams 워크플로우 트리거 URL) */
const KEY = "teams_notify_webhook_url";

async function session() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

/**
 * GET /api/users/notify-channel → {url, configured}
 * URL 전체를 돌려준다 — 본인만 볼 수 있고(개인 설정), 붙여넣은 값을 고치려면 화면에 있어야 한다.
 */
export async function GET() {
  const { supabase, user } = await session();
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const s = await loadUserSettings(supabase, user.id, [KEY]);
  const url = s[KEY] ?? "";
  return NextResponse.json({ url, configured: !!url });
}

/** PUT /api/users/notify-channel {url} — 내 채널 알림을 이 워크플로우로 보낸다 */
export async function PUT(request: NextRequest) {
  const { supabase, user } = await session();
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const check = checkWebhookUrl(body?.url);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const { error } = await supabase.from("user_settings").upsert(
    { user_id: user.id, key: KEY, value: check.url, updated_at: new Date().toISOString() },
    { onConflict: "user_id,key" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 감사 기록에 URL 자체는 남기지 않는다(비밀에 준하는 값) — 호스트만
  await logAudit(supabase, request, {
    userId: user.id, userEmail: user.email ?? null,
    action: "개인 알림 채널 지정", category: "settings",
    detail: { host: new URL(check.url).host },
  });
  return NextResponse.json({ url: check.url, configured: true });
}

/** DELETE /api/users/notify-channel — 해제(전역 채널 설정으로 되돌아간다) */
export async function DELETE(request: NextRequest) {
  const { supabase, user } = await session();
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { error } = await supabase.from("user_settings").delete().eq("user_id", user.id).eq("key", KEY);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAudit(supabase, request, { userId: user.id, userEmail: user.email ?? null, action: "개인 알림 채널 해제", category: "settings" });
  return new NextResponse(null, { status: 204 });
}

/**
 * POST /api/users/notify-channel — 테스트 메시지 1건 발송(사용자가 버튼을 눌렀을 때만).
 * 저장된 개인 URL을 쓰고, 없으면 전역 채널 설정으로 보낸다(어디로 가는지 응답에 밝힌다).
 */
export async function POST(request: NextRequest) {
  const { supabase, user } = await session();
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const s = await loadUserSettings(supabase, user.id, USER_NOTIFIER_SETTING_KEYS);
  const personal = !!s[KEY];
  const notifier = await getNotifier(supabase, "notify", personalNotifyOverrides(s));
  if (!notifier.channelConfigured) {
    return NextResponse.json({ error: "채널 알림이 설정되지 않았습니다. 워크플로우 URL을 저장하거나 관리자에게 문의하세요." }, { status: 400 });
  }

  const at = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const sent = await notifier.sendChannel({
    title: "알림 채널 테스트",
    text: `${user.email ?? "사용자"} 님이 알림 채널을 확인했습니다 (${at}). 이 메시지가 보이면 RFP SharePoint 업로드·팀 구성 알림이 이 채널로 옵니다.`,
  });
  await logAudit(supabase, request, {
    userId: user.id, userEmail: user.email ?? null,
    action: "알림 채널 테스트 발송", category: "settings",
    detail: { personal, ok: sent.ok },
  });
  if (!sent.ok) {
    // 원격 응답 본문은 사용자에게 돌려주지 않는다(내부 주소 탐색 방지) — 상태 코드만 알린다.
    console.error("[notify] 개인 채널 테스트 실패", sent.error);
    const status = /(\b\d{3}\b)/.exec(sent.error ?? "")?.[1];
    return NextResponse.json({ error: `발송에 실패했습니다${status ? ` (응답 ${status})` : ""}. 워크플로우 URL을 확인하세요.` }, { status: 502 });
  }
  return NextResponse.json({ ok: true, personal });
}
