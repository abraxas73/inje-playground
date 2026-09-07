import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { logAudit } from "@/lib/audit";
import { createServerSupabase } from "@/lib/supabase-server";
import { getNotifier, personalNotifyOverrides, USER_NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { loadUserSettings } from "@/lib/settings-server";
import { loadUserDefaultFolder } from "@/lib/rfp/user-folder";
import { creatorNames } from "@/lib/rfp/creators";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { OAuthError, oauthErrorMessage } from "@/lib/ms/oauth";
import { SharepointFlowError, uploadProjectXlsx } from "@/lib/rfp/sharepoint";

export const runtime = "nodejs";
export const maxDuration = 60;
type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/rfp/projects/[id]/sharepoint/upload — xlsx를 지정 폴더에 올리고 이력·알림(스펙 §5.2).
 * 200 {upload, notified, notifyError?} / 400 {code:no_folder|not_connected}·status / 403 / 404 / 409 {code:reconnect}·잠김 / 502
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });

  const supabase = await createServerSupabase();
  const cfg = await loadMsConfig(supabase);
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }
  // 개인 설정: 알림은 자기 워크플로우 URL로, 폴더는 프로젝트 지정이 없을 때 쓸 기본 폴더
  const userSettings = await loadUserSettings(supabase, auth.userId, USER_NOTIFIER_SETTING_KEYS);
  const [notifier, names, fallbackFolder] = await Promise.all([
    getNotifier(supabase, "notify", personalNotifyOverrides(userSettings)),
    creatorNames(auth.admin, [auth.userId]),
    loadUserDefaultFolder(auth.admin, auth.userId),
  ]);
  const userName = names.get(auth.userId) ?? "사용자";

  try {
    const res = await uploadProjectXlsx(auth.admin, id, auth.userId, { app: cfg.config.app, encKey: cfg.config.encKey, notifier, userName, fallbackFolder });
    // 감사: 사외 저장소로 파일이 나가는 행위라 파일명·알림 여부를 남긴다
    await logAudit(auth.admin, request, {
      userId: auth.userId, action: "SharePoint 업로드", category: "rfp",
      detail: { projectId: id, fileName: res.upload?.fileName, notified: res.notified },
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof SharepointFlowError) return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: e.status });
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 갱신 실패 ${e.code} (${e.status}): ${e.description}`);
      return NextResponse.json({ error: oauthErrorMessage(e.code) }, { status: 502 });
    }
    console.error("[rfp] SharePoint 업로드 실패:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "업로드에 실패했습니다." }, { status: 500 });
  }
}
