import { describe, it, expect } from "vitest";
import { indexCatalog, groupByRequirement, mappingSummary, bestVerdict, countByVerdict, countBySolution } from "@/lib/rfp/mapping/summary";
import type { CatalogSolution, MappingRow } from "@/lib/rfp/mapping/types";

const catalog: CatalogSolution[] = [
  { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [
    { id: "f-iam", solutionCode: "secloudit", name: "IAM", description: "", evidenceUrl: null, isActive: true },
    { id: "f-old", solutionCode: "secloudit", name: "옛기능", description: "", evidenceUrl: null, isActive: false },
  ] },
  { code: "devopsit", name: "Devopsit", description: "", isActive: true, sortOrder: 2, features: [
    { id: "f-pipe", solutionCode: "devopsit", name: "파이프라인", description: "", evidenceUrl: null, isActive: true },
  ] },
];
let n = 0;
const row = (requirementId: string, verdict: MappingRow["verdict"], featureId: string | null, solutionCode: string | null, sortOrder = 0): MappingRow =>
  ({ id: `m${++n}`, requirementId, verdict, featureId, solutionCode, rationale: "", evidenceUrl: null, edited: false, sortOrder });
const rows: MappingRow[] = [
  row("r1", "partial", "f-pipe", "devopsit", 1),
  row("r1", "fulfilled", "f-iam", "secloudit", 0),
  row("r2", "build", null, null),
  row("r3", "na", null, null),
  row("r4", "partial", "f-old", "secloudit"),
  row("r5", "partial", "f-iam", "secloudit"),
  row("r5", "fulfilled", "f-pipe", "devopsit", 1),
];
const index = indexCatalog(catalog);

describe("mappingSummary", () => {
  it("sortOrder 순으로 '솔루션·기능(판정)'을 ' / '로 잇고 build/na는 라벨만", () => {
    const g = groupByRequirement(rows);
    expect(mappingSummary(g.get("r1")!, index)).toBe("SECloudit·IAM(충족) / Devopsit·파이프라인(부분충족)");
    expect(mappingSummary(g.get("r2")!, index)).toBe("설계·구축영역");
    expect(mappingSummary(g.get("r3")!, index)).toBe("해당없음");
    expect(mappingSummary([], index)).toBe("");
  });
  it("비활성 기능은 [비활성], 카탈로그에서 사라진 기능은 (삭제된 기능)", () => {
    expect(mappingSummary(groupByRequirement(rows).get("r4")!, index)).toBe("SECloudit·옛기능[비활성](부분충족)");
    expect(mappingSummary([row("r9", "fulfilled", "gone", "secloudit")], index)).toBe("SECloudit·(삭제된 기능)(충족)");
  });
});

describe("bestVerdict / countByVerdict", () => {
  it("요구사항 단위로 fulfilled > partial > build > na, 없으면 unmapped", () => {
    expect(bestVerdict(groupByRequirement(rows).get("r1")!)).toBe("fulfilled");
    expect(bestVerdict([])).toBeNull();
    expect(countByVerdict(["r1", "r2", "r3", "r4", "r5", "r6"], rows)).toEqual({ fulfilled: 2, partial: 1, build: 1, na: 1, unmapped: 1 });
  });
});

describe("countBySolution", () => {
  it("솔루션마다 요구사항 단위로 충족/부분충족을 세고 카탈로그 순서를 지킨다", () => {
    expect(countBySolution(rows, catalog)).toEqual([
      { code: "secloudit", name: "SECloudit", fulfilled: 1, partial: 2 },
      { code: "devopsit", name: "Devopsit", fulfilled: 1, partial: 1 },
    ]);
  });
});
