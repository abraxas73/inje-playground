/**
 * 확정 매핑 재사용. 공공 RFP의 요구사항 문장은 문서가 달라도 크게 반복되므로(보안·성능·프로젝트 관리는 거의 표준 문구),
 * 사람이 한 번 확정한 매핑을 **비슷한 요구사항에 "이전 확정" 제안으로** 먼저 보여준다.
 * 사람의 확정은 규칙 엔진 점수보다 훨씬 좋은 신호다 — 확정 1건이 다음 문서의 여러 건을 줄인다.
 *
 * 비교는 요구사항 명칭 + 세부 항목 문장의 문자 bigram cosine(규칙 엔진과 같은 `charBigrams`). 문장이 거의 같아야
 * 뜨도록 임계값을 높게 둔다 — 틀린 제안이 많으면 사람이 제안을 믿지 않게 된다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAll } from "@/lib/work-metrics/common";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow } from "@/lib/rfp/mappers";
import { charBigrams, normalizeText } from "./tokenize";
import { isConfirmed } from "./review";
import type { MappingRow, Verdict } from "./types";

/** 이보다 덜 비슷하면 제안하지 않는다(문자 bigram cosine) */
export const REUSE_SIM_THRESHOLD = 0.45;
export const REUSE_LIMIT = 3;

/** 재사용 후보 풀의 한 항목 = 확정 행 + 그 요구사항의 문장 */
export interface ReusePoolItem {
  row: MappingRow;
  projectId: string;
  projectName: string;
  reqId: string;
  title: string;
  /** 매칭 텍스트(명칭 + 세부 항목 문장 또는 세부 내용) */
  text: string;
}

export interface ReuseSuggestion {
  sourceMappingId: string;
  projectId: string;
  projectName: string;
  reqId: string;
  title: string;
  verdict: Verdict;
  solutionCode: string | null;
  featureId: string | null;
  rationale: string;
  evidenceText: string | null;
  /** 0~1 문자 bigram cosine */
  similarity: number;
}

export function cosine(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit += 1;
  return hit / Math.sqrt(a.size * b.size);
}

/** 매칭 텍스트: 명칭 + (세부 항목 문장 있으면 그것, 없으면 세부 내용 전체) */
export function reuseText(title: string, detailText: string | null | undefined, details: string): string {
  return normalizeText(`${title} ${detailText?.trim() || details}`);
}

/**
 * 재사용 풀 — 사람이 확정한 행(후보 아님·edited) 전부. 같은 요구사항의 행은 제안하지 않으므로 호출 쪽이 뺀다.
 * 풀은 사람이 확정한 만큼만 커지므로(수백~수천 행) 매번 읽어도 된다.
 */
export async function loadReusePool(admin: SupabaseClient): Promise<ReusePoolItem[]> {
  const rowsRes = await selectAll<MappingDbRow>(() =>
    admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS, { count: "exact" }).eq("edited", true).neq("verdict", "candidate").order("updated_at", { ascending: false }).order("id"),
  );
  if (rowsRes.error) throw new Error(rowsRes.error.message);
  const rows = rowsRes.data.map(mapMapping).filter(isConfirmed);
  if (!rows.length) return [];

  const reqIds = [...new Set(rows.map((r) => r.requirementId))];
  const reqs = new Map<string, { project_id: string; req_id: string; title: string; details: string }>();
  for (let i = 0; i < reqIds.length; i += 200) {
    const { data, error } = await admin.from("rfp_requirements").select("id, project_id, req_id, title, details").in("id", reqIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const q of (data ?? []) as { id: string; project_id: string; req_id: string; title: string; details: string }[]) reqs.set(q.id, q);
  }
  const projectIds = [...new Set([...reqs.values()].map((q) => q.project_id))];
  const { data: projects, error: pe } = await admin.from("rfp_projects").select("id, name").in("id", projectIds);
  if (pe) throw new Error(pe.message);
  const projectName = new Map(((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  const pool: ReusePoolItem[] = [];
  for (const row of rows) {
    const q = reqs.get(row.requirementId);
    if (!q) continue;
    pool.push({
      row,
      projectId: q.project_id,
      projectName: projectName.get(q.project_id) ?? "(삭제된 프로젝트)",
      reqId: q.req_id,
      title: q.title,
      text: reuseText(q.title, row.detailText, q.details),
    });
  }
  return pool;
}

/**
 * 한 단위에 대한 제안. 같은 (솔루션, 기능, 판정)은 가장 비슷한 것 하나만 남긴다.
 * `excludeRequirementId`는 지금 보는 요구사항(자기 자신의 다른 항목을 제안하지 않는다).
 */
export function suggestReuse(
  query: { title: string; detailText: string | null | undefined; details: string; excludeRequirementId: string },
  pool: readonly ReusePoolItem[],
  opts: { limit?: number; threshold?: number } = {},
): ReuseSuggestion[] {
  const limit = opts.limit ?? REUSE_LIMIT;
  const threshold = opts.threshold ?? REUSE_SIM_THRESHOLD;
  const q = charBigrams(reuseText(query.title, query.detailText, query.details));
  const best = new Map<string, ReuseSuggestion>();
  for (const item of pool) {
    if (item.row.requirementId === query.excludeRequirementId) continue;
    const sim = cosine(q, charBigrams(item.text));
    if (sim < threshold) continue;
    const key = `${item.row.solutionCode ?? ""}|${item.row.featureId ?? ""}|${item.row.verdict}`;
    const cur = best.get(key);
    if (cur && cur.similarity >= sim) continue;
    best.set(key, {
      sourceMappingId: item.row.id,
      projectId: item.projectId,
      projectName: item.projectName,
      reqId: item.reqId,
      title: item.title,
      verdict: item.row.verdict,
      solutionCode: item.row.solutionCode,
      featureId: item.row.featureId,
      rationale: item.row.rationale,
      evidenceText: item.row.evidenceText ?? null,
      similarity: Math.round(sim * 100) / 100,
    });
  }
  return [...best.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
