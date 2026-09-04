import type { SupabaseClient } from "@supabase/supabase-js";
import { confluenceConfig, fetchConfluencePage, type ConfluenceConfig, type ConfluencePage } from "./confluence";
import { storageToText } from "./storage-text";
import { createAnthropicFeatureCall, extractFeatures, type FeatureExtractCall, type SolutionInfo } from "./extract-features";
import { mergeFeatures, type ExistingFeature } from "./merge-features";

export interface ImportDeps {
  fetchPage: (cfg: ConfluenceConfig, pageId: string) => Promise<ConfluencePage>;
  makeCall: (solution: SolutionInfo) => FeatureExtractCall;
}

const DEFAULT_DEPS: ImportDeps = {
  fetchPage: (cfg, pageId) => fetchConfluencePage(cfg, pageId),
  makeCall: (solution) => createAnthropicFeatureCall(solution),
};

interface ExistingRow {
  id: string;
  name: string;
  name_norm: string;
  edited: boolean;
  sort_order: number;
}

/**
 * 스펙 §3.2 잡. 소스마다 Confluence 조회 → 텍스트 → 기능 추출 → 병합. 소스 하나가 실패해도 다음 소스는 계속하고
 * 어떤 경우에도 import_status를 ready 또는 failed로 끝낸다(running으로 남기지 않는다).
 */
export async function runImport(admin: SupabaseClient, solutionCode: string, sourceIds: string[], deps: ImportDeps = DEFAULT_DEPS): Promise<void> {
  if (!sourceIds.length) return;
  const failAll = async (message: string) => {
    const { error } = await admin.from("rfp_solution_sources").update({ import_status: "failed", error: message.slice(0, 500) }).in("id", sourceIds);
    if (error) console.error("[rfp] catalog import status update failed", solutionCode, sourceIds, error.message);
  };
  const cfg = confluenceConfig();
  if (!cfg) return await failAll("ATLASSIAN_SITE·ATLASSIAN_EMAIL·ATLASSIAN_API_TOKEN 환경 변수가 설정되지 않았습니다.");
  const { data: sol, error: solError } = await admin.from("rfp_solutions").select("code, name, description").eq("code", solutionCode).maybeSingle();
  if (solError || !sol) return await failAll(solError?.message ?? "솔루션이 없습니다.");
  let call: FeatureExtractCall;
  try {
    call = deps.makeCall({ name: sol.name as string, description: (sol.description as string) ?? "" });
  } catch (e) {
    return await failAll(e instanceof Error ? e.message : String(e));
  }

  for (const sourceId of sourceIds) {
    const fail = async (message: string) => {
      const { error } = await admin.from("rfp_solution_sources").update({ import_status: "failed", error: message.slice(0, 500) }).eq("id", sourceId);
      if (error) console.error("[rfp] catalog import status update failed", solutionCode, sourceId, error.message);
    };
    try {
      const { data: src, error: srcError } = await admin.from("rfp_solution_sources").select("id, url, page_id").eq("id", sourceId).maybeSingle();
      if (srcError) throw new Error(srcError.message);
      if (!src) continue;
      const page = await deps.fetchPage(cfg, src.page_id as string);
      const text = storageToText(page.storageHtml);
      const extracted = text ? await extractFeatures(text, call) : { features: [], warnings: ["페이지 본문이 비어 있습니다."] };

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
            solution_code: solutionCode, name: f.name, name_norm: f.nameNorm, description: f.description,
            evidence_url: src.url as string, source_id: sourceId, sort_order: ++sort,
          })),
        );
        if (error) throw new Error(error.message);
      }
      for (const u of plan.toUpdate) {
        const { error } = await admin.from("rfp_solution_features").update({ description: u.description, evidence_url: src.url as string, source_id: sourceId }).eq("id", u.id);
        if (error) throw new Error(error.message);
      }
      const notes = [...extracted.warnings];
      if (plan.skippedEdited.length) notes.push(`사람이 고친 기능 ${plan.skippedEdited.length}개는 유지했습니다.`);
      const { error: doneError } = await admin
        .from("rfp_solution_sources")
        .update({
          import_status: "ready", error: null, note: notes.join(" ") || null, title: page.title, page_version: page.version,
          imported_at: new Date().toISOString(), feature_count: plan.toInsert.length + plan.toUpdate.length,
        })
        .eq("id", sourceId);
      if (doneError) throw new Error(`상태 갱신 실패: ${doneError.message}`);
    } catch (e) {
      console.error("[rfp] catalog import failed", solutionCode, sourceId, e);
      await fail(e instanceof Error ? e.message : String(e));
    }
  }
}
