/**
 * 생성 파이프라인. generateDeck()은 DB를 모른다(테스트 대상). runGeneration()이 버전 행을 읽고 결과를 쓴다(after()에서 호출).
 * 스펙 §7.4·§7.6: LLM → parse → build → 오류 장표만 수정(최대 4회) / 재생성은 keep 패치, 안 맞으면 keep 없이 한 번 더.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { logAudit } from "@/lib/audit";
import { applyKeep, DeckParseError, deckTitle, hasKeep, parseDeckJson, parseSlidePatch, replaceSlide, todayLabel, type DeckJson } from "./deck-json";
import { addUsage, ZERO_USAGE, type DeckLlm, type LlmUsage } from "./llm";
import { fixMessages, generateMessages, jsonOnlyRetryMessages, regenerateMessages, systemBlocks, type SourceImagesInfo, type SourceInput } from "./prompt";
import { fetchImage, UrlSourceError } from "./web-source";
import type { PptSourceImage } from "@/types/ppt";
import type { PptBuildOk, PptExtractSlide, PptServiceClient } from "./service";
import { extractionText, sourceLengthError, textFromDocument } from "./source";
import { ACTIVE_STATUSES, deckPaths, loadDeck, loadPptRules, loadVersionWithSource, PPT_BUCKET, type VersionSourceRow } from "./store";

/** 빌드는 첫 오류에서 멈추므로 장표마다 한 회가 든다 — 30장 원고에서 2회는 모자랐다(2026-10-01). */
export const MAX_FIX_ROUNDS = 4;

export interface GenerateInput {
  source: SourceInput;
  prompt: string;
  title?: string | null;
  dept?: string | null;
  today: string;
  /** 재생성이면 기준 덱과 피드백 */
  baseDeck?: DeckJson;
  feedback?: string;
  /** 빌드 시도마다 새 서명 업로드 URL */
  uploads: () => Promise<{ pptxUrl: string; yamlUrl: string }>;
  /** pptx 원고면 서명 다운로드 URL과 /extract 결과 */
  sourceUrl?: string;
  extract?: PptExtractSlide[];
  /** 첫 /build 직전에 한 번 호출(status=building 기록용) */
  onBuild?: () => Promise<void>;
  /** 운영 설정의 LLM 규칙(없으면 기본본) */
  rules?: string;
  /** 업로드 템플릿(서명 URL·캐시 키). 없으면 내장 */
  templateUrl?: string;
  templateId?: string;
  /** URL 원고 이미지 {"N": 서명 URL}와 지시용 요약 */
  imageUrls?: Record<string, string>;
  images?: SourceImagesInfo;
}
export interface GenerateDeps { llm: DeckLlm; service: PptServiceClient }
export interface GenerateOutcome { deck: DeckJson; build: PptBuildOk; usage: LlmUsage; calls: number; model: string }

export class GenerationError extends Error {
  /** deck: 마지막으로 빌드를 시도한 덱(실패 원인 추적용, 버전 행 deck_json에 남긴다) */
  constructor(message: string, public readonly usage: LlmUsage, public readonly calls: number, public readonly deck?: DeckJson) { super(message); this.name = "GenerationError"; }
}

