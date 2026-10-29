import { NextRequest } from "next/server";
import { logAudit } from "@/lib/audit";
import { addConfluenceFavorite, favoriteIdFrom, loadConfluenceFavorites, removeConfluenceFavorite, resolveConfluenceFavorite, saveConfluenceFavorites } from "@/lib/confluence/favorites";
import { withConfluence } from "@/lib/confluence/route";
import { jiraFailure, jiraJson } from "@/lib/jira/route";
import { requireUser } from "@/lib/rfp/require-user";
export const runtime = "nodejs";

/** GET /api/confluence/favorites — 내 문서 즐겨찾기(저장된 링크만, Atlassian 호출 없음) */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try { return jiraJson({ items: await loadConfluenceFavorites(auth.admin, auth.userId) }); } catch (e) { return jiraFailure(e); }
}

/** POST {id} 또는 {url} — 본인 권한으로 확인해 앞에 넣는다(최대 30). 감사에는 건수만 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return withConfluence(async (c, auth) => {
    const f = await resolveConfluenceFavorite(c.request, favoriteIdFrom(body));
    const list = addConfluenceFavorite(await loadConfluenceFavorites(auth.admin, auth.userId), f);
    await saveConfluenceFavorites(auth.admin, auth.userId, list);
    await logAudit(auth.admin, request, { userId: auth.userId, action: "Confluence 즐겨찾기 추가", category: "confluence", detail: { count: list.length } });
    return { items: list, added: f };
  });
}

/** DELETE {id} */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.id !== "string" || !body.id) return jiraJson({ error: "지울 문서가 없습니다." }, 400);
  try {
    const list = removeConfluenceFavorite(await loadConfluenceFavorites(auth.admin, auth.userId), body.id);
    await saveConfluenceFavorites(auth.admin, auth.userId, list);
    await logAudit(auth.admin, request, { userId: auth.userId, action: "Confluence 즐겨찾기 삭제", category: "confluence", detail: { count: list.length } });
    return jiraJson({ items: list });
  } catch (e) { return jiraFailure(e); }
}
