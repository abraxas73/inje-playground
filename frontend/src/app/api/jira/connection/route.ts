import { NextRequest } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { JIRA_SITE, JiraError, loadConnection, sealToken, validateToken } from "@/lib/jira/client";
import { jiraFailure, jiraJson } from "@/lib/jira/route";
import { logAudit } from "@/lib/audit";
export const runtime = "nodejs";
export async function GET() {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const [connection, user] = await Promise.all([loadConnection(auth.admin, auth.userId), auth.admin.auth.admin.getUserById(auth.userId)]);
    if (user.error) throw new JiraError("로그인 이메일을 확인하지 못했습니다.", 503);
    return jiraJson({ connected: !!connection, site: JIRA_SITE, email: user.data.user?.email ?? "", ...(connection ? { accountName: connection.account_name, connectedAt: connection.connected_at } : {}) });
  } catch (e) { return jiraFailure(e); }
}
export async function POST(request: NextRequest) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 4096 || /\s/.test(token)) throw new JiraError("올바른 개인 API 토큰을 입력하세요.", 400);
    const user = await auth.admin.auth.admin.getUserById(auth.userId);
    const email = user.data.user?.email;
    if (user.error || !email) throw new JiraError("로그인 이메일을 확인하지 못했습니다.", 503);
    const account = await validateToken(email, token);
    const { error } = await auth.admin.from("jira_connections").upsert({ user_id: auth.userId, ...account, token_enc: sealToken(token), connected_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new JiraError("Jira 연결을 저장하지 못했습니다.", 503);
    await logAudit(auth.admin, request, { userId: auth.userId, action: "Jira 계정 연결", category: "auth" });
    return jiraJson({ connected: true, accountName: account.account_name });
  } catch (e) { return jiraFailure(e); }
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
