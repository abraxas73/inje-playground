import { MASTER_SORT_FIELDS, type MasterSortField, type SortDirection } from "./types";
/** Shared by paginated Master DB lists and full-result Excel exports. */
export function masterFilters(params: URLSearchParams) {
  const sort = params.get("sort") ?? "db_id";
  return {
    p_q: (params.get("q") ?? "").trim().slice(0, 100).replace(/[,%()\\]/g, " "),
    p_category: params.get("category") ?? "",
    p_department: params.get("department") ?? "",
    p_issues: params.get("issues") === "true",
    p_sort: (Object.hasOwn(MASTER_SORT_FIELDS, sort) ? sort : "db_id") as MasterSortField,
    p_direction: (params.get("direction") === "desc" ? "desc" : "asc") as SortDirection,
  };
}
