// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runMapping } from "@/lib/rfp/mapping/run-job";

vi.mock("@/lib/rfp/catalog/store", () => ({ loadCatalog: async () => [{
  code: "s", name: "제품", description: "", isActive: true, sortOrder: 0,
  features: [{ id: "f1", solutionCode: "s", name: "기능", description: "설명", isActive: true, keywords: [], evidenceUrl: null }],
}] }));
vi.mock("@/lib/work-metrics/common", () => ({ selectAll: async () => ({ data: [{ requirement_id: "r1", edited: false }], error: null }) }));

describe("Claude 재매핑 실패 시 기존 매핑 보호", () => {
  it.each(["empty", "partial", "request-error"])("%s 결과는 삭제 전에 실패 상태로 종료한다", async (kind) => {
    const deletion = vi.fn(() => { throw new Error("기존 결과를 삭제하면 안 됨"); });
    const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    const admin = { from: (table: string) => {
      if (table === "rfp_projects") return { update };
      if (table === "rfp_requirements") return { select: () => ({ eq: async () => ({ data: [{ id: "r1", req_id: "SFR-001", title: "요구", category_code: "SFR", category_name: "기능", definition: "", details: "○ 인증\n○ 백업", sort_order: 0 }], error: null }) }) };
      if (table === "rfp_requirement_mappings") return { delete: deletion };
      throw new Error(`Unexpected table ${table}`);
    } } as unknown as SupabaseClient;
    const factory = vi.fn(() => ({
      lookup: new Map([["F1", { featureId: "f1", solutionCode: "s" }]]),
      run: async () => {
        if (kind === "request-error") throw new Error("API 실패");
        return kind === "empty" ? [] : [{ reqId: "SFR-001", verdict: "fulfilled" as const, feature: "F1", rationale: "근거", detailKey: "1" }];
      },
    }));
    await runMapping(admin, "p1", "all", "llm", { factories: { rules: factory, llm: factory }, maxCandidates: 1 });
    expect(factory).toHaveBeenCalledWith(expect.any(Array), { maxCandidates: 1 });
    expect(deletion).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ mapping_status: "failed" }));
  });
});

it("세분화 후 재매핑도 상위 후보를 보존하며 하위 키로 저장", async () => {
  const details = "○ HCI\n  - 라이선스\n  - VM";
  const filters: unknown[][] = [];
  const deletion: Record<string, unknown> = {};
  for (const name of ["eq", "or", "not"]) deletion[name] = (...args: unknown[]) => { filters.push([name, ...args]); return deletion; };
  deletion.then = (resolve: (value: unknown) => void) => resolve({ error: null });
  const insert = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
  const admin = { from: (table: string) => {
    if (table === "rfp_projects") return { update };
    if (table === "rfp_requirements") return { select: () => ({ eq: async () => ({ data: [{ id: "r1", req_id: "SFR-001", title: "HCI", category_code: "SFR", category_name: "기능", definition: "", details, source: { detailSplits: { "1": details } }, sort_order: 0 }], error: null }) }) };
    if (table === "rfp_requirement_mappings") return { delete: () => deletion, insert };
    throw new Error(table);
  } } as unknown as SupabaseClient;
  const factory = () => ({ lookup: new Map([["F1", { featureId: "f1", solutionCode: "s" }]]), run: async () => ["1.1", "1.2"].map(detailKey => ({ reqId: "SFR-001", verdict: "build" as const, feature: null, rationale: "구축", detailKey })) });
  await runMapping(admin, "p1", "all", "llm", { factories: { rules: factory, llm: factory }, maxCandidates: 1 });
  expect(filters).toContainEqual(["or", "detail_key.is.null,detail_key.not.in.(1)"]);
  expect(filters).toContainEqual(["not", "detail_key", "is", null]);
  expect(insert).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ detail_key: "1.1" }), expect.objectContaining({ detail_key: "1.2" })]));
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ mapping_status: "ready" }));
});
