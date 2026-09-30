import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getNotifier, personalNotifyOverrides, USER_NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { loadUserSettings } from "@/lib/settings-server";
import { createServerSupabase } from "@/lib/supabase-server";
import { deckForRequest, shareUrlFor } from "@/lib/ppt/deck-access";
import { buildTeamsNotice } from "@/lib/ppt/notice";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/ppt/decks/[id]/teams {enableShare?} — 개인 채널(있으면) 또는 관리자 채널에 카드 게시.
 * 400 {code:"no_channel"} / 409 완료 버전 없음 / 502 전송 실패
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const r = await deckForRequest(id, { ownerOnly: true });
  if (!r.ok) return r.response;
  const { admin, userId } = r.auth;
  let deck = r.deck;
  if (!deck.current_version) return NextResponse.json({ error: "완료된 버전이 없습니다." }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { enableShare?: boolean };
  if (!deck.share_enabled && body.enableShare === true) {
    const { error } = await admin.from("ppt_decks").update({ share_enabled: true, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    deck = { ...deck, share_enabled: true };
    await logAudit(admin, request, { userId, action: "PPT 공유 켬", category: "ppt", detail: { deckId: id, via: "teams" } });
  }
  const supabase = await createServerSupabase();
  const userSettings = await loadUserSettings(supabase, userId, USER_NOTIFIER_SETTING_KEYS);
  const notifier = await getNotifier(supabase, "notify", personalNotifyOverrides(userSettings));
  if (!notifier.channelConfigured) {
    return NextResponse.json({ error: "Teams 알림 채널이 설정되지 않았습니다(설정 → 알림 채널).", code: "no_channel" }, { status: 400 });
  }
  const { data: v } = await admin.from("ppt_deck_versions").select("slide_count, sharepoint_url").eq("deck_id", id).eq("no", deck.current_version).maybeSingle();
  const version = (v ?? { slide_count: null, sharepoint_url: null }) as { slide_count: number | null; sharepoint_url: string | null };
  const shareUrl = shareUrlFor(request, deck);
  const msg = buildTeamsNotice({ title: deck.title || "제목 없음", slides: version.slide_count, no: deck.current_version, owner: deck.owner_email, shareUrl, sharepointUrl: version.sharepoint_url });
  const sent = await notifier.sendChannel(msg);
  if (!sent.ok) return NextResponse.json({ error: `Teams 전송에 실패했습니다: ${sent.error ?? ""}` }, { status: 502 });
  await logAudit(admin, request, { userId, action: "PPT Teams 공유", category: "ppt", detail: { deckId: id, no: deck.current_version, shared: !!shareUrl, sharepoint: !!version.sharepoint_url } });
  return NextResponse.json({ ok: true, shareUrl });
}