export async function generateDeck(input: GenerateInput, deps: GenerateDeps): Promise<GenerateOutcome> {
  let usage = ZERO_USAGE;
  let calls = 0;
  let lastDeck: DeckJson | undefined;
  const ask = async (system: Anthropic.TextBlockParam[], messages: Anthropic.MessageParam[]) => {
    const r = await deps.llm.complete(system, messages);
    usage = addUsage(usage, r.usage);
    calls += 1;
    return r;
  };
  try {
    const catalog = await deps.service.catalog();
    const system = systemBlocks(catalog, input.rules);
    let deck: DeckJson;
    let prior: Anthropic.MessageParam[];
    /** 질문 → 파싱. 비JSON이면 JSON만 달라고 한 번 재요청 */
    const askDeck = async (msgs: Anthropic.MessageParam[]): Promise<DeckJson> => {
      const first = await ask(system, msgs);
      try {
        return parseDeckJson(first.text, input.today);
      } catch (e) {
        if (!(e instanceof DeckParseError)) throw e;
        return parseDeckJson((await ask(system, jsonOnlyRetryMessages(msgs, first.text))).text, input.today);
      }
    };

    if (input.baseDeck && input.feedback) {
      prior = regenerateMessages({ source: input.source, baseDeck: input.baseDeck, feedback: input.feedback, today: input.today, withKeep: true });
      let parsed = await askDeck(prior);
      let merged = hasKeep(parsed) ? applyKeep(parsed, input.baseDeck) : { ok: true as const, deck: parsed };
      if (!merged.ok) {
        prior = regenerateMessages({ source: input.source, baseDeck: input.baseDeck, feedback: input.feedback, today: input.today, withKeep: false });
        parsed = await askDeck(prior);
        if (hasKeep(parsed)) throw new DeckParseError("재생성 응답에 keep이 남아 있습니다.");
        merged = { ok: true as const, deck: parsed };
      }
      deck = merged.deck;
    } else {
      prior = generateMessages({ source: input.source, prompt: input.prompt, title: input.title, dept: input.dept, today: input.today, images: input.images });
      deck = await askDeck(prior);
    }

    await input.onBuild?.();
    const failures: { key: string; line: string }[] = [];
    for (let round = 0; ; round += 1) {
      lastDeck = deck;
      const upload = await input.uploads();
      const result = await deps.service.build({ spec: deck, sourceUrl: input.sourceUrl, extract: input.extract, upload, templateUrl: input.templateUrl, templateId: input.templateId, imageUrls: input.imageUrls });
      if (result.ok) return { deck, build: result, usage, calls, model: deps.llm.model };
      if (round >= MAX_FIX_ROUNDS || (result.kind !== "spec" && result.kind !== "overflow")) throw new Error(result.message);
      const line = result.message.split("\n")[0];
      const key = `${result.section}/${result.slide}`;
      const history = failures.filter((f) => f.key === key).map((f) => f.line);
      failures.push({ key, line: line.replace(/^\[[^\]]*\]\s*/, "") });
      console.warn(`[ppt] 빌드 오류 수정 ${round + 1}/${MAX_FIX_ROUNDS} (${result.kind}, 섹션 ${result.section}, 장표 ${result.slide}): ${line}`);
      const fix = await ask(system, fixMessages({ prior, deck, error: result, catalog, history }));
      if (result.section !== null && result.slide !== null) {
        try { deck = replaceSlide(deck, result.section, result.slide, parseSlidePatch(fix.text)); }
        catch (e) {
          if (!(e instanceof DeckParseError)) throw e;
          deck = parseDeckJson(fix.text, input.today); // 슬라이드 대신 덱 전체를 돌려준 경우
        }
      } else deck = parseDeckJson(fix.text, input.today);
    }
  } catch (e) {
    if (e instanceof GenerationError) throw e;
    throw new GenerationError(e instanceof Error ? e.message : String(e), usage, calls, lastDeck);
  }
}

// ── DB를 도는 바깥 껍데기 ──────────────────────────────────────────────────

export interface RunDeps extends GenerateDeps { hints?: { title?: string | null; dept?: string | null }; now?: () => Date }

async function downloadBuffer(admin: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await admin.storage.from(PPT_BUCKET).download(path);
  if (error || !data) throw new Error(`원고 파일을 읽지 못했습니다: ${error?.message ?? ""}`);
  return Buffer.from(await data.arrayBuffer());
}

async function signedDownload(admin: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(PPT_BUCKET).createSignedUrl(path, 900);
  if (error || !data) throw new Error(`서명 URL을 만들지 못했습니다: ${error?.message ?? ""}`);
  return data.signedUrl;
}

async function logSave(q: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await q;
  if (error) console.error("[ppt] source_text 저장 실패:", error.message);
}

