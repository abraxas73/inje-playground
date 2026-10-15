import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { shareUrlFor } from "@/lib/ppt/deck-access";
import { createServerSupabase } from "@/lib/supabase-server";
import { startDeck } from "@/lib/ppt/start";
import { ownerLabels } from "@/lib/ppt/owner-label";
import { DECK_COLUMNS, loadActiveTemplates, mapDeck, templateOptions, type DeckRow, type VersionRow } from "@/lib/ppt/store";
import type { PptListResponse } from "@/types/ppt";

export const runtime = "nodejs";
export const maxDuration = 800; // Pro + Fluid 상한. 긴 원고는 LLM 출력만 수 분 걸린다

/** GET /api/ppt/decks?all=1 — 내 덱, all=1이면 회사에 공유된 덱(share_enabled, 모든 사용자 — 전체 목록은 관리자 /admin/ppt). 최신 버전 요약 포함. */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const all = request.nextUrl.searchParams.get("all") === "1";
  let q = auth.admin.from("ppt_decks").select(DECK_COLUMNS).order("updated_at", { ascending: false }).limit(200);
  q = all ? q.eq("share_enabled", true) : q.eq("owner_id", auth.userId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const decks = (data ?? []) as DeckRow[];
  const byDeck = new Map<string, VersionRow[]>();
  if (decks.length) {
    // ponytail: 덱 200개 × 버전을 한 번에 읽는다(1000행 상한). 버전이 많이 쌓이면 current_version 조인으로 바꾼다.
    const { data: vs } = await auth.admin.from("ppt_deck_versions").select("id, deck_id, no, status, slide_count, created_at, llm_model, template_name, tokens_in, tokens_out, tokens_cache_read, tokens_cache_write")
      .in("deck_id", decks.map((d) => d.id)).order("no", { ascending: false }).limit(1000);
    for (const v of (vs ?? []) as VersionRow[]) byDeck.set(v.deck_id, [...(byDeck.get(v.deck_id) ?? []), v]);
  }
  // 공유된 덱 목록은 소유자 칸이 보이므로 이메일 대신 "이름(팀)"을, 남의 덱은 공유 뷰 주소를 붙인다
  const labels = all ? await ownerLabels(auth.admin, decks.map((d) => ({ email: d.owner_email, userId: d.owner_id }))) : null;
  const res: PptListResponse = {
    decks: decks.map((d) => { const vs = byDeck.get(d.id) ?? []; return { ...mapDeck(d, vs[0] ?? null, vs), ...(labels ? { ownerLabel: labels.get(d.owner_email) ?? d.owner_email, shareUrl: shareUrlFor(request, d) } : {}) }; }),
    llmAvailable: !!process.env.ANTHROPIC_API_KEY && !!process.env.PPT_SERVICE_URL && !!process.env.PPT_SERVICE_TOKEN,
    templates: templateOptions(await loadActiveTemplates(auth.admin)),
  };
  return NextResponse.json(res);
}

/** POST /api/ppt/decks — 덱 + v1 생성 요청. 201 {deckId} 뒤 after()에서 생성이 돈다(lib/ppt/start.ts). */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const r = await startDeck(auth.admin, { userId: auth.userId, email: user?.email ?? "" }, await request.json().catch(() => null));
  return r.ok ? NextResponse.json({ deckId: r.deckId }, { status: 201 }) : NextResponse.json({ error: r.error }, { status: r.status });
}
