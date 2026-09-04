import { describe, it, expect } from "vitest";
import { validateMappingOutput, validateManualMapping, MAX_ROWS_PER_REQUIREMENT, type LlmMappingItem } from "@/lib/rfp/mapping/validate";
import type { CatalogAliases } from "@/lib/rfp/mapping/prompt";
import type { ChunkRequirement } from "@/lib/rfp/mapping/chunk";
import type { CatalogSolution, MappingRow } from "@/lib/rfp/mapping/types";

const chunk: ChunkRequirement[] = [
  { id: "r1", reqId: "SER-001", title: "a", categoryName: "c", definition: "", details: "" },
  { id: "r2", reqId: "SER-002", title: "b", categoryName: "c", definition: "", details: "" },
  { id: "r3", reqId: "SEC-001", title: "c", categoryName: "c", definition: "", details: "" },
];
const aliases: CatalogAliases = {
  solutions: new Map([["S1", "secloudit"], ["S2", "devopsit"]]),
  features: new Map([
    ["F1", { featureId: "f-sso", solutionCode: "secloudit" }],
    ["F2", { featureId: "f-audit", solutionCode: "secloudit" }],
    ["F3", { featureId: "f-ci", solutionCode: "devopsit" }],
  ]),
};
const item = (reqId: string, verdict: LlmMappingItem["verdict"], feature: string | null, rationale = "r"): LlmMappingItem => ({ reqId, verdict, feature, rationale });

describe("validateMappingOutput", () => {
  it("별칭을 실제 id로 되돌리고 sortOrder를 매긴다", () => {
    const v = validateMappingOutput([item("SER-001", "fulfilled", "F1"), item("SER-001", "partial", "f3 "), item("SER-002", "na", null), item("SEC-001", "build", "F2")], chunk, aliases);
    expect(v.rows).toEqual([
      { requirementId: "r1", solutionCode: "secloudit", featureId: "f-sso", verdict: "fulfilled", rationale: "r", sortOrder: 0 },
      { requirementId: "r1", solutionCode: "devopsit", featureId: "f-ci", verdict: "partial", rationale: "r", sortOrder: 1 },
      { requirementId: "r2", solutionCode: null, featureId: null, verdict: "na", rationale: "r", sortOrder: 0 },
      { requirementId: "r3", solutionCode: null, featureId: null, verdict: "build", rationale: "r", sortOrder: 0 },
    ]);
    expect(v.warnings).toEqual([]);
    expect(v.unmapped).toEqual([]);
  });
  it("없는 reqId·불명 별칭·기능 없는 fulfilled는 버리고 경고", () => {
    const v = validateMappingOutput([item("XXX-999", "na", null), item("SER-001", "fulfilled", "F9"), item("SER-001", "partial", null), item("SER-002", "na", null)], chunk, aliases);
    expect(v.rows.map((r) => r.requirementId)).toEqual(["r2"]);
    expect(v.warnings).toEqual(["청크에 없는 요구사항 ID XXX-999", "SER-001: 기능 별칭 불명 F9", "SER-001: 기능 별칭 불명 null", "SER-001: 매핑 결과 없음", "SEC-001: 매핑 결과 없음"]);
    expect(v.unmapped).toEqual(["SER-001", "SEC-001"]);
  });
  it("fulfilled와 함께 나온 build/na는 버리고, build+na는 build만, 같은 기능 중복은 먼저 나온 것", () => {
    const v = validateMappingOutput([
      item("SER-001", "fulfilled", "F1", "첫"), item("SER-001", "na", null), item("SER-001", "fulfilled", "F1", "둘"),
      item("SER-002", "na", null), item("SER-002", "build", null), item("SER-002", "na", null),
      item("SEC-001", "partial", "F2"),
    ], chunk, aliases);
    expect(v.rows.filter((r) => r.requirementId === "r1")).toEqual([{ requirementId: "r1", solutionCode: "secloudit", featureId: "f-sso", verdict: "fulfilled", rationale: "첫", sortOrder: 0 }]);
    expect(v.rows.filter((r) => r.requirementId === "r2").map((r) => r.verdict)).toEqual(["build"]);
    expect(v.warnings).toContain("SER-001: 충족/부분충족과 함께 나온 설계·구축영역/해당없음 1행 제외");
  });
  it("요구사항당 5행 상한", () => {
    const many: CatalogAliases = { solutions: new Map([["S1", "s"]]), features: new Map(Array.from({ length: 7 }, (_, i) => [`F${i + 1}`, { featureId: `f${i + 1}`, solutionCode: "s" }])) };
    const v = validateMappingOutput(Array.from({ length: 7 }, (_, i) => item("SER-001", "fulfilled", `F${i + 1}`)), chunk.slice(0, 1), many);
    expect(v.rows).toHaveLength(MAX_ROWS_PER_REQUIREMENT);
    expect(v.warnings).toEqual(["SER-001: 매핑 7행 중 5행만 사용"]);
  });
});

