import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

interface TeamData {
  name: string;
  members: { name: string; hasCard: boolean }[];
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { teams } = body as { teams: TeamData[] };

  if (!teams?.length) {
    return NextResponse.json({ error: "팀 정보가 필요합니다" }, { status: 400 });
  }

  // Build message
  const teamLines = teams.map((team) => {
    const memberNames = team.members
      .map((m) => m.hasCard ? `${m.name}(법카)` : m.name)
      .join(", ");
    return `**${team.name}** (${team.members.length}명): ${memberNames}`;
  });

  const message = [
    `👥 팀 구성 결과`,
    ``,
    ...teamLines,
  ].join("\n");

  // Get webhook URL from settings
  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["dooray_hook_url"]);

  const settings: Record<string, string> = {};
  for (const row of settingsRows || []) {
    settings[row.key] = row.value;
  }

  const results = { webhook_sent: false };

  if (settings.dooray_hook_url) {
    try {
      const hookRes = await fetch(settings.dooray_hook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botName: "팀봇",
          botIconImage: "https://static.dooray.com/static_images/dooray-bot.png",
          text: message,
        }),
      });
      results.webhook_sent = hookRes.ok;
    } catch {
      // Webhook failed silently
    }
  }

  return NextResponse.json(results);
}
