import { NextRequest } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { resolveRef, type ItemRef } from "@/lib/sharepoint/client";
import { addFavorite, itemKey, removeFavorite, SharepointError, type Favorite } from "@/lib/sharepoint/core";
import { loadFavorites, saveFavorites } from "@/lib/sharepoint/favorites";
import { spFailure, spJson, withSharepoint } from "@/lib/sharepoint/route";
export const runtime = "nodejs";

/** GET /api/sharepoint/favorites — 내 즐겨찾기(링크만 저장, Graph 호출 없음) */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try { return spJson({ items: await loadFavorites(auth.admin, auth.userId) }); } catch (e) { return spFailure(e); }
}

const parseRef = (b: Record<string, unknown>): ItemRef | null =>
  typeof b.url === "string" && b.url.trim() ? { url: b.url.trim() } : typeof b.driveId === "string" && typeof b.id === "string" ? { driveId: b.driveId, id: b.id } : null;

/** POST {url} 또는 {driveId,id} — 본인 권한으로 해석해 앞에 넣는다(최대 30). 감사에는 건수만 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return withSharepoint(async (token, auth) => {
    const ref = parseRef(body);
    if (!ref) throw new SharepointError("문서 링크를 붙여 주세요.", 400);
    const item = await resolveRef(token, ref);
    const f: Favorite = { driveId: item.driveId, id: item.id, name: item.name, url: item.url, container: item.container, kind: item.kind, addedAt: new Date().toISOString() };
    const list = addFavorite(await loadFavorites(auth.admin, auth.userId), f);
    await saveFavorites(auth.admin, auth.userId, list);
    await logAudit(auth.admin, request, { userId: auth.userId, action: "SharePoint 즐겨찾기 추가", category: "sharepoint", detail: { count: list.length } });
    return { items: list, added: f };
  });
}

/** DELETE {driveId,id} */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.driveId !== "string" || typeof body.id !== "string") return spJson({ error: "지울 문서가 없습니다." }, 400);
  try {
    const list = removeFavorite(await loadFavorites(auth.admin, auth.userId), itemKey({ driveId: body.driveId, id: body.id }));
    await saveFavorites(auth.admin, auth.userId, list);
    await logAudit(auth.admin, request, { userId: auth.userId, action: "SharePoint 즐겨찾기 삭제", category: "sharepoint", detail: { count: list.length } });
    return spJson({ items: list });
  } catch (e) { return spFailure(e); }
}
