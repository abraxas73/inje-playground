import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

const DOORAY_API_BASE = "https://api.dooray.com";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { place_name, place_url, category_name, address, members, member_ids } = body;

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

  // Build message
  const memberList = members.join(", ");
  const message = [
    `🍽️ 밥 먹으러 갑시다!`,
    ``,
    `📍 **${place_name}**`,
    address ? `📫 ${address}` : null,
    category_name ? `🏷️ ${category_name}` : null,
    `👥 ${memberList}`,
    place_url ? `🔗 ${place_url}` : null,
  ].filter(Boolean).join("\n");

  // Get settings
  const settingsKeys = ["dooray_hook_url", "dooray_token", "dooray_messenger_url"];
  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", settingsKeys);

  const settings: Record<string, string> = {};
  for (const row of settingsRows || []) {
    settings[row.key] = row.value;
  }

  const results = {
    decision: data,
    webhook_sent: false,
    personal_messages_sent: 0,
    dooray_messenger_url: settings.dooray_messenger_url || null,
  };

  // 1. Send to channel via incoming webhook
  if (settings.dooray_hook_url) {
    try {
      const hookRes = await fetch(settings.dooray_hook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botName: "점심봇",
          botIconImage: "https://static.dooray.com/static_images/dooray-bot.png",
          text: message,
        }),
      });
      results.webhook_sent = hookRes.ok;
    } catch {
      // Webhook failed silently
    }
  }

  // 2. Send personal messages to each member via Dooray Messenger API
  if (settings.dooray_token && member_ids?.length) {
    const token = settings.dooray_token;
    const headers = {
      Authorization: `dooray-api ${token}`,
      "Content-Type": "application/json",
    };
    let sent = 0;

    for (const memberId of member_ids as string[]) {
      try {
        // Step 1: Create or get DM channel
        const channelRes = await fetch(`${DOORAY_API_BASE}/messenger/v1/channels`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            type: "direct",
            organizationMemberIds: [memberId],
          }),
        });

        if (!channelRes.ok) continue;
        const channelData = await channelRes.json();
        const channelId = channelData.result?.id;
        if (!channelId) continue;

        // Step 2: Send message to the DM channel
        const msgRes = await fetch(`${DOORAY_API_BASE}/messenger/v1/channels/${channelId}/logs`, {
          method: "POST",
          headers,
          body: JSON.stringify({ text: message }),
        });
        if (msgRes.ok) sent++;
      } catch {
        // Individual DM failed silently
      }
    }
    results.personal_messages_sent = sent;
  }

  return NextResponse.json(results);
}
