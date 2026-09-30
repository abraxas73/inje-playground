import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { deckForRequest, shareUrlFor } from "@/lib/ppt/deck-access";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** PUT /api/ppt/decks/[id]/share {enabled} → {shareEnabled, shareUrl}. 소유자만. 토큰은 감사에 남기지 않는다. */
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const r = await deckForRequest(id, { ownerOnly: true });
  if (!r.ok) return r.response;
  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled(boolean)가 필요합니다." }, { status: 400 });
  const { error } = await r.auth.admin.from("ppt_decks").update({ share_enabled: body.enabled, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAudit(r.auth.admin, request, { userId: r.auth.userId, action: body.enabled ? "PPT 공유 켬" : "PPT 공유 끔", category: "ppt", detail: { deckId: id } });
  const deck = { ...r.deck, share_enabled: body.enabled };
  return NextResponse.json({ shareEnabled: body.enabled, shareUrl: shareUrlFor(request, deck) });
}
