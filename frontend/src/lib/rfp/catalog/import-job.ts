import type { SupabaseClient } from "@supabase/supabase-js";
import { confluenceConfig, fetchConfluencePage, type ConfluenceConfig, type ConfluencePage } from "./confluence";
import { storageToText } from "./storage-text";
import { createAnthropicFeatureCall, extractFeatures, type FeatureExtractCall, type SolutionInfo } from "./extract-features";
import { extractFeaturesByRules, rulesNote } from "./extract-rules";
import { parseXlsxFeatures, xlsxNote, type XlsxParseResult } from "./xlsx-features";
import { mergeFeatures, type ExistingFeature, type IncomingFeature } from "./merge-features";
import { downloadFile, GraphError } from "@/lib/ms/graph-drive";
import type { EngineKind } from "../mapping/types";
import type { RfpSourceKind } from "@/types/rfp";

export interface ImportOptions {
  /** rules: 규칙 파서(기본) / llm: Claude 기능 추출(confluence 소스만. xlsx는 항상 파서) */
  engine: EngineKind;
  /** xlsx 소스가 있을 때 라우트가 발급해 넘기는 Graph access 토큰. 메모리에만 두고 로그·DB에 쓰지 않는다 */
  graphToken?: string;
}

export interface ImportDeps {
  fetchPage: (cfg: ConfluenceConfig, pageId: string) => Promise<ConfluencePage>;
  makeCall: (solution: SolutionInfo) => FeatureExtractCall;
  download: (token: string, driveId: string, itemId: string) => Promise<Buffer>;
  parseXlsx: (buffer: Buffer) => Promise<XlsxParseResult>;
  extractRules: typeof extractFeaturesByRules;
}

const DEFAULT_DEPS: ImportDeps = {
  fetchPage: (cfg, pageId) => fetchConfluencePage(cfg, pageId),
  makeCall: (solution) => createAnthropicFeatureCall(solution),
  download: (token, driveId, itemId) => downloadFile(token, driveId, itemId),
  parseXlsx: (buffer) => parseXlsxFeatures(buffer),
  extractRules: extractFeaturesByRules,
};

interface ExistingRow {
  id: string;
  name: string;
  name_norm: string;
  edited: boolean;
  sort_order: number;
}

interface SourceRow {
  id: string;
  kind: RfpSourceKind;
  url: string;
  page_id: string;
  drive_id: string | null;
  title: string | null;
}

const ATLASSIAN_ENV_MISSING = "ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다.";

function describeError(e: unknown): string {
  if (e instanceof GraphError) return e.status === 404 ? "파일이 없습니다(삭제·이동)." : `SharePoint 응답 오류(${e.status})`;
  return e instanceof Error ? e.message : String(e);
}

/** 소스 하나에서 기능 목록을 뽑는다. 종류·엔진에 따라 파서를 고른다(4단계 스펙 §4.5). */
async function extractFromSource(
  src: SourceRow, opts: ImportOptions, deps: ImportDeps, cfg: ConfluenceConfig | null, call: FeatureExtractCall | null,
): Promise<{ features: IncomingFeature[]; notes: string[]; title?: string; version?: number }> {
  if (src.kind === "xlsx") {
    if (!opts.graphToken) throw new Error("Microsoft 토큰이 없습니다. 가져오기를 다시 시작하세요.");
    if (!src.drive_id) throw new Error("xlsx 소스에 drive_id가 없습니다. 소스를 지우고 다시 등록하세요.");
    const buffer = await deps.download(opts.graphToken, src.drive_id, src.page_id);
    const r = await deps.parseXlsx(buffer);
    return { features: r.features, notes: [xlsxNote(r), ...r.warnings] };
  }
  if (!cfg) throw new Error(ATLASSIAN_ENV_MISSING);
  const page = await deps.fetchPage(cfg, src.page_id);
  const text = storageToText(page.storageHtml);
  if (!text) return { features: [], notes: ["페이지 본문이 비어 있습니다."], title: page.title, version: page.version };
  if (opts.engine === "rules") {
    const r = deps.extractRules(text);
    return { features: r.features, notes: [rulesNote(r), ...r.warnings], title: page.title, version: page.version };
  }
  if (!call) throw new Error("Claude 호출이 준비되지 않았습니다.");
  const r = await extractFeatures(text, call);
  return { features: r.features, notes: ["Claude 추출", ...r.warnings], title: page.title, version: page.version };
}