describe("validateManualMapping", () => {
  const catalog: CatalogSolution[] = [
    { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [{ id: "f-sso", solutionCode: "secloudit", name: "SSO", description: "", evidenceUrl: null, isActive: true }] },
    { code: "devopsit", name: "Devopsit", description: "", isActive: true, sortOrder: 2, features: [{ id: "f-ci", solutionCode: "devopsit", name: "CI", description: "", evidenceUrl: null, isActive: true }] },
  ];
  const row = (verdict: MappingRow["verdict"], featureId: string | null): MappingRow => ({ id: "m", requirementId: "r1", solutionCode: featureId ? "secloudit" : null, featureId, verdict, rationale: "", evidenceUrl: null, edited: true, sortOrder: 0 });
  it("충족·부분충족은 기능 필수, 기능의 솔루션을 채워 준다", () => {
    expect(validateManualMapping({ verdict: "fulfilled", featureId: "f-sso" }, catalog, [])).toEqual({ ok: true, verdict: "fulfilled", solutionCode: "secloudit", featureId: "f-sso" });
    expect(validateManualMapping({ verdict: "partial", featureId: null }, catalog, [])).toEqual({ ok: false, error: "충족·부분충족은 기능을 골라야 합니다." });
    expect(validateManualMapping({ verdict: "partial", featureId: "nope" }, catalog, [])).toMatchObject({ ok: false, error: "카탈로그에 없는 기능입니다." });
    expect(validateManualMapping({ verdict: "partial", solutionCode: "devopsit", featureId: "f-sso" }, catalog, [])).toMatchObject({ ok: false, error: "기능이 선택한 솔루션의 것이 아닙니다." });
  });
  it("build/na는 솔루션·기능 null, 요구사항당 하나, 충족·부분충족과 공존 불가", () => {
    expect(validateManualMapping({ verdict: "build", solutionCode: "secloudit", featureId: "f-sso" }, catalog, [])).toEqual({ ok: true, verdict: "build", solutionCode: null, featureId: null });
    expect(validateManualMapping({ verdict: "na" }, catalog, [row("build", null)])).toEqual({ ok: false, error: "설계·구축영역·해당없음은 요구사항당 하나만 둘 수 있습니다." });
    expect(validateManualMapping({ verdict: "na" }, catalog, [row("fulfilled", "f-sso")])).toEqual({ ok: false, error: "설계·구축영역·해당없음은 충족·부분충족과 함께 둘 수 없습니다." });
    expect(validateManualMapping({ verdict: "fulfilled", featureId: "f-ci" }, catalog, [row("na", null)])).toMatchObject({ ok: false, error: expect.stringContaining("먼저 지우거나") });
    expect(validateManualMapping({ verdict: "fulfilled", featureId: "f-sso" }, catalog, [row("partial", "f-sso")])).toEqual({ ok: false, error: "같은 기능이 이미 매핑돼 있습니다." });
    expect(validateManualMapping({ verdict: "maybe" }, catalog, [])).toEqual({ ok: false, error: "판정은 fulfilled·partial·build·na 중 하나입니다." });
  });
});
