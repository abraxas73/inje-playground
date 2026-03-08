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
  const { place_name, place_url, category_name, address, members, member_ids, send_to_channel } = body;

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

  // Get system settings + user settings (user overrides system)
  const settingsKeys = ["dooray_hook_url", "dooray_token", "dooray_messenger_url"];
  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", settingsKeys);

  const settings: Record<string, string> = {};
  for (const row of settingsRows || []) {
    settings[row.key] = row.value;
  }

  // User-level overrides
  const { data: userSettingsRows } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", user.id)
    .in("key", ["dooray_token"]);
  for (const row of userSettingsRows || []) {
    if (row.value) settings[row.key] = row.value;
  }

  const results: Record<string, unknown> = {
    decision: data,
    webhook_sent: false,
    personal_messages_sent: 0,
    dooray_messenger_url: settings.dooray_messenger_url || null,
    dm_errors: [] as string[],
  };

  // 1. Send to channel via incoming webhook (only if requested)
  if (send_to_channel !== false && settings.dooray_hook_url) {
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

    const dmErrors = results.dm_errors as string[];

    for (const memberId of member_ids as string[]) {
      try {
        // Send direct message to member
        const dmRes = await fetch(
          `${DOORAY_API_BASE}/messenger/v1/channels/direct-send`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              text: message,
              organizationMemberId: memberId,
            }),
          }
        );

        if (dmRes.ok) {
          sent++;
        } else {
          const errText = await dmRes.text();
          dmErrors.push(`dm(${memberId}): ${dmRes.status} ${errText}`);
        }
      } catch (e) {
        dmErrors.push(`exception(${memberId}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    results.personal_messages_sent = sent;
  }

  return NextResponse.json(results);
}
