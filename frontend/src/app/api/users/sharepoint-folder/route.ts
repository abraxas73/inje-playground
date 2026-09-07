import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { parseFolderUrl, resolveFolderForUser } from "@/lib/ms/folder-route";
import { loadUserDefaultFolder, USER_SHAREPOINT_FOLDER_KEY } from "@/lib/rfp/user-folder";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/users/sharepoint-folder → {folder} — 내 SharePoint 업로드 기본 폴더 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ folder: await loadUserDefaultFolder(auth.admin, auth.userId) });
}

/**
 * PUT /api/users/sharepoint-folder {url} — 폴더 링크를 내 Microsoft 계정 권한으로 해석해 기본 폴더로 저장.
 * 프로젝트에 폴더가 지정돼 있지 않으면 업로드가 이 폴더를 쓴다.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const parsed = parseFolderUrl(body?.url);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const resolved = await resolveFolderForUser(auth.admin, auth.userId, parsed.url);
  if (!resolved.ok) return resolved.response;

  const { error } = await auth.admin.from("user_settings").upsert(
    { user_id: auth.userId, key: USER_SHAREPOINT_FOLDER_KEY, value: JSON.stringify(resolved.folder), updated_at: new Date().toISOString() },
    { onConflict: "user_id,key" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit(auth.admin, request, {
    userId: auth.userId, action: "SharePoint 기본 폴더 지정", category: "settings",
    detail: { folder: resolved.folder.name, webUrl: resolved.folder.webUrl },
  });
  return NextResponse.json({ folder: resolved.folder });
}

/** DELETE /api/users/sharepoint-folder — 기본 폴더 해제(프로젝트별 지정은 그대로) */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { error } = await auth.admin.from("user_settings").delete().eq("user_id", auth.userId).eq("key", USER_SHAREPOINT_FOLDER_KEY);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAudit(auth.admin, request, { userId: auth.userId, action: "SharePoint 기본 폴더 해제", category: "settings" });
  return new NextResponse(null, { status: 204 });
}
