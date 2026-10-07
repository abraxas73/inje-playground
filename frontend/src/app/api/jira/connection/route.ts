import { NextRequest } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { JIRA_SITE, JiraError, loadConnection } from "@/lib/jira/client";
import { jiraFailure, jiraJson } from "@/lib/jira/route";
import { oauthConfigured } from "@/lib/jira/config";
import { logAudit } from "@/lib/audit";
export const runtime = "nodejs";
export async function GET() {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const [connection, user] = await Promise.all([loadConnection(auth.admin, auth.userId), auth.admin.auth.admin.getUserById(auth.userId)]);
    if (user.error) throw new JiraError("로그인 이메일을 확인하지 못했습니다.", 503);
    return jiraJson({ connected: connection?.auth_type === "oauth", configured: oauthConfigured(), needsReconnect: !!connection && connection.auth_type !== "oauth", site: JIRA_SITE, email: user.data.user?.email ?? "", ...(connection ? { accountName: connection.account_name, connectedAt: connection.connected_at } : {}) });
  } catch (e) { return jiraFailure(e); }
}
export async function POST() {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  return jiraJson({ error: "개인 API 토큰 연결 대신 Atlassian으로 연결을 이용하세요." }, 410);
}
export async function DELETE(request: NextRequest) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const { error } = await auth.admin.from("jira_connections").delete().eq("user_id", auth.userId);
    if (error) throw new JiraError("Jira 연결을 해제하지 못했습니다.", 503);
    await logAudit(auth.admin, request, { userId: auth.userId, action: "Jira 계정 연결 해제", category: "auth" });
    return jiraJson({ connected: false });
  } catch (e) { return jiraFailure(e); }
}
