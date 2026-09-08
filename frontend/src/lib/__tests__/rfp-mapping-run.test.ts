// @vitest-environment node
import { describe, it, expect } from "vitest";
import { selectTargetRequirements, runWithConcurrency, summarizeChunkOutcomes, scopeCatalog, CONCURRENCY } from "@/lib/rfp/mapping/run-job";
import { MappingOutputSchema } from "@/lib/rfp/mapping/llm";
import { createRulesEngine, createLlmEngine } from "@/lib/rfp/mapping/engine";
import { LlmUnavailableError } from "@/lib/rfp/extract-llm";
import type { CatalogSolution } from "@/lib/rfp/mapping/types";

describe("selectTargetRequirements", () => {
  const reqs = [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { id: "r4" }];
  const mappings = [
    { requirementId: "r1", edited: false },
    { requirementId: "r2", edited: true }, { requirementId: "r2", edited: false },
    { requirementId: "r3", edited: false },
  ];
  it("all: 사람이 고친 행이 있는 요구사항만 제외", () => {
    expect(selectTargetRequirements(reqs, mappings, "all").map((r) => r.id)).toEqual(["r1", "r3", "r4"]);
  });
  it("missing: 행이 하나도 없는 요구사항만", () => {
    expect(selectTargetRequirements(reqs, mappings, "missing").map((r) => r.id)).toEqual(["r4"]);
  });
});

describe("runWithConcurrency", () => {
  it("동시 실행 수를 제한하고 입력 순서대로 결과를 돌려주며 실패를 잡는다", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await runWithConcurrency([30, 10, 20, 5, 15], 2, async (ms, i) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, ms));
      active -= 1;
      if (i === 3) throw new Error("boom");
      return ms * 2;
    });
    expect(maxActive).toBe(2);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : `err:${(r.reason as Error).message}`))).toEqual([60, 20, 40, "err:boom", 30]);
    expect(CONCURRENCY).toBe(3);
  });
  it("빈 입력은 빈 결과", async () => {
    expect(await runWithConcurrency([], 3, async () => 1)).toEqual([]);
  });
});

describe("summarizeChunkOutcomes", () => {
  it("실패 문구를 앞에 모으고 성공 청크의 경고는 뒤에 붙인다(경고 200건 절단에서 살아남게)", () => {
    const s = summarizeChunkOutcomes([
      { status: "fulfilled", value: { warnings: ["a"], rows: 10 } },
      { status: "rejected", reason: new Error("timeout") },
      { status: "fulfilled", value: { warnings: [], rows: 7 } },
    ]);
    expect(s).toEqual({ warnings: ["청크 2/3 실패: timeout", "a"], succeeded: 2, failed: 1, rows: 17, failedReqIds: [] });
  });

  it("청크를 함께 주면 실패한 요구사항 ID를 남긴다(그 요구사항은 미매핑으로 남는다)", () => {
    const chunks = [[{ reqId: "SER-001" }], [{ reqId: "SER-002" }, { reqId: "SER-003" }]];
    const s = summarizeChunkOutcomes(
      [
        { status: "fulfilled", value: { warnings: [], rows: 3 } },
        { status: "rejected", reason: new Error("insert 실패") },
      ],
      chunks,
    );
    expect(s.failed).toBe(1);
    expect(s.failedReqIds).toEqual(["SER-002", "SER-003"]);
    expect(s.warnings[0]).toBe("청크 2/2 실패: insert 실패 — 요구사항 SER-002, SER-003");
  });

  it("실패 요구사항이 5건을 넘으면 뒤는 건수로 줄인다", () => {
    const ids = ["A", "B", "C", "D", "E", "F", "G"].map((reqId) => ({ reqId }));
    const s = summarizeChunkOutcomes([{ status: "rejected", reason: new Error("x") }], [ids]);
    expect(s.warnings[0]).toBe("청크 1/1 실패: x — 요구사항 A, B, C, D, E 외 2건");
  });
});