/**
 * 스펙 §4.5 잡. 소스마다 (confluence → REST → 텍스트 → 규칙 파서 | Claude) / (xlsx → Graph 내려받기 → 파서) → 키워드 시드 → 병합.
 * 소스 하나가 실패해도 다음 소스는 계속하고 어떤 경우에도 import_status를 ready 또는 failed로 끝낸다(running으로 남기지 않는다).
 */
export async function runImport(admin: SupabaseClient, solutionCode: string, sourceIds: string[], opts: ImportOptions, deps: ImportDeps = DEFAULT_DEPS): Promise<void> {
  if (!sourceIds.length) return;
  const failAll = async (message: string) => {
    const { error } = await admin.from("rfp_solution_sources").update({ import_status: "failed", error: message.slice(0, 500) }).in("id", sourceIds);
    if (error) console.error("[rfp] catalog import status update failed", solutionCode, sourceIds, error.message);
  };
  const { data: sol, error: solError } = await admin.from("rfp_solutions").select("code, name, description").eq("code", solutionCode).maybeSingle();
  if (solError || !sol) return await failAll(solError?.message ?? "솔루션이 없습니다.");
  const { data: srcRows, error: srcError } = await admin.from("rfp_solution_sources").select("id, kind, url, page_id, drive_id, title").in("id", sourceIds);
  if (srcError) return await failAll(srcError.message);
  const sources = (srcRows ?? []) as SourceRow[];
  const cfg = confluenceConfig();

  let call: FeatureExtractCall | null = null;
  if (opts.engine === "llm" && sources.some((s) => s.kind === "confluence")) {
    try {
      call = deps.makeCall({ name: sol.name as string, description: (sol.description as string) ?? "" });
    } catch (e) {
      return await failAll(e instanceof Error ? e.message : String(e));
    }
  }

  for (const src of sources) {
    const fail = async (message: string) => {
      const { error } = await admin.from("rfp_solution_sources").update({ import_status: "failed", error: message.slice(0, 500) }).eq("id", src.id);
      if (error) console.error("[rfp] catalog import status update failed", solutionCode, src.id, error.message);
    };
    try {
      const extracted = await extractFromSource(src, opts, deps, cfg, call);

      const { data: existing, error: exError } = await admin
        .from("rfp_solution_features")
        .select("id, name, name_norm, edited, sort_order")
        .eq("solution_code", solutionCode);
      if (exError) throw new Error(exError.message);
      const rows = (existing ?? []) as ExistingRow[];
      const plan = mergeFeatures(
        rows.map<ExistingFeature>((r) => ({ id: r.id, name: r.name, nameNorm: r.name_norm, edited: r.edited })),
        extracted.features,
      );
      let sort = rows.reduce((m, r) => Math.max(m, r.sort_order), 0);
      if (plan.toInsert.length) {
        const { error } = await admin.from("rfp_solution_features").insert(
          plan.toInsert.map((f) => ({
            solution_code: solutionCode, name: f.name, name_norm: f.nameNorm, description: f.description, keywords: f.keywords,
            evidence_url: src.url, source_id: src.id, sort_order: ++sort,
          })),
        );
        if (error) throw new Error(error.message);
      }
      for (const u of plan.toUpdate) {
        const { error } = await admin.from("rfp_solution_features").update({ description: u.description, keywords: u.keywords, evidence_url: src.url, source_id: src.id }).eq("id", u.id);
        if (error) throw new Error(error.message);
      }
      const notes = [...extracted.notes];
      if (plan.skippedEdited.length) notes.push(`사람이 고친 기능 ${plan.skippedEdited.length}개는 유지했습니다.`);
      const done: Record<string, unknown> = {
        import_status: "ready", error: null, note: notes.join(" ") || null,
        imported_at: new Date().toISOString(), feature_count: plan.toInsert.length + plan.toUpdate.length,
      };
      if (extracted.title !== undefined) done.title = extracted.title;
      if (extracted.version !== undefined) done.page_version = extracted.version;
      const { error: doneError } = await admin.from("rfp_solution_sources").update(done).eq("id", src.id);
      if (doneError) throw new Error(`상태 갱신 실패: ${doneError.message}`);
    } catch (e) {
      console.error("[rfp] catalog import failed", solutionCode, src.id, e instanceof Error ? e.message : e);
      await fail(describeError(e));
    }
  }
}
