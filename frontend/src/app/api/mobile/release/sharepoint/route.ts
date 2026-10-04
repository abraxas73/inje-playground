import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { resolveFolder, uploadFile } from "@/lib/ms/graph-drive";
import { graphTokenForUser } from "@/lib/ms/route-token";
import { mapGraphUploadError } from "@/lib/rfp/sharepoint";
import { APK_MIME, MOBILE_BUCKET, MOBILE_RELEASE_KEY, MOBILE_SHAREPOINT_FOLDER_KEY, apkFileName, parseMobileRelease } from "@/lib/mobile/release";

export const runtime = "nodejs";
export const maxDuration = 300;

type Caller = { ok: true; admin: SupabaseClient; userId: string } | { ok: false; response: NextResponse };

/** 릴리스 스크립트(Authorization: Bearer CRON_SECRET + {operator: 관리자 이메일}) 또는 관리자 세션. 어느 쪽이든 그 관리자의 Microsoft 연결로 올린다. */
async function caller(request: NextRequest): Promise<Caller> {
  const secret = process.env.CRON_SECRET ?? "";
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret && bearer === secret) {
    const a = adminClientOr500();
    if (!a.ok) return a;
    const body = (await request.json().catch(() => ({}))) as { operator?: string };
    const email = (body.operator ?? "").trim().toLowerCase();
    if (!email) return { ok: false, response: NextResponse.json({ error: "operator(관리자 이메일)가 필요합니다." }, { status: 400 }) };
    const { data } = await a.admin.from("user_profiles").select("user_id, role").eq("email", email).maybeSingle();
    const p = data as { user_id: string; role: string } | null;
    if (!p || p.role !== "admin") return { ok: false, response: NextResponse.json({ error: "operator는 관리자 계정이어야 합니다." }, { status: 403 }) };
    return { ok: true, admin: a.admin, userId: p.user_id };
  }
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  const a = adminClientOr500();
  if (!a.ok) return a;
  return { ok: true, admin: a.admin, userId: auth.userId };
}

/**
 * POST /api/mobile/release/sharepoint — 최신 Android 릴리스 APK 사본을 SharePoint 폴더(settings `mobile_sharepoint_folder` 링크)에
 * `innogrid-app-<version>.apk`로 올리고 링크를 `mobile_release.android.sharepointUrl`에 남긴다. 스토리지의 APK(수십 MB)는 서버가 읽어
 * Graph 업로드 세션으로 보낸다(브라우저·Vercel 본문 한도 우회). 400 {code:"no_folder"} / 409 릴리스 없음 / Graph 오류는 mapGraphUploadError.
 */
export async function POST(request: NextRequest) {
  const c = await caller(request);
  if (!c.ok) return c.response;
  const { admin, userId } = c;
  const { data: rows } = await admin.from("settings").select("key, value").in("key", [MOBILE_RELEASE_KEY, MOBILE_SHAREPOINT_FOLDER_KEY]);
  const map: Record<string, string> = {};
  for (const r of (rows ?? []) as Array<{ key: string; value: string }>) map[r.key] = r.value;
  const rel = parseMobileRelease(map[MOBILE_RELEASE_KEY]);
  if (!rel.android) return NextResponse.json({ error: "올라간 Android 릴리스가 없습니다." }, { status: 409 });
  const folderUrl = (map[MOBILE_SHAREPOINT_FOLDER_KEY] ?? "").trim();
  if (!folderUrl) {
    return NextResponse.json({ error: "SharePoint 폴더 링크를 먼저 저장하세요: mobile/scripts/release-mobile.sh sharepoint-folder <폴더 링크>", code: "no_folder" }, { status: 400 });
  }
  const token = await graphTokenForUser(admin, userId);
  if (!token.ok) return token.response;
  const { data: blob, error } = await admin.storage.from(MOBILE_BUCKET).download(rel.android.apkPath);
  if (error || !blob) return NextResponse.json({ error: `APK를 읽지 못했습니다: ${error?.message ?? ""}` }, { status: 500 });
  const fileName = apkFileName(rel.android.version);
  let item: Awaited<ReturnType<typeof uploadFile>>;
  let folderName = "";
  try {
    const folder = await resolveFolder(token.token, folderUrl);
    folderName = folder.name;
    item = await uploadFile(token.token, { driveId: folder.driveId, itemId: folder.itemId, fileName, buffer: Buffer.from(await blob.arrayBuffer()), contentType: APK_MIME });
  } catch (e) {
    const f = mapGraphUploadError(e);
    return NextResponse.json({ error: f.message }, { status: f.status });
  }
  // 원본 JSON을 그대로 두고 android 블록에 링크만 보탠다(스크립트가 쓰는 다른 필드 보존)
  const next = JSON.parse(map[MOBILE_RELEASE_KEY]) as { android: Record<string, unknown> };
  next.android = { ...next.android, sharepointUrl: item.webUrl, sharepointAt: new Date().toISOString() };
  const { error: saveError } = await admin.from("settings").upsert({ key: MOBILE_RELEASE_KEY, value: JSON.stringify(next) }, { onConflict: "key" });
  if (saveError) console.error("[mobile] SharePoint 링크 저장 실패:", saveError.message);
  await logAudit(admin, request, { userId, action: "모바일 APK SharePoint 업로드", category: "mobile", detail: { version: rel.android.version, build: rel.android.build, fileName, folder: folderName } });
  return NextResponse.json({ webUrl: item.webUrl, name: item.name, folderName, ...(saveError ? { warning: "업로드는 됐지만 링크 저장에 실패했습니다." } : {}) });
}
