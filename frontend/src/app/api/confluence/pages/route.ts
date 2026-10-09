import { NextRequest } from "next/server";
import { JiraError } from "@/lib/jira/config";
import { createPage } from "@/lib/confluence/client";
import { withConfluence } from "@/lib/confluence/route";
import { logAudit } from "@/lib/audit";
export const runtime = "nodejs";
/** POST /api/confluence/pages {spaceKey, parentId?, title, markdown} — 본인 이름으로 페이지 만들기(회의록·주간보고). 감사엔 공간만 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { spaceKey?: unknown; parentId?: unknown; title?: unknown; markdown?: unknown } | null;
  return withConfluence(async (c, auth) => {
    if (!c.canWrite) throw new JiraError("Confluence 쓰기 권한을 추가하려면 설정에서 Atlassian 계정을 다시 연결하세요.", 409, "confluence_scope");
    if (typeof body?.spaceKey !== "string" || typeof body.title !== "string" || typeof body.markdown !== "string" || body.markdown.length > 100_000) throw new JiraError("공간·제목·본문을 확인하세요.", 400);
    const made = await createPage(c.request, { spaceKey: body.spaceKey, parentId: typeof body.parentId === "string" ? body.parentId : null, title: body.title, markdown: body.markdown });
    await logAudit(auth.admin, request, { userId: auth.userId, action: "Confluence 페이지 작성", category: "confluence", detail: { space: body.spaceKey } });
    return made;
  });
}
