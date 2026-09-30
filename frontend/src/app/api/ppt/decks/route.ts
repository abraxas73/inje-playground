import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { newShareToken } from "@/lib/rfp/share";
import { createServerSupabase } from "@/lib/supabase-server";
import { runGeneration } from "@/lib/ppt/generate";
import { createAnthropicDeckLlm, LlmUnavailableError, type DeckLlm } from "@/lib/ppt/llm";
import { parseCreateRequest } from "@/lib/ppt/request";
import { createPptServiceClient, PptServiceError, type PptServiceClient } from "@/lib/ppt/service";
import { DECK_COLUMNS, failStaleVersions, hasActiveVersion, mapDeck, type DeckRow, type VersionRow } from "@/lib/ppt/store";
import type { PptListResponse } from "@/types/ppt";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET /api/ppt/decks?all=1 — 내 덱(admin은 all=1로 전체). 최신 버전 요약 포함. */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const all = request.nextUrl.searchParams.get("all") === "1" && auth.role === "admin";
  let q = auth.admin.from("ppt_decks").select(DECK_COLUMNS).order("updated_at", { ascending: false }).limit(200);
  if (!all) q = q.eq("owner_id", auth.userId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const decks = (data ?? []) as DeckRow[];
  const latest = new Map<string, VersionRow>();
  if (decks.length) {
    // ponytail: 덱 200개 × 버전을 한 번에 읽는다(1000행 상한). 버전이 많이 쌓이면 current_version 조인으로 바꾼다.
    const { data: vs } = await auth.admin.from("ppt_deck_versions").select("id, deck_id, no, status, slide_count, created_at")
      .in("deck_id", decks.map((d) => d.id)).order("no", { ascending: false }).limit(1000);
    for (const v of (vs ?? []) as VersionRow[]) if (!latest.has(v.deck_id)) latest.set(v.deck_id, v);
  }
  const res: PptListResponse = { decks: decks.map((d) => mapDeck(d, latest.get(d.id) ?? null)), llmAvailable: !!process.env.ANTHROPIC_API_KEY };
  return NextResponse.json(res);
}

/** POST /api/ppt/decks — 덱 + v1 생성 요청. 201 {deckId} 뒤 after()에서 생성이 돈다. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const parsed = parseCreateRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  let deps: { llm: DeckLlm; service: PptServiceClient };
  try {
    deps = { llm: createAnthropicDeckLlm(), service: createPptServiceClient() };
  } catch (e) {
    if (e instanceof LlmUnavailableError || e instanceof PptServiceError) return NextResponse.json({ error: e.message }, { status: 500 });
    throw e;
  }
  await failStaleVersions(auth.admin);
  if (await hasActiveVersion(auth.admin, auth.userId)) {
    return NextResponse.json({ error: "진행 중인 생성이 끝난 뒤 다시 시도하세요." }, { status: 409 });
  }
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: deck, error: deckError } = await auth.admin.from("ppt_decks")
    .insert({ owner_id: auth.userId, owner_email: user?.email ?? "", title: parsed.title ?? "", share_token: newShareToken() })
    .select("id").single();
  if (deckError || !deck) return NextResponse.json({ error: deckError?.message ?? "덱을 만들지 못했습니다." }, { status: 500 });
  const deckId = (deck as { id: string }).id;
  const { data: version, error: versionError } = await auth.admin.from("ppt_deck_versions")
    .insert({ deck_id: deckId, no: 1, status: "generating", source_kind: parsed.kind, source_text: parsed.text, source_path: parsed.storagePath, source_name: parsed.fileName, prompt: parsed.prompt })
    .select("id").single();
  if (versionError || !version) return NextResponse.json({ error: versionError?.message ?? "버전을 만들지 못했습니다." }, { status: 500 });

  const admin = auth.admin;
  const versionId = (version as { id: string }).id;
  const hints = { title: parsed.title ?? undefined, dept: parsed.dept ?? undefined };
  after(async () => {
    await runGeneration(admin, versionId, { ...deps, hints });
  });
  return NextResponse.json({ deckId }, { status: 201 });
}
