import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getNotifier, personalNotifyOverrides, USER_NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { loadUserSettings } from "@/lib/settings-server";
import { createServerSupabase } from "@/lib/supabase-server";
import { deckForRequest, shareUrlFor } from "@/lib/ppt/deck-access";
import { buildTeamsNotice } from "@/lib/ppt/notice";
import { ownerLabels } from "@/lib/ppt/owner-label";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/ppt/decks/[id]/teams {enableShare?} — **내 알림 채널(설정 → 알림 채널 개인 워크플로우 URL)** 에 카드 게시. 관리자 채널로는 보내지 않는다.
 * 400 {code:"no_channel"} 채널 미설정 / 409 완료 버전 없음 / 502 전송 실패
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const r = await deckForRequest(id, { ownerOnly: true });
  if (!r.ok) return r.response;
  const { admin, userId } = r.auth;
  const deck = r.deck;
  if (!deck.current_version) return NextResponse.json({ error: "완료된 버전이 없습니다." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { enableShare?: boolean };
  const supabase = await createServerSupabase();
  const userSettings = await loadUserSettings(supabase, userId, USER_NOTIFIER_SETTING_KEYS);
  // 내 덱을 내 채널로만 — 관리자 공용 채널 폴백은 하지 않는다(개인 알림이 전사 채널에 올라가는 사고 방지)
  if (!userSettings.teams_notify_webhook_url?.trim()) {
    return NextResponse.json({ error: "내 알림 채널이 설정되지 않았습니다. 설정 → 알림 채널(개인 워크플로우 URL)을 먼저 등록하세요. PPT 공유는 내 채널로만 보냅니다.", code: "no_channel" }, { status: 400 });
  }
  const notifier = await getNotifier(supabase, "notify", personalNotifyOverrides(userSettings));
  if (!notifier.channelConfigured) {
    return NextResponse.json({ error: "알림 채널 URL이 올바르지 않습니다. 설정 → 알림 채널에서 다시 저장하세요.", code: "no_channel" }, { status: 400 });
  }
  const turnOn = !deck.share_enabled && body.enableShare === true;
  const shareUrl = deck.share_enabled || turnOn ? shareUrlFor(request, { ...deck, share_enabled: true }) : null;
  const { data: v } = await admin.from("ppt_deck_versions").select("slide_count, sharepoint_url").eq("deck_id", id).eq("no", deck.current_version).maybeSingle();
  const version = (v ?? { slide_count: null, sharepoint_url: null }) as { slide_count: number | null; sharepoint_url: string | null };
  const msg = buildTeamsNotice({ title: deck.title || "제목 없음", slides: version.slide_count, no: deck.current_version, owner: (await ownerLabels(admin, [{ email: deck.owner_email, userId: deck.owner_id }])).get(deck.owner_email) ?? deck.owner_email, shareUrl, sharepointUrl: version.sharepoint_url });
  const sent = await notifier.sendChannel(msg);
  if (!sent.ok) {
    console.error("[ppt] Teams 전송 실패:", sent.error);
    return NextResponse.json({ error: "Teams 전송에 실패했습니다. 알림 채널 설정을 확인하세요." }, { status: 502 });
  }
  let shareFailed = false;
  if (turnOn) {
    const { error } = await admin.from("ppt_decks").update({ share_enabled: true, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      console.error("[ppt] 공유 켜기 실패:", error.message);
      shareFailed = true;
    } else {
      await logAudit(admin, request, { userId, action: "PPT 공유 켬", category: "ppt", detail: { deckId: id, via: "teams" } });
    }
  }
  await logAudit(admin, request, { userId, action: "PPT Teams 공유", category: "ppt", detail: { deckId: id, no: deck.current_version, shared: !!shareUrl, sharepoint: !!version.sharepoint_url } });
  return NextResponse.json(shareFailed ? { ok: true, shareUrl, shareEnabled: false, warning: "공유 켜기에 실패했습니다" } : { ok: true, shareUrl });
}
