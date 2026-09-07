import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAPPING_CANDIDATES_DEFAULT, MAPPING_CANDIDATES_MAX, MAPPING_CANDIDATES_MIN, MAPPING_MAX_CANDIDATES_KEY,
  loadMappingMaxCandidates, parseMaxCandidates,
} from "@/lib/rfp/mapping/settings";

function fakeAdmin(result: { data: unknown; error: unknown }): { admin: SupabaseClient; keys: string[] } {
  const keys: string[] = [];
  const admin = {
    from: (table: string) => {
      if (table !== "settings") throw new Error(`unexpected table ${table}`);
      return { select: () => ({ eq: (_c: string, k: string) => { keys.push(k); return { maybeSingle: async () => result }; } }) };
    },
  } as unknown as SupabaseClient;
  return { admin, keys };
}

describe("parseMaxCandidates", () => {
  it("1~5 정수로 자른다", () => {
    expect(parseMaxCandidates("3")).toBe(3);
    expect(parseMaxCandidates(" 4 ")).toBe(4);
    expect(parseMaxCandidates(2)).toBe(2);
    expect(parseMaxCandidates(4.7)).toBe(4);
    expect(parseMaxCandidates(0)).toBe(MAPPING_CANDIDATES_MIN);
    expect(parseMaxCandidates(-3)).toBe(MAPPING_CANDIDATES_MIN);
    expect(parseMaxCandidates(99)).toBe(MAPPING_CANDIDATES_MAX);
  });
  it("비었거나 숫자가 아니면 기본값 5", () => {
    for (const v of ["", "  ", "abc", null, undefined, {}, NaN]) expect(parseMaxCandidates(v)).toBe(MAPPING_CANDIDATES_DEFAULT);
    expect(MAPPING_CANDIDATES_DEFAULT).toBe(5);
  });
});

describe("loadMappingMaxCandidates", () => {
  it("저장값을 읽고 키는 rfp_mapping_max_candidates", async () => {
    const { admin, keys } = fakeAdmin({ data: { value: "2" }, error: null });
    expect(await loadMappingMaxCandidates(admin)).toBe(2);
    expect(keys).toEqual([MAPPING_MAX_CANDIDATES_KEY]);
  });
  it("행이 없거나 조회가 실패하면 기본값 — 설정 때문에 매핑이 멈추지 않는다", async () => {
    expect(await loadMappingMaxCandidates(fakeAdmin({ data: null, error: null }).admin)).toBe(MAPPING_CANDIDATES_DEFAULT);
    expect(await loadMappingMaxCandidates(fakeAdmin({ data: null, error: { message: "boom" } }).admin)).toBe(MAPPING_CANDIDATES_DEFAULT);
  });
});
