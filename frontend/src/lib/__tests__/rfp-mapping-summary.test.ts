import { describe, it, expect } from "vitest";
import { indexCatalog, groupByRequirement, mappingSummary, mappingRollup, bestVerdict, countByVerdict, countBySolution } from "@/lib/rfp/mapping/summary";
import type { CatalogSolution, MappingRow } from "@/lib/rfp/mapping/types";

const catalog: CatalogSolution[] = [
  { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [
    { id: "f-iam", solutionCode: "secloudit", name: "IAM", description: "", evidenceUrl: null, isActive: true, keywords: [] },
    { id: "f-old", solutionCode: "secloudit", name: "옛기능", description: "", evidenceUrl: null, isActive: false, keywords: [] },
  ] },
  { code: "devopsit", name: "Devopsit", description: "", isActive: true, sortOrder: 2, features: [
    { id: "f-pipe", solutionCode: "devopsit", name: "파이프라인", description: "", evidenceUrl: null, isActive: true, keywords: [] },
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
    expect(countByVerdict(["r1", "r2", "r3", "r4", "r5", "r6"], rows)).toEqual({ fulfilled: 2, partial: 1, candidate: 0, build: 1, na: 1, unmapped: 1 });
  });
});

describe("countBySolution", () => {
  it("솔루션마다 요구사항 단위로 충족/부분충족을 세고 카탈로그 순서를 지킨다", () => {
    expect(countBySolution(rows, catalog)).toEqual([
      { code: "secloudit", name: "SECloudit", fulfilled: 1, partial: 2, candidate: 0 },
      { code: "devopsit", name: "Devopsit", fulfilled: 1, partial: 1, candidate: 0 },
    ]);
  });
  it("후보만 있는 요구사항은 candidate로 센다", () => {
    const withCandidate = [...rows, row("r7", "candidate", "f-iam", "secloudit"), row("r7", "candidate", "f-pipe", "devopsit", 1)];
    expect(countBySolution(withCandidate, catalog)[0]).toEqual({ code: "secloudit", name: "SECloudit", fulfilled: 1, partial: 2, candidate: 1 });
    expect(bestVerdict(groupByRequirement(withCandidate).get("r7")!)).toBe("candidate");
    expect(countByVerdict(["r7"], withCandidate)).toEqual({ fulfilled: 0, partial: 0, candidate: 1, build: 0, na: 0, unmapped: 0 });
    expect(mappingSummary(groupByRequirement(withCandidate).get("r7")!, index)).toBe("SECloudit·IAM(후보) / Devopsit·파이프라인(후보)");
  });
});

describe("mappingRollup", () => {
  it("판정 건수와 솔루션만 센다(항목이 많은 요구사항용)", () => {
    const many = [
      row("r9", "candidate", "f-iam", "secloudit"),
      row("r9", "candidate", "f-pipe", "devopsit"),
      row("r9", "candidate", "f-iam", "secloudit"),
      row("r9", "fulfilled", "f-iam", "secloudit"),
    ];
    expect(mappingRollup(many, index)).toBe("충족 1건 · 후보 3건 — SECloudit, Devopsit");
  });
  it("솔루션이 필요 없는 판정만 있으면 건수만", () => {
    expect(mappingRollup([row("r9", "build", null, null)], index)).toBe("설계·구축영역 1건");
  });
  it("행이 없으면 빈 문자열", () => {
    expect(mappingRollup([], index)).toBe("");
  });
});
