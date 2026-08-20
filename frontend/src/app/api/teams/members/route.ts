import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadSettings } from "@/lib/settings-server";
import { listGroupMembers } from "@/lib/teams-graph";

/** GET /api/teams/members — settings.teams_group_id 그룹의 멤버를 Graph(app-only)로 조회 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await loadSettings(supabase, ["teams_graph_client_id", "teams_tenant_id", "teams_group_id"]);
  const clientSecret = process.env.TEAMS_GRAPH_CLIENT_SECRET ?? "";

  const missing: string[] = [];
  if (!settings.teams_tenant_id) missing.push("teams_tenant_id");
  if (!settings.teams_graph_client_id) missing.push("teams_graph_client_id");
  if (!settings.teams_group_id) missing.push("teams_group_id");
  if (!clientSecret) missing.push("env TEAMS_GRAPH_CLIENT_SECRET");
  if (missing.length) {
    return NextResponse.json(
      { error: `Teams 설정이 누락되었습니다: ${missing.join(", ")}` },
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
    return NextResponse.json({ members });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Teams 멤버 조회 실패";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
