import type { SupabaseClient } from "@supabase/supabase-js";
import { sortRequirements } from "../requirements";
import { loadCatalog } from "../catalog/store";
import type { CatalogSolution, EngineKind, MappingRow } from "./types";
import { chunkRequirements, type ChunkRequirement } from "./chunk";
import { validateMappingOutput } from "./validate";
import { indexCatalog } from "./summary";
import { ENGINE_FACTORIES, LlmUnavailableError, type EngineFactory, type EngineSetup } from "./engine";
import { MAPPING_CANDIDATES_DEFAULT } from "./settings";
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

export interface RunDeps {
  factories: Record<EngineKind, EngineFactory>;
  /** 규칙 엔진의 요구사항당 후보 상한(어드민 설정 1~5). 라우트가 settings에서 읽어 넘긴다. */
  maxCandidates?: number;
  /** 매핑 대상 솔루션 코드. 비었거나 없으면 활성 솔루션 전체(화면 기본값). */
  solutionCodes?: string[];
}

/** 대상 솔루션만 남긴 카탈로그. 코드 목록이 비어 있으면 그대로 돌려준다(전체 대상). */
export function scopeCatalog(catalog: CatalogSolution[], codes: readonly string[] | undefined): CatalogSolution[] {
  if (!codes?.length) return catalog;
  const want = new Set(codes.map((c) => c.trim().toLowerCase()).filter(Boolean));
  return catalog.filter((s) => want.has(s.code.toLowerCase()));
}
const DEFAULT_DEPS: RunDeps = { factories: ENGINE_FACTORIES, maxCandidates: MAPPING_CANDIDATES_DEFAULT };

/**
 * 2단계 §4.3 + 4단계 §5.4 잡. 카탈로그 → 엔진(rules|llm, 팩토리 주입) → 대상 선정 → 20건 청크(동시 3) → 검증 → 청크마다 즉시 저장(edited 행 보존, engine·score 기록) → ready|failed.
 * 어떤 경우에도 mapping_status를 running으로 남기지 않는다.
 */
export async function runMapping(admin: SupabaseClient, projectId: string, mode: MappingMode, engine: EngineKind, deps: RunDeps = DEFAULT_DEPS): Promise<void> {
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
    const all = await loadCatalog(admin, { activeSolutionsOnly: true });
    const catalog = scopeCatalog(all, deps.solutionCodes);
    if (!catalog.length) return await fail("선택한 솔루션이 카탈로그에 없습니다. 대상 솔루션을 다시 고르세요.");
    let setup: EngineSetup;
    try {
      setup = deps.factories[engine](catalog, { maxCandidates: deps.maxCandidates ?? MAPPING_CANDIDATES_DEFAULT });
    } catch (e) {
      if (e instanceof LlmUnavailableError) return await fail(e.message);
      throw e;
    }
    if (!setup.lookup.size) return await fail("카탈로그가 비어 있습니다. 관리자에게 문의하세요.");
    // 매핑 행의 기능 이름·근거 URL은 선택 밖 솔루션도 그릴 수 있어야 해서 전체 카탈로그로 색인한다
    const index = indexCatalog(all);
    const scopeNote = catalog.length < all.length ? [`대상 솔루션 ${catalog.length}/${all.length}개: ${catalog.map((s) => s.name).join(", ")}`] : [];

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
    if (!targets.length) return await ready([...scopeNote, "매핑할 요구사항이 없습니다(모두 사람이 검토했거나 이미 매핑됨)."]);

    const sorted = sortRequirements(targets.map((r) => ({ ...r, categoryCode: r.category_code, sortOrder: r.sort_order })));
    const chunks = chunkRequirements(
      sorted.map<ChunkRequirement>((r) => ({ id: r.id, reqId: r.req_id, title: r.title, categoryName: r.category_name, definition: r.definition, details: r.details })),
    );

    const results = await runWithConcurrency(chunks, CONCURRENCY, async (chunk): Promise<ChunkOutcome> => {
      const items = await setup.run(chunk);
      const v = validateMappingOutput(items, chunk, setup.lookup);
      const ids = chunk.map((r) => r.id);
      const { error: de } = await admin.from("rfp_requirement_mappings").delete().eq("project_id", projectId).eq("edited", false).in("requirement_id", ids);
      if (de) throw new Error(de.message);
      if (v.rows.length) {
        const { error: ie } = await admin.from("rfp_requirement_mappings").insert(
          v.rows.map((r) => ({
            project_id: projectId, requirement_id: r.requirementId, solution_code: r.solutionCode, feature_id: r.featureId, verdict: r.verdict,
            rationale: r.rationale, evidence_url: r.featureId ? (index.feature.get(r.featureId)?.evidenceUrl ?? null) : null, edited: false, sort_order: r.sortOrder,
            engine, score: r.score,
          })),
        );
        if (ie) throw new Error(ie.message);
      }
      return { warnings: v.warnings, rows: v.rows.length };
    });
    const summary = summarizeChunkOutcomes(results);
    if (summary.succeeded === 0) return await fail(`모든 청크가 실패했습니다. ${summary.warnings[0] ?? ""}`.trim());
    await ready([...scopeNote, ...summary.warnings]);
  } catch (e) {
    console.error("[rfp] mapping failed", projectId, e);
    await fail(e instanceof Error ? e.message : String(e));
  }
}
