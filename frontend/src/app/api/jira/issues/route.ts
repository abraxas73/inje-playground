import { NextRequest } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { JiraError, loadConnection, connectionClient } from "@/lib/jira/client";
import { myIssues } from "@/lib/jira/issues";
import { jiraFailure, jiraJson } from "@/lib/jira/route";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const scope = request.nextUrl.searchParams.get("scope") || "open";
    const cursor = request.nextUrl.searchParams.get("cursor") || undefined;
    if (!["open", "progress", "done", "all"].includes(scope) || (cursor?.length ?? 0) > 4000) throw new JiraError("목록 조건이 올바르지 않습니다.", 400);
    const connection = await loadConnection(auth.admin, auth.userId);
    if (!connection) return jiraJson({ connected: false, items: [], nextPageToken: null });
    return jiraJson({ connected: true, ...await myIssues(connectionClient(connection), scope, cursor) });
  } catch (e) { return jiraFailure(e); }
}