/** 원고 텍스트 확보. 파일·pptx는 처음 한 번만 추출해 source_text에 저장한다. */
/** URL 원고 이미지를 Storage에 받아 둔다(처음 한 번; 실패한 것은 path null). 빌드용 {"N": 서명 URL}과 지시용 요약을 돌려준다. */
async function resolveImages(admin: SupabaseClient, v: VersionSourceRow): Promise<{ imageUrls?: Record<string, string>; images?: SourceImagesInfo }> {
  const list = v.source_images ?? [];
  if (!list.length) return {};
  let changed = false;
  const next: PptSourceImage[] = [];
  for (const [i, im] of list.entries()) {
    if (im.path !== undefined) { next.push(im); continue; }
    try {
      const got = await fetchImage(im.url);
      const path = `images/${v.id}/${i + 1}.${got.ext}`;
      const { error } = await admin.storage.from(PPT_BUCKET).upload(path, got.bytes, { contentType: got.contentType, upsert: true });
      if (error) throw new Error(error.message);
      next.push({ ...im, path });
    } catch (e) {
      console.warn(`[ppt] 원고 이미지 ${i + 1} 받기 실패(${im.url.slice(0, 80)}): ${e instanceof UrlSourceError || e instanceof Error ? e.message : String(e)}`);
      next.push({ ...im, path: null });
    }
    changed = true;
  }
  if (changed) await logSave(admin.from("ppt_deck_versions").update({ source_images: next }).eq("id", v.id));
  const imageUrls: Record<string, string> = {};
  for (const [i, im] of next.entries()) if (im.path) imageUrls[String(i + 1)] = await signedDownload(admin, im.path);
  const available = Object.keys(imageUrls).map(Number);
  return available.length ? { imageUrls, images: { total: next.length, available } } : {};
}

async function resolveSource(admin: SupabaseClient, v: VersionSourceRow, service: PptServiceClient): Promise<{ source: SourceInput; sourceUrl?: string; extract?: PptExtractSlide[]; imageUrls?: Record<string, string>; images?: SourceImagesInfo }> {
  if (v.source_kind === "url") return { source: { kind: "url", text: v.source_text ?? "" }, ...(await resolveImages(admin, v)) };
  if (v.source_kind === "text") return { source: { kind: "text", text: v.source_text ?? "" } };
  if (!v.source_path) throw new Error("원고 파일 경로가 없습니다.");
  if (v.source_kind === "file") {
    let text = v.source_text;
    if (!text) {
      text = await textFromDocument(await downloadBuffer(admin, v.source_path), v.source_name ?? v.source_path);
      await logSave(admin.from("ppt_deck_versions").update({ source_text: text }).eq("id", v.id));
    }
    return { source: { kind: "file", text } };
  }
  const sourceUrl = await signedDownload(admin, v.source_path);
  let slides: PptExtractSlide[];
  if (v.source_text) slides = JSON.parse(v.source_text) as PptExtractSlide[];
  else {
    slides = await service.extract(sourceUrl);
    await logSave(admin.from("ppt_deck_versions").update({ source_text: JSON.stringify(slides) }).eq("id", v.id));
  }
  return { source: { kind: "pptx", text: extractionText(slides) }, sourceUrl, extract: slides };
}

/** 버전이 업로드 템플릿을 가리키면 서명 URL을 만든다(없으면 내장). 비활성화된 템플릿도 그 버전의 재생성에는 그대로 쓴다. */
async function resolveTemplate(admin: SupabaseClient, v: VersionSourceRow): Promise<{ templateUrl?: string; templateId?: string }> {
  if (!v.template_id) return {};
  const { data, error } = await admin.from("ppt_templates").select("storage_path").eq("id", v.template_id).maybeSingle();
  const path = (data as { storage_path?: string } | null)?.storage_path;
  if (error || !path) throw new Error(`템플릿(${v.template_name ?? v.template_id})을 찾을 수 없습니다.`);
  return { templateUrl: await signedDownload(admin, path), templateId: v.template_id };
}

export async function runGeneration(admin: SupabaseClient, versionId: string, deps: RunDeps): Promise<void> {
  try {
    await runLoaded(admin, versionId, deps);
  } catch (e) {
    console.error(`[ppt] 생성 처리 중 예기치 않은 오류 version=${versionId}:`, e instanceof Error ? e.message : String(e));
  }
}

