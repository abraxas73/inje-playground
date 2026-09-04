import type { SupabaseClient } from "@supabase/supabase-js";
import { sortRequirements } from "../requirements";
import { LlmUnavailableError } from "../extract-llm";
import { loadCatalog } from "../catalog/store";
import type { MappingRow } from "./types";
import { buildCatalogPrompt, buildChunkMessage } from "./prompt";
import { chunkRequirements, type ChunkRequirement } from "./chunk";
import { validateMappingOutput } from "./validate";
import { indexCatalog } from "./summary";
import { createAnthropicMappingCall, type MappingCall } from "./llm";
import { selectAll } from "../../work-metrics/common";

export type MappingMode = "all" | "missing";
/** 동시에 보내는 청크 수. 124건(7청크) → 3라운드로 Vercel 300초 안에 끝나게. */
export const CONCURRENCY = 3;

/** all: edited 행이 있는 요구사항만 제외 / missing: 행이 하나도 없는 요구사항만(스펙 §4.3). */
export function selectTargetRequirements<T extends { id: string }>(
  requirements: readonly T[],
  mappings: readonly Pick<MappingRow, "requirementId" | "edited">[],
  mode: MappingMode,
): T[] {
  const has = new Set<string>();
  const edited = new Set<string>();
  for (const m of mappings) {
    has.add(m.requirementId);
    if (m.edited) edited.add(m.requirementId);
  }
  return requirements.filter((r) => (mode === "missing" ? !has.has(r.id) : !edited.has(r.id)));
}

/** 동시 limit개까지 실행. 결과는 입력 순서대로 PromiseSettledResult(실패도 잡아서 돌려준다). */
export async function runWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

export interface ChunkOutcome {
  warnings: string[];
  rows: number;
}

export function summarizeChunkOutcomes(results: readonly PromiseSettledResult<ChunkOutcome>[]): { warnings: string[]; succeeded: number; failed: number; rows: number } {
  const out = { warnings: [] as string[], succeeded: 0, failed: 0, rows: 0 };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      out.succeeded += 1;
      out.rows += r.value.rows;
      out.warnings.push(...r.value.warnings);
    } else {
      out.failed += 1;
      out.warnings.push(`청크 ${i + 1}/${results.length} 실패: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  });
  return out;
}

interface ReqRow {
  id: string;
  req_id: string;
  title: string;
  category_code: string;
  category_name: string;
  definition: string;
  details: string;
  sort_order: number;
}

export interface MappingDeps {
  makeCall: (catalogText: string) => MappingCall;
}
const DEFAULT_DEPS: MappingDeps = { makeCall: (t) => createAnthropicMappingCall(t) };

/**
 * 스펙 §4.3 잡. 카탈로그 → 대상 선정 → 20건 청크(동시 3) → 검증 → 청크마다 즉시 저장(edited 행 보존) → ready|failed.
 * 어떤 경우에도 mapping_status를 running으로 남기지 않는다.
 */
export async function runMapping(admin: SupabaseClient, projectId: string, mode: MappingMode, deps: MappingDeps = DEFAULT_DEPS): Promise<void> {
  // supabase-js는 DB 오류를 throw하지 않고 error로 돌려준다. 종료 상태 갱신이 실패하면 running으로 남으므로 반드시 검사한다(Task 6 리뷰 지적과 같은 규칙).
  const fail = async (message: string) => {
    const { error } = await admin.from("rfp_projects").update({ mapping_status: "failed", mapping_error: message.slice(0, 500) }).eq("id", projectId);
    if (error) console.error("[rfp] mapping status update failed", projectId, error.message);
  };
  const ready = async (warnings: string[]) => {
    const { error } = await admin
      .from("rfp_projects")
      .update({ mapping_status: "ready", mapping_error: null, mapping_at: new Date().toISOString(), mapping_warnings: warnings.slice(0, 200) })
      .eq("id", projectId);
    if (error) await fail(`상태 갱신 실패: ${error.message}`);
  };
  try {
    const catalog = await loadCatalog(admin, { activeSolutionsOnly: true });
    const { systemText, aliases } = buildCatalogPrompt(catalog);
    if (!aliases.features.size) return await fail("카탈로그가 비어 있습니다. 관리자에게 문의하세요.");
    const index = indexCatalog(catalog);

    const [reqRes, mapRes] = await Promise.all([
      admin.from("rfp_requirements").select("id, req_id, title, category_code, category_name, definition, details, sort_order").eq("project_id", projectId),
      selectAll<{ requirement_id: string; edited: boolean }>(() =>
        admin.from("rfp_requirement_mappings").select("requirement_id, edited", { count: "exact" }).eq("project_id", projectId).order("id"),
      ),
    ]);
    if (reqRes.error) throw new Error(reqRes.error.message);
    if (mapRes.error) throw new Error(mapRes.error.message);
    // 요구사항은 수백 건이라 1000행 상한에 걸리지 않지만, 매핑은 수동 추가 행에 상한이 없어 selectAll로 끝까지 읽는다.
    const requirements = (reqRes.data ?? []) as ReqRow[];
    const existing = mapRes.data.map((m) => ({ requirementId: m.requirement_id, edited: m.edited }));
    const targets = selectTargetRequirements(requirements, existing, mode);
    if (!targets.length) return await ready(["매핑할 요구사항이 없습니다(모두 사람이 검토했거나 이미 매핑됨)."]);

    const sorted = sortRequirements(targets.map((r) => ({ ...r, categoryCode: r.category_code, sortOrder: r.sort_order })));
    const chunks = chunkRequirements(
      sorted.map<ChunkRequirement>((r) => ({ id: r.id, reqId: r.req_id, title: r.title, categoryName: r.category_name, definition: r.definition, details: r.details })),
    );

    let call: MappingCall;
    try {
      call = deps.makeCall(systemText);
    } catch (e) {
      if (e instanceof LlmUnavailableError) return await fail(e.message);
      throw e;
    }

    const results = await runWithConcurrency(chunks, CONCURRENCY, async (chunk): Promise<ChunkOutcome> => {
      const out = await call(buildChunkMessage(chunk));
      const v = validateMappingOutput(out.mappings, chunk, aliases);
      const ids = chunk.map((r) => r.id);
      const { error: de } = await admin.from("rfp_requirement_mappings").delete().eq("project_id", projectId).eq("edited", false).in("requirement_id", ids);
      if (de) throw new Error(de.message);
      if (v.rows.length) {
        const { error: ie } = await admin.from("rfp_requirement_mappings").insert(
          v.rows.map((r) => ({
            project_id: projectId, requirement_id: r.requirementId, solution_code: r.solutionCode, feature_id: r.featureId, verdict: r.verdict,
            rationale: r.rationale, evidence_url: r.featureId ? (index.feature.get(r.featureId)?.evidenceUrl ?? null) : null, edited: false, sort_order: r.sortOrder,
          })),
        );
        if (ie) throw new Error(ie.message);
      }
      return { warnings: v.warnings, rows: v.rows.length };
    });
    const summary = summarizeChunkOutcomes(results);
    if (summary.succeeded === 0) return await fail(`모든 청크가 실패했습니다. ${summary.warnings[0] ?? ""}`.trim());
    await ready(summary.warnings);
  } catch (e) {
    console.error("[rfp] mapping failed", projectId, e);
    await fail(e instanceof Error ? e.message : String(e));
  }
}
