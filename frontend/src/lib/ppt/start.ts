import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { newShareToken } from "@/lib/rfp/share";
import { runGeneration } from "@/lib/ppt/generate";
import { createAnthropicDeckLlm, LlmUnavailableError, type DeckLlm } from "@/lib/ppt/llm";
import { parseCreateRequest, provisionalTitle } from "@/lib/ppt/request";
import { clampSourceText, fetchUrlSource, UrlSourceError } from "@/lib/ppt/web-source";
import type { PptSourceImage } from "@/types/ppt";
import { confluenceSource, isCompanyConfluenceUrl } from "@/lib/confluence/ppt-source";
import { sharepointSource } from "@/lib/sharepoint/ppt-source";
import { isSharepointUrl } from "@/lib/sharepoint/core";
import { sourceKindFor } from "@/lib/ppt/source";
import { createPptServiceClient, PptServiceError, type PptServiceClient } from "@/lib/ppt/service";
import { failStaleVersions, hasActiveVersion, type TemplateRow } from "@/lib/ppt/store";
import { BUILTIN_TEMPLATE_LABEL } from "@/types/ppt";

export type StartDeckResult = { ok: true; deckId: string } | { ok: false; status: number; error: string };

/**
 * 덱 + v1 생성 요청(웹 POST /api/ppt/decks와 이노봇 ppt_create 공용). 원고 확인·덱·버전 행까지 만들고 생성은 after()에서 돈다 —
 * 요청 처리 중에 불러야 한다(호출한 라우트의 maxDuration이 생성 시간 상한).
 */
export async function startDeck(admin: SupabaseClient, owner: { userId: string; email: string }, body: unknown): Promise<StartDeckResult> {
  const err = (error: string, status: number): StartDeckResult => ({ ok: false, status, error });
  let parsed = parseCreateRequest(body);
  if (!parsed.ok) return err(parsed.error, parsed.status);
  // SharePoint·OneDrive 문서 링크는 본인 Microsoft 권한으로 내려받아 업로드 원고와 같은 흐름(docx 등은 텍스트, pptx는 /extract)
  if (parsed.kind === "url" && parsed.url && isSharepointUrl(parsed.url)) {
    const sp = await sharepointSource(admin, owner.userId, parsed.url);
    if (!sp.ok) return err(sp.error, sp.status);
    parsed = { ...parsed, kind: sourceKindFor(sp.fileName), url: null, storagePath: sp.storagePath, fileName: sp.fileName, includeImages: false };
  }
  // URL 원고는 여기서 바로 가져온다 — 못 가져오면 덱을 만들지 않고 사유를 돌려준다
  let fetched: { text: string; title: string | null; images: PptSourceImage[] } | null = null;
  if (parsed.kind === "url" && parsed.url && isCompanyConfluenceUrl(parsed.url)) {
    const cf = await confluenceSource(admin, owner.userId, parsed.url);
    if (!cf.ok) return err(cf.error, cf.status);
    fetched = { text: cf.text, title: cf.title, images: [] };
  } else if (parsed.kind === "url" && parsed.url) {
    try { fetched = await fetchUrlSource(parsed.url, undefined, { images: parsed.includeImages }); }
    catch (e) {
      if (e instanceof UrlSourceError) return err(e.message, e.status);
      return err(`페이지 본문을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 400);
    }
  }

  let deps: { llm: DeckLlm; service: PptServiceClient };
  try {
    deps = { llm: createAnthropicDeckLlm({ model: parsed.model ?? undefined }), service: createPptServiceClient() };
  } catch (e) {
    if (e instanceof LlmUnavailableError || e instanceof PptServiceError) return err(e.message, 500);
    throw e;
  }
  await failStaleVersions(admin);
  if (await hasActiveVersion(admin, owner.userId)) {
    return err("진행 중인 생성이 끝난 뒤 다시 시도하세요.", 409);
  }
  // 템플릿: 지정했으면 활성 행이어야 한다. 비우면 내장
  let template: Pick<TemplateRow, "id" | "name"> | null = null;
  if (parsed.templateId) {
    const { data } = await admin.from("ppt_templates").select("id, name").eq("id", parsed.templateId).eq("status", "active").maybeSingle();
    template = (data as Pick<TemplateRow, "id" | "name"> | null) ?? null;
    if (!template) return err("선택한 템플릿을 찾을 수 없거나 비활성화되었습니다.", 400);
  }

  const { data: deck, error: deckError } = await admin.from("ppt_decks")
    .insert({ owner_id: owner.userId, owner_email: owner.email, title: provisionalTitle({ title: parsed.title, fileName: parsed.fileName, text: fetched ? (fetched.title ?? parsed.url) : parsed.text }), share_token: newShareToken() })
    .select("id").single();
  if (deckError || !deck) return err(deckError?.message ?? "덱을 만들지 못했습니다.", 500);
  const deckId = (deck as { id: string }).id;
  const { data: version, error: versionError } = await admin.from("ppt_deck_versions")
    .insert({ deck_id: deckId, no: 1, status: "generating", source_kind: parsed.kind, source_text: fetched ? clampSourceText(fetched.text) : parsed.text, source_path: parsed.storagePath, source_name: fetched ? parsed.url : parsed.fileName, source_images: fetched?.images.length ? fetched.images : null, prompt: parsed.prompt, llm_model: deps.llm.model, template_id: template?.id ?? null, template_name: template?.name ?? BUILTIN_TEMPLATE_LABEL })
    .select("id").single();
  if (versionError || !version) {
    const { error: cleanupError } = await admin.from("ppt_decks").delete().eq("id", deckId);
    if (cleanupError) console.error("[ppt] 덱 정리 실패:", cleanupError.message);
    return err(versionError?.message ?? "버전을 만들지 못했습니다.", 500);
  }

  const versionId = (version as { id: string }).id;
  const hints = { title: parsed.title ?? undefined, dept: parsed.dept ?? undefined };
  after(async () => {
    await runGeneration(admin, versionId, { ...deps, hints });
  });
  return { ok: true, deckId };
}
