import { NextRequest } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { JiraError, loadConnection, connectionClient } from "@/lib/jira/client";
import { issueDetail, updateIssue } from "@/lib/jira/issues";
import { jiraFailure, jiraJson } from "@/lib/jira/route";
import { logAudit } from "@/lib/audit";
export const runtime = "nodejs";
type Context = { params: Promise<{ key: string }> };
export async function GET(_request: NextRequest, context: Context) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const connection = await loadConnection(auth.admin, auth.userId);
    if (!connection) throw new JiraError("Jira 계정을 먼저 연결하세요.", 409, "not_connected");
    const { key } = await context.params;
    return jiraJson(await issueDetail(connectionClient(connection), connection.account_id, key));
  } catch (e) { return jiraFailure(e); }
}
export async function POST(request: NextRequest, context: Context) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const connection = await loadConnection(auth.admin, auth.userId);
    if (!connection) throw new JiraError("Jira 계정을 먼저 연결하세요.", 409, "not_connected");
    const { key } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new JiraError("요청이 올바르지 않습니다.", 400);
    await updateIssue(connectionClient(connection), connection.account_id, key, body);
    await logAudit(auth.admin, request, { userId: auth.userId, action: body.action === "comment" ? "Jira 댓글 작성" : "Jira 상태 변경", category: "jira", detail: { key } });
    return jiraJson({ ok: true });
  } catch (e) { return jiraFailure(e); }
}
