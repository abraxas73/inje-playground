import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadSettings } from "@/lib/settings-server";
import { listGroupMembers } from "@/lib/teams-graph";
import { fetchMembersFromWebhook } from "@/lib/teams-members-webhook";

/**
 * GET /api/teams/members — settings.teams_group_id 그룹의 멤버 조회.
 * 1) settings.teams_members_webhook_url 이 있으면 Power Automate 멤버 목록 흐름(관리자 동의 불필요) 우선
 * 2) 없으면 Microsoft Graph app-only(client credentials; GroupMember.Read.All + 관리자 동의 + env 시크릿)
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await loadSettings(supabase, [
    "teams_members_webhook_url",
    "teams_graph_client_id",
    "teams_tenant_id",
    "teams_group_id",
  ]);

  const webhookUrl = settings.teams_members_webhook_url?.trim();
  if (webhookUrl) {
    try {
      const members = await fetchMembersFromWebhook(webhookUrl, settings.teams_group_id);
      return NextResponse.json({ members, source: "webhook" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Teams 멤버 조회 실패";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const clientSecret = process.env.TEAMS_GRAPH_CLIENT_SECRET ?? "";

  const missing: string[] = [];
  if (!settings.teams_tenant_id) missing.push("teams_tenant_id");
  if (!settings.teams_graph_client_id) missing.push("teams_graph_client_id");
  if (!settings.teams_group_id) missing.push("teams_group_id");
  if (!clientSecret) missing.push("env TEAMS_GRAPH_CLIENT_SECRET");
  if (missing.length) {
    return NextResponse.json(
      {
        error:
          `Teams 설정이 누락되었습니다: ${missing.join(", ")} ` +
          `(또는 teams_members_webhook_url에 Power Automate 멤버 목록 흐름 URL을 설정하면 Graph 설정 없이 동작)`,
      },
      { status: 400 }
    );
  }

  try {
    const members = await listGroupMembers(
      {
        tenantId: settings.teams_tenant_id,
        clientId: settings.teams_graph_client_id,
        clientSecret,
      },
      settings.teams_group_id
    );
    return NextResponse.json({ members, source: "graph" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Teams 멤버 조회 실패";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