describe("MappingOutputSchema", () => {
  it("판정 enum·nullable feature를 검사한다", () => {
    expect(MappingOutputSchema.safeParse({ mappings: [{ reqId: "SER-001", verdict: "na", feature: null, rationale: "" }] }).success).toBe(true);
    expect(MappingOutputSchema.safeParse({ mappings: [{ reqId: "SER-001", verdict: "maybe", feature: null, rationale: "" }] }).success).toBe(false);
  });
  it("candidate는 Claude 스키마가 거부한다", () => {
    expect(MappingOutputSchema.safeParse({ mappings: [{ reqId: "SER-001", verdict: "candidate", feature: "F1", rationale: "" }] }).success).toBe(false);
  });
});

const catalog: CatalogSolution[] = [
  { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [
    { id: "f-sso", solutionCode: "secloudit", name: "SSO 로그인", description: "통합 인증", evidenceUrl: null, isActive: true, keywords: ["sso", "로그인", "통합", "인증"] },
    { id: "f-off", solutionCode: "secloudit", name: "옛기능", description: "", evidenceUrl: null, isActive: false, keywords: ["sso"] },
  ] },
];

describe("createRulesEngine", () => {
  it("활성 기능만 lookup(기능 id 키)에 넣고 run은 후보를 돌려준다", async () => {
    const setup = createRulesEngine(catalog);
    expect([...setup.lookup.entries()]).toEqual([["f-sso", { featureId: "f-sso", solutionCode: "secloudit" }]]);
    const items = await setup.run([{ id: "r1", reqId: "SER-001", title: "SSO 통합 인증", categoryName: "c", definition: "", details: "" }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ reqId: "SER-001", verdict: "candidate", feature: "f-sso" });
  });
});

describe("createLlmEngine", () => {
  it("키가 없으면 LlmUnavailableError", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createLlmEngine(catalog)).toThrow(LlmUnavailableError);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
  it("키가 있으면 별칭 lookup을 준다(호출은 하지 않는다)", () => {
    const setup = createLlmEngine(catalog, { apiKey: "test-key" });
    expect([...setup.lookup.keys()]).toEqual(["F1"]);
  });
});

describe("scopeCatalog", () => {
  const cat = [
    { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [] },
    { code: "openstackit", name: "Openstackit", description: "", isActive: true, sortOrder: 2, features: [] },
  ];
  it("코드 목록이 비면 전체, 있으면 그 솔루션만(대소문자·공백 무시)", () => {
    expect(scopeCatalog(cat, undefined)).toHaveLength(2);
    expect(scopeCatalog(cat, [])).toHaveLength(2);
    expect(scopeCatalog(cat, ["Openstackit"]).map((s) => s.code)).toEqual(["openstackit"]);
    expect(scopeCatalog(cat, [" secloudit ", "openstackit"]).map((s) => s.code)).toEqual(["secloudit", "openstackit"]);
  });
  it("없는 코드만 주면 빈 배열(라우트·잡이 오류로 처리한다)", () => {
    expect(scopeCatalog(cat, ["nope"])).toEqual([]);
  });
});

describe("selectTargetRequirements — 요구사항 단위 재실행", () => {
  const reqs = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];
  const mappings = [
    { requirementId: "r1", edited: true },
    { requirementId: "r2", edited: false },
  ];
  it("requirementIds를 주면 그 요구사항만, edited 제외 규칙은 적용하지 않는다", () => {
    expect(selectTargetRequirements(reqs, mappings, "all", ["r1"]).map((r) => r.id)).toEqual(["r1"]);
    expect(selectTargetRequirements(reqs, mappings, "missing", ["r1", "r2"]).map((r) => r.id)).toEqual(["r1", "r2"]);
  });
  it("없는 id만 주면 대상이 없다(잡이 경고로 끝낸다)", () => {
    expect(selectTargetRequirements(reqs, mappings, "all", ["nope"])).toEqual([]);
  });
  it("빈 배열·undefined면 예전 규칙(all은 edited 제외, missing은 행 없는 것만)", () => {
    expect(selectTargetRequirements(reqs, mappings, "all", []).map((r) => r.id)).toEqual(["r2", "r3"]);
    expect(selectTargetRequirements(reqs, mappings, "all").map((r) => r.id)).toEqual(["r2", "r3"]);
    expect(selectTargetRequirements(reqs, mappings, "missing").map((r) => r.id)).toEqual(["r3"]);
  });
});
