import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { createNotifier, NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { buildFoodDecisionMessage } from "@/lib/notify/messages";
import { parseRecipients } from "@/lib/notify/recipients";
import { loadSettings, loadUserSettings } from "@/lib/settings-server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { place_name, place_url, category_name, address, members, send_to_channel } = body;

  if (!place_name || !members?.length) {
    return NextResponse.json({ error: "장소와 구성원이 필요합니다" }, { status: 400 });
  }

  // Save decision
  const { data, error } = await supabase
    .from("food_decisions")
    .insert({
      place_name,
      place_url: place_url || null,
      category_name: category_name || null,
      address: address || null,
      members,
      decided_by: user.email,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const message = buildFoodDecisionMessage({ place_name, address, category_name, place_url, members });

  // 시스템 설정 + 사용자 개인 설정(dooray_token은 개인 값 우선)
  const settings = await loadSettings(supabase, [...NOTIFIER_SETTING_KEYS, "dooray_messenger_url"]);
  const userSettings = await loadUserSettings(supabase, user.id, ["dooray_token"]);
  const dmSettings = { ...settings, ...(userSettings.dooray_token ? { dooray_token: userSettings.dooray_token } : {}) };

  const channelNotifier = createNotifier("notify", settings);
  const dmNotifier = createNotifier("dm", dmSettings);

  const dmErrors: string[] = [];
  const results: Record<string, unknown> = {
    decision: data,
    webhook_sent: false,
    personal_messages_sent: 0,
    dooray_messenger_url: dmNotifier.provider === "dooray" ? settings.dooray_messenger_url || null : null,
    dm_errors: dmErrors,
  };

  // 1. 채널 발송 (요청 시에만)
  if (send_to_channel !== false && channelNotifier.channelConfigured) {
    const sent = await channelNotifier.sendChannel({ title: "점심 결정", botName: "점심봇", text: message });
    if (!sent.ok) console.warn("[notify] channel send failed:", sent.error);
    results.webhook_sent = sent.ok;
  }

  // 2. 개인 DM — recipients(신규) 또는 member_ids(기존)
  const recipients = parseRecipients(body);
  if (dmNotifier.directConfigured && recipients.length) {
    let sent = 0;
    for (const recipient of recipients) {
      const r = await dmNotifier.sendDirect(recipient, { text: message });
      if (r.ok) sent++;
      else if (r.error) dmErrors.push(r.error);
    }
    results.personal_messages_sent = sent;
  }

  return NextResponse.json(results);
}
