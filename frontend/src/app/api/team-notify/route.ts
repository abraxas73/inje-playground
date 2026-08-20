import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { getNotifier } from "@/lib/notify";
import { buildTeamResultMessage, type TeamResultInput } from "@/lib/notify/messages";

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

  // 채널 알림 provider(settings.notify_provider)에 따라 Dooray Hook / Teams 웹훅으로 발송
  const notifier = await getNotifier(supabase, "notify");
  const results = { webhook_sent: false };

  if (notifier.channelConfigured) {
    const sent = await notifier.sendChannel({ title: "팀 구성 결과", botName: "팀봇", text: message });
    results.webhook_sent = sent.ok;
  }

  return NextResponse.json(results);
}
