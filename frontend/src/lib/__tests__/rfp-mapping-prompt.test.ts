import { describe, it, expect } from "vitest";
import { chunkRequirements, truncateDetails, CHUNK_SIZE, DETAILS_MAX_CHARS, type ChunkRequirement } from "@/lib/rfp/mapping/chunk";
import { buildCatalogPrompt, buildChunkMessage, MAPPING_RULES_PROMPT } from "@/lib/rfp/mapping/prompt";
import type { CatalogSolution } from "@/lib/rfp/mapping/types";

const catalog: CatalogSolution[] = [
  {
    code: "secloudit", name: "SECloudit", description: "멀티 클라우드 보안", isActive: true, sortOrder: 1,
    features: [
      { id: "f-sso", solutionCode: "secloudit", name: "SSO", description: "통합 인증\n및 접근 제어", evidenceUrl: null, isActive: true },
      { id: "f-old", solutionCode: "secloudit", name: "옛기능", description: "", evidenceUrl: null, isActive: false },
    ],
  },
  { code: "devopsit", name: "Devopsit", description: "", isActive: false, sortOrder: 2, features: [{ id: "f-ci", solutionCode: "devopsit", name: "CI", description: "d", evidenceUrl: null, isActive: true }] },
  { code: "aicubeit", name: "AICubeit", description: "AI 플랫폼", isActive: true, sortOrder: 3, features: [] },
  {
    code: "openstackit", name: "Openstackit", description: "IaaS", isActive: true, sortOrder: 4,
    features: [{ id: "f-vm", solutionCode: "openstackit", name: "VM", description: "가상 머신", evidenceUrl: null, isActive: true }],
  },
];

describe("chunkRequirements / truncateDetails", () => {
  it("20건씩 나누고 빈 배열은 빈 결과", () => {
    const rows = Array.from({ length: 45 }, (_, i) => i);
    expect(chunkRequirements(rows).map((c) => c.length)).toEqual([20, 20, 5]);
    expect(CHUNK_SIZE).toBe(20);
    expect(chunkRequirements([])).toEqual([]);
    expect(chunkRequirements(rows, 30).map((c) => c.length)).toEqual([30, 15]);
  });
  it("세부 내용은 1500자에서 자르고 표시를 붙인다", () => {
    const long = "가".repeat(DETAILS_MAX_CHARS + 10);
    expect(truncateDetails(long)).toBe(`${"가".repeat(DETAILS_MAX_CHARS)}…(이하 생략)`);
    expect(truncateDetails("  짧다  ")).toBe("짧다");
  });
});

describe("buildCatalogPrompt", () => {
  it("활성 솔루션·활성 기능만 S/F 별칭으로 넣고, 기능 없는 솔루션은 건너뛴다", () => {
    const { systemText, aliases } = buildCatalogPrompt(catalog);
    expect([...aliases.solutions.entries()]).toEqual([["S1", "secloudit"], ["S2", "openstackit"]]);
    expect([...aliases.features.entries()]).toEqual([
      ["F1", { featureId: "f-sso", solutionCode: "secloudit" }],
      ["F2", { featureId: "f-vm", solutionCode: "openstackit" }],
    ]);
    expect(systemText).toContain("## S1. SECloudit\n멀티 클라우드 보안\n- F1 SSO: 통합 인증 및 접근 제어");
    expect(systemText).toContain("## S2. Openstackit");
    expect(systemText).not.toContain("Devopsit");
    expect(systemText).not.toContain("옛기능");
    expect(systemText).not.toContain("AICubeit");
  });
  it("규칙 프롬프트에 판정 4값과 별칭 규칙이 있다", () => {
    for (const v of ["fulfilled", "partial", "build", "na"]) expect(MAPPING_RULES_PROMPT).toContain(v);
    expect(MAPPING_RULES_PROMPT).toContain("F숫자");
  });
});

describe("buildChunkMessage", () => {
  it("요구사항마다 ID·명칭·구분·정의·세부 내용(절단)을 넣는다", () => {
    const reqs: ChunkRequirement[] = [
      { id: "r1", reqId: "SER-001", title: "포털 구축", categoryName: "서비스 요구사항", definition: "정의", details: "가".repeat(2000) },
      { id: "r2", reqId: "SEC-002", title: "암호화", categoryName: "보안 요구사항", definition: "", details: "" },
    ];
    const msg = buildChunkMessage(reqs);
    expect(msg).toContain("요구사항 2건");
    expect(msg).toContain("### SER-001 포털 구축\n구분: 서비스 요구사항\n정의: 정의\n세부 내용: " + "가".repeat(1500) + "…(이하 생략)");
    expect(msg).toContain("### SEC-002 암호화\n구분: 보안 요구사항\n정의: (없음)\n세부 내용: (없음)");
  });
});