async function runLoaded(admin: SupabaseClient, versionId: string, deps: RunDeps): Promise<void> {
  const startedAt = (deps.now ?? (() => new Date()))();
  const v = await loadVersionWithSource(admin, versionId);
  if (!v || v.status !== "generating") return;
  const deck = await loadDeck(admin, v.deck_id);
  if (!deck) return;
  const isRegen = v.base_version !== null && !!v.feedback;
  /** 진행 중인 버전만 마감한다(stale 정리가 먼저 failed로 바꿨다면 덮어쓰지 않음). 오류는 반환한다. */
  const finish = async (patch: Record<string, unknown>): Promise<string | null> => {
    const { error } = await admin.from("ppt_deck_versions")
      .update({ ...patch, finished_at: new Date().toISOString(), duration_ms: Date.now() - startedAt.getTime() })
      .eq("id", v.id).in("status", ACTIVE_STATUSES);
    if (error) console.error(`[ppt] 버전 상태 저장 실패 v${v.no}:`, error.message);
    return error?.message ?? null;
  };
  const bestEffort = async (label: string, q: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await q;
    if (error) console.error(`[ppt] ${label} 저장 실패 v${v.no}:`, error.message);
  };
  try {
    const src = await resolveSource(admin, v, deps.service);
    const tpl = await resolveTemplate(admin, v);
    const rules = (await loadPptRules(admin)) ?? undefined;
    const lengthError = sourceLengthError(src.source.text);
    if (lengthError) throw new Error(lengthError);
    let baseDeck: DeckJson | undefined;
    if (isRegen) {
      const { data } = await admin.from("ppt_deck_versions").select("deck_json").eq("deck_id", v.deck_id).eq("no", v.base_version!).maybeSingle();
      baseDeck = (data as { deck_json: DeckJson | null } | null)?.deck_json ?? undefined;
      if (!baseDeck) throw new Error(`기준 버전 v${v.base_version}의 덱을 찾을 수 없습니다.`);
    }
    const paths = deckPaths(v.deck_id, v.no);
    const uploads = async () => {
      const [p, y] = await Promise.all([
        admin.storage.from(PPT_BUCKET).createSignedUploadUrl(paths.pptx, { upsert: true }),
        admin.storage.from(PPT_BUCKET).createSignedUploadUrl(paths.yaml, { upsert: true }),
      ]);
      if (p.error || !p.data || y.error || !y.data) throw new Error(`업로드 URL을 만들지 못했습니다: ${p.error?.message ?? y.error?.message ?? ""}`);
      return { pptxUrl: p.data.signedUrl, yamlUrl: y.data.signedUrl };
    };
    await bestEffort("llm_model", admin.from("ppt_deck_versions").update({ llm_model: deps.llm.model }).eq("id", v.id));
    const out = await generateDeck({
      source: src.source, prompt: v.prompt ?? "", title: deps.hints?.title, dept: deps.hints?.dept, today: todayLabel(startedAt),
      baseDeck, feedback: v.feedback ?? undefined, uploads, sourceUrl: src.sourceUrl, extract: src.extract, rules, ...tpl, imageUrls: src.imageUrls, images: src.images,
      onBuild: () => bestEffort("building 상태", admin.from("ppt_deck_versions").update({ status: "building" }).eq("id", v.id)),
    }, deps);
    const saveError = await finish({
      status: "done", deck_json: out.deck, pptx_path: paths.pptx, yaml_path: paths.yaml, slide_count: out.build.slides, advisories: out.build.advisories,
      check_issues: out.build.issues, llm_calls: out.calls, tokens_in: out.usage.in, tokens_out: out.usage.out, tokens_cache_read: out.usage.cacheRead, tokens_cache_write: out.usage.cacheWrite, error: null,
    });
    if (saveError) {
      await finish({ status: "failed", error: `결과 저장 실패: ${saveError}` });
      return;
    }
    await bestEffort("덱 제목", admin.from("ppt_decks").update({ title: deckTitle(out.deck), current_version: v.no, updated_at: new Date().toISOString() }).eq("id", deck.id));
    await logAudit(admin, null, { userId: deck.owner_id, userEmail: deck.owner_email, action: isRegen ? "PPT 재생성" : "PPT 생성", category: "ppt", detail: { deckId: deck.id, no: v.no, slides: out.build.slides, calls: out.calls, tokens: out.usage } });
  } catch (e) {
    const g = e instanceof GenerationError ? e : null;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[ppt] 생성 실패 deck=${deck.id} v${v.no}:`, message);
    await finish({ status: "failed", error: message, deck_json: g?.deck ?? null, llm_calls: g?.calls ?? 0, tokens_in: g?.usage.in ?? 0, tokens_out: g?.usage.out ?? 0, tokens_cache_read: g?.usage.cacheRead ?? 0, tokens_cache_write: g?.usage.cacheWrite ?? 0 });
    await logAudit(admin, null, { userId: deck.owner_id, userEmail: deck.owner_email, action: "PPT 생성 실패", category: "ppt", detail: { deckId: deck.id, no: v.no, error: message.slice(0, 300) } });
  }
}
