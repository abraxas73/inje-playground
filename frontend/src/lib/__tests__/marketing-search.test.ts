import { expect, it } from "vitest";
import { masterFilters } from "@/lib/marketing/search";
import { MASTER_SORT_FIELDS } from "@/lib/marketing/types";
it("accepts the 18 displayed columns and defaults invalid sort inputs safely", () => {
  for (const field of Object.keys(MASTER_SORT_FIELDS)) expect(masterFilters(new URLSearchParams({ sort: field, direction: "desc" }))).toMatchObject({ p_sort: field, p_direction: "desc" });
  for (const field of ["__proto__", "constructor", "name desc; drop table", ""]) expect(masterFilters(new URLSearchParams({ sort: field, direction: "invalid" }))).toMatchObject({ p_sort: "db_id", p_direction: "asc" });
  expect(masterFilters(new URLSearchParams())).toMatchObject({ p_sort: "db_id", p_direction: "asc" });
});
