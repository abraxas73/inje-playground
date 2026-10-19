import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadAppFavorites, saveAppFavorites, toggleAppFavorite, validPath } from "@/lib/app-favorites";

/** GET /api/users/favorites — 앱 페이지 즐겨찾기(계정 단위) */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try { return NextResponse.json({ items: await loadAppFavorites(auth.admin, auth.userId) }); } catch { return NextResponse.json({ error: "즐겨찾기를 불러오지 못했습니다." }, { status: 500 }); }
}

/** PUT {path, title, on} — 켜면 맨 앞에 넣고, 끄면 뺀다(최대 30) */
export async function PUT(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!validPath(b.path) || typeof b.on !== "boolean" || (b.on && (typeof b.title !== "string" || !b.title.trim() || b.title.length > 80))) {
    return NextResponse.json({ error: "즐겨찾기 정보가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const list = toggleAppFavorite(await loadAppFavorites(auth.admin, auth.userId), { path: b.path, title: typeof b.title === "string" ? b.title : "" }, b.on);
    await saveAppFavorites(auth.admin, auth.userId, list);
    return NextResponse.json({ items: list });
  } catch { return NextResponse.json({ error: "즐겨찾기를 저장하지 못했습니다." }, { status: 500 }); }
}
