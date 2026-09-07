import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { getNotifier, personalNotifyOverrides, USER_NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { buildTeamResultMessage, type TeamResultInput } from "@/lib/notify/messages";
import { loadUserSettings } from "@/lib/settings-server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { teams } = body as { teams: TeamResultInput[] };

  if (!teams?.length) {
    return NextResponse.json({ error: "팀 정보가 필요합니다" }, { status: 400 });
  }

  const message = buildTeamResultMessage(teams);

  // 채널 알림 provider(settings.notify_provider)에 따라 Dooray Hook / Teams 웹훅으로 발송.
  // 개인 설정에 자기 워크플로우 URL이 있으면 그 채널로 보낸다.
  const userSettings = await loadUserSettings(supabase, user.id, USER_NOTIFIER_SETTING_KEYS);
  const notifier = await getNotifier(supabase, "notify", personalNotifyOverrides(userSettings));
  const results = { webhook_sent: false };

  if (notifier.channelConfigured) {
    const sent = await notifier.sendChannel({ title: "팀 구성 결과", botName: "팀봇", text: message });
    if (!sent.ok) console.warn("[notify] channel send failed:", sent.error);
    results.webhook_sent = sent.ok;
  }

  return NextResponse.json(results);
}
