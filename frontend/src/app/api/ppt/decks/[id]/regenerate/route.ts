import { NextRequest, NextResponse, after } from "next/server";
import { deckForRequest } from "@/lib/ppt/deck-access";
import { runGeneration } from "@/lib/ppt/generate";
import { createAnthropicDeckLlm, LlmUnavailableError, type DeckLlm } from "@/lib/ppt/llm";
import { parseRegenerateRequest } from "@/lib/ppt/request";
import { createPptServiceClient, PptServiceError, type PptServiceClient } from "@/lib/ppt/service";
import { failStaleVersions, hasActiveVersion, loadVersions, loadVersionWithSource } from "@/lib/ppt/store";

export const runtime = "nodejs";
export const maxDuration = 300;
type Params = { params: Promise<{ id: string }> };

/** POST /api/ppt/decks/[id]/regenerate {feedback, baseVersion?} → 201 {no}. 소유자만. */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const r = await deckForRequest(id, { ownerOnly: true });
  if (!r.ok) return r.response;
  const parsed = parseRegenerateRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  let deps: { llm: DeckLlm; service: PptServiceClient };
  try {
    deps = { llm: createAnthropicDeckLlm(), service: createPptServiceClient() };
  } catch (e) {
    if (e instanceof LlmUnavailableError || e instanceof PptServiceError) return NextResponse.json({ error: e.message }, { status: 500 });
    throw e;
  }
  const { admin, userId } = r.auth;
  await failStaleVersions(admin);
  if (await hasActiveVersion(admin, userId)) return NextResponse.json({ error: "진행 중인 생성이 끝난 뒤 다시 시도하세요." }, { status: 409 });

  const versions = await loadVersions(admin, id);
  const baseNo = parsed.baseVersion ?? r.deck.current_version;
  const base = versions.find((v) => v.no === baseNo && v.status === "done");
  if (!base) return NextResponse.json({ error: `기준 버전 v${baseNo}이(가) 완료 상태가 아닙니다.` }, { status: 400 });
  const baseSrc = await loadVersionWithSource(admin, base.id);
  const no = Math.max(...versions.map((v) => v.no)) + 1;
  const { data, error } = await admin.from("ppt_deck_versions").insert({
    deck_id: id, no, status: "generating", source_kind: base.source_kind, source_text: baseSrc?.source_text ?? null, source_path: baseSrc?.source_path ?? null,
    source_name: base.source_name, prompt: base.prompt, feedback: parsed.feedback, base_version: baseNo,
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "버전을 만들지 못했습니다." }, { status: 500 });
  const versionId = (data as { id: string }).id;
  after(async () => {
    await runGeneration(admin, versionId, deps);
  });
  return NextResponse.json({ no }, { status: 201 });
}
