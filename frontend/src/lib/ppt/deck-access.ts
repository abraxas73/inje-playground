/** 덱 라우트 공통: 세션·UUID·덱 존재·권한(소유자/admin 또는 소유자만). */
import { NextResponse } from "next/server";
import { requireUser, type RfpCaller } from "@/lib/rfp/require-user";
import { shareOrigin } from "@/lib/rfp/share";
import { canManage, loadDeck, type DeckRow } from "./store";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DeckAccess = { ok: true; auth: RfpCaller; deck: DeckRow } | { ok: false; response: NextResponse };

export async function deckForRequest(id: string, opts: { ownerOnly?: boolean } = {}): Promise<DeckAccess> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!UUID_RE.test(id)) return { ok: false, response: NextResponse.json({ error: "잘못된 덱 ID입니다." }, { status: 400 }) };
  const deck = await loadDeck(auth.admin, id);
  if (!deck) return { ok: false, response: NextResponse.json({ error: "덱이 없습니다." }, { status: 404 }) };
  if (opts.ownerOnly ? deck.owner_id !== auth.userId : !canManage(deck, auth.userId, auth.role)) {
    return { ok: false, response: NextResponse.json({ error: opts.ownerOnly ? "소유자만 할 수 있습니다." : "이 덱을 볼 권한이 없습니다." }, { status: 403 }) };
  }
  return { ok: true, auth: { userId: auth.userId, role: auth.role, admin: auth.admin }, deck };
}

export function shareUrlFor(request: Parameters<typeof shareOrigin>[0], deck: DeckRow): string | null {
  return deck.share_enabled ? `${shareOrigin(request)}/ppt/s/${deck.share_token}` : null;
}
