/** 공유 뷰 공통: 토큰 형식 → 세션(401 login_required) → 역할(user·admin) → 덱(share_enabled 또는 소유자/admin) → 완료 버전 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isShareToken } from "@/lib/rfp/share";
import { createAdminClient } from "@/lib/supabase-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { DECK_COLUMNS, VERSION_COLUMNS, type DeckRow, type VersionRow } from "./store";

export type SharedAccess = { ok: true; admin: SupabaseClient; deck: DeckRow; version: VersionRow } | { ok: false; response: NextResponse };

export async function resolveSharedDeck(token: string): Promise<SharedAccess> {
  const gone = (error: string) => ({ ok: false as const, response: NextResponse.json({ error }, { status: 404 }) });
  if (!isShareToken(token)) return gone("공유 링크가 없습니다.");
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "로그인이 필요합니다.", code: "login_required" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  const role = profile?.role;
  if (role !== "user" && role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 }) };
  }
  const admin = createAdminClient();
  const { data } = await admin.from("ppt_decks").select(DECK_COLUMNS).eq("share_token", token).maybeSingle();
  const deck = data as DeckRow | null;
  if (!deck) return gone("공유 링크가 없습니다.");
  if (!(deck.share_enabled || deck.owner_id === user.id || role === "admin")) return gone("공유가 꺼져 있습니다.");
  if (!deck.current_version) return gone("완료된 버전이 없습니다.");
  const { data: v } = await admin.from("ppt_deck_versions").select(VERSION_COLUMNS).eq("deck_id", deck.id).eq("no", deck.current_version).maybeSingle();
  if (!v) return gone("완료된 버전이 없습니다.");
  return { ok: true, admin, deck, version: v as VersionRow };
}
