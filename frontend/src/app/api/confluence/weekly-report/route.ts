import { NextRequest } from "next/server";
import { connectionClient, loadConnection } from "@/lib/jira/client";
import { withConfluence } from "@/lib/confluence/route";
import { collectWeekly, llmWeeklyDraft, plainWeeklyDraft, weeklyTitle } from "@/lib/confluence/weekly";
import { logAudit } from "@/lib/audit";
export const runtime = "nodejs";
export const maxDuration = 60;
/** POST /api/confluence/weekly-report {memo?} — 이번 주 Jira·Confluence 활동으로 주간보고 초안({title, markdown, llm, counts}). 올리기는 /api/confluence/pages */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { memo?: unknown };
  const memo = typeof body.memo === "string" ? body.memo.slice(0, 2000) : "";
  return withConfluence(async (c, auth) => {
    const conn = await loadConnection(auth.admin, auth.userId);
    const jira = conn ? await connectionClient(conn, auth.admin, auth.userId).catch(() => null) : null;
    const data = await collectWeekly({ jira, confluence: c.request, name: conn?.account_name ?? "" });
    let markdown = plainWeeklyDraft(data, memo);
    let llm = false;
    if (process.env.ANTHROPIC_API_KEY) {
      try { markdown = await llmWeeklyDraft(data, memo); llm = true; } catch (e) { console.error("[confluence] 주간보고 초안 실패:", e instanceof Error ? e.message.slice(0, 200) : e); }
    }
    await logAudit(auth.admin, request, { userId: auth.userId, action: "주간보고 초안", category: "confluence", detail: { jira: data.jira.length, pages: data.pages.length, llm } });
    return { title: weeklyTitle(data), markdown, llm, range: data.range, counts: { jira: data.jira.length, pages: data.pages.length } };
  });
}
