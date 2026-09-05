import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createServerSupabase } from "@/lib/supabase-server";
import { getNotifier } from "@/lib/notify";
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
export async function POST(_request: NextRequest, { params }: Params) {
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
  const [notifier, names] = await Promise.all([getNotifier(supabase, "notify"), creatorNames(auth.admin, [auth.userId])]);
  const userName = names.get(auth.userId) ?? "사용자";

  try {
    const res = await uploadProjectXlsx(auth.admin, id, auth.userId, { app: cfg.config.app, encKey: cfg.config.encKey, notifier, userName });
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
