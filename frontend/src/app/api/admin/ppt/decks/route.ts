import { NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { selectAll } from "@/lib/work-metrics/common";
import { DECK_COLUMNS, mapDeck, type DeckRow, type VersionRow } from "@/lib/ppt/store";
import { ownerLabels } from "@/lib/ppt/owner-label";
import type { PptAdminDecksResponse } from "@/types/ppt";

export const runtime = "nodejs";

const SUMMARY_COLUMNS = "id, deck_id, no, status, slide_count, created_at, llm_model, template_name, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write";

/** GET /api/admin/ppt/decks — 모든 사용자의 덱(1000행 상한 없이 끝까지) + 버전 수·비용 합. 소유자는 이메일 대신 "이름(팀)"(ownerLabel) */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const [decks, versions] = await Promise.all([
    selectAll<DeckRow>(() => a.admin.from("ppt_decks").select(DECK_COLUMNS, { count: "exact" }).order("updated_at", { ascending: false }).order("id")),
    selectAll<VersionRow>(() => a.admin.from("ppt_deck_versions").select(SUMMARY_COLUMNS, { count: "exact" }).order("deck_id").order("no", { ascending: false })),
  ]);
  if (decks.error || versions.error) return NextResponse.json({ error: (decks.error ?? versions.error)!.message }, { status: 500 });
  const byDeck = new Map<string, VersionRow[]>();
  for (const v of versions.data) byDeck.set(v.deck_id, [...(byDeck.get(v.deck_id) ?? []), v]);
  const labels = await ownerLabels(a.admin, decks.data.map((d) => ({ email: d.owner_email, userId: d.owner_id })));
  const res: PptAdminDecksResponse = {
    decks: decks.data.map((d) => {
      const vs = byDeck.get(d.id) ?? [];
      return { ...mapDeck(d, vs[0] ?? null, vs), ownerLabel: labels.get(d.owner_email) ?? d.owner_email, versionCount: vs.length };
    }),
  };
  return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
}
