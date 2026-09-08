/**
 * 판정 조합 규칙(`validateManualMapping`)에 넣을 "형제 행" 조회.
 *
 * 매핑 단위는 **세부 항목**이므로 형제도 같은 항목의 행만이어야 한다(아키텍처 §4).
 * 행 추가(POST)와 수정(PATCH)이 이 함수를 함께 써서 규칙이 갈라지지 않게 한다 —
 * 2026-09-08 리뷰 전까지 PATCH만 요구사항 전체를 형제로 봐서, 항목마다 후보가 깔린
 * 정상 상태에서 판정 확정·변경이 거부됐다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAPPING_COLUMNS, mapMapping, type MappingDbRow } from "@/lib/rfp/mappers";
import type { MappingRow } from "./types";

export type SiblingsResult = { ok: true; siblings: MappingRow[] } | { ok: false; error: string };

/**
 * 같은 요구사항·같은 세부 항목의 다른 행. `excludeId`는 수정 중인 행(자기 자신)을 뺀다.
 * detailKey는 null(요구사항 전체 단위)도 정상 값이다.
 */
export async function loadDetailSiblings(
  admin: SupabaseClient,
  requirementId: string,
  detailKey: string | null,
  excludeId?: string,
): Promise<SiblingsResult> {
  const { data, error } = await admin
    .from("rfp_requirement_mappings")
    .select(MAPPING_COLUMNS)
    .eq("requirement_id", requirementId)
    .order("sort_order");
  if (error) return { ok: false, error: error.message };
  const siblings = ((data ?? []) as MappingDbRow[])
    .map(mapMapping)
    .filter((s) => s.id !== excludeId && (s.detailKey ?? null) === detailKey);
  return { ok: true, siblings };
}
