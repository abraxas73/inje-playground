import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { deckForRequest, shareUrlFor } from "@/lib/ppt/deck-access";
import { loadVersions, mapDeck, mapVersion, PPT_BUCKET } from "@/lib/ppt/store";
import { ownerLabels } from "@/lib/ppt/owner-label";
import type { PptDeckDetail, PptSourceImage, PptStatusResponse } from "@/types/ppt";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** GET /api/ppt/decks/[id]?fields=status — 상세(버전 포함) 또는 상태만 */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const r = await deckForRequest(id);
  if (!r.ok) return r.response;
  const versions = await loadVersions(r.auth.admin, id);
  if (request.nextUrl.searchParams.get("fields") === "status") {
    const res: PptStatusResponse = { versions: versions.map((v) => ({ no: v.no, status: v.status, error: v.error })) };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  }
  const latest = versions.length ? versions[versions.length - 1] : null;
  const ownerLabel = (await ownerLabels(r.auth.admin, [{ email: r.deck.owner_email, userId: r.deck.owner_id }])).get(r.deck.owner_email);
  const res: PptDeckDetail = {
    deck: { ...mapDeck(r.deck, latest), ownerLabel, shareUrl: shareUrlFor(request, r.deck), canManage: r.deck.owner_id !== null && r.deck.owner_id === r.auth.userId },
    versions: versions.map(mapVersion),
  };
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}

/** DELETE /api/ppt/decks/[id] — Storage 파일 → 덱(버전 cascade). 감사 "PPT 삭제" */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const r = await deckForRequest(id);
  if (!r.ok) return r.response;
  const { admin, userId } = r.auth;
  const { data } = await admin.from("ppt_deck_versions").select("pptx_path, yaml_path, source_path, source_images").eq("deck_id", id);
  const paths = ((data ?? []) as { pptx_path: string | null; yaml_path: string | null; source_path: string | null; source_images: PptSourceImage[] | null }[])
    .flatMap((v) => [v.pptx_path, v.yaml_path, v.source_path, ...(v.source_images ?? []).map((i) => i.path)]).filter((p): p is string => !!p);
  if (paths.length) {
    const { error } = await admin.storage.from(PPT_BUCKET).remove(paths);
    if (error) console.error("[ppt] 파일 삭제 실패:", error.message);
  }
  const { error } = await admin.from("ppt_decks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAudit(admin, request, { userId, action: "PPT 삭제", category: "ppt", detail: { deckId: id, title: r.deck.title, files: paths.length } });
  return NextResponse.json({ ok: true });
}
