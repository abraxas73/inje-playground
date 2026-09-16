import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 조직 필터 파라미터 → org_id 목록. `all`(또는 없음)은 null(필터 없음), `team`·`personal`은 그 분류의 조직 전체,
 * 그 외는 그 id 하나. 테이블 조회는 applyOrgFilter로, RPC(claude_code_tool_summary·claude_code_hourly)는 SQL 안에서 해석한다.
 */
export async function resolveOrgIds(admin: SupabaseClient, org: string | null | undefined): Promise<string[] | null> {
  if (!org || org === "all") return null;
  if (org === "personal" || org === "team") {
    const { data, error } = await admin.from("claude_orgs").select("id").eq("category", org);
    if (error) throw new Error(`claude_orgs: ${error.message}`);
    return (data ?? []).map((o: { id: string }) => o.id);
  }
  return [org];
}

/** ids가 비어 있으면(개인 조직 없음) 아무 행도 맞지 않는 값으로 필터해 전체가 나오지 않게 한다. */
export function applyOrgFilter<Q extends { in(column: string, values: string[]): Q }>(query: Q, ids: string[] | null): Q {
  if (ids === null) return query;
  return query.in("org_id", ids.length ? ids : ["__none__"]);
}
