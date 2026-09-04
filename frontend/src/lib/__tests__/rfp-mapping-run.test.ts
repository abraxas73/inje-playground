// @vitest-environment node
import { describe, it, expect } from "vitest";
import { selectTargetRequirements, runWithConcurrency, summarizeChunkOutcomes, CONCURRENCY } from "@/lib/rfp/mapping/run-job";
import { MappingOutputSchema } from "@/lib/rfp/mapping/llm";

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
  it("성공 청크의 경고를 모으고 실패 청크는 번호를 붙인다", () => {
    const s = summarizeChunkOutcomes([
      { status: "fulfilled", value: { warnings: ["a"], rows: 10 } },
      { status: "rejected", reason: new Error("timeout") },
      { status: "fulfilled", value: { warnings: [], rows: 7 } },
    ]);
    expect(s).toEqual({ warnings: ["a", "청크 2/3 실패: timeout"], succeeded: 2, failed: 1, rows: 17 });
  });
});

describe("MappingOutputSchema", () => {
  it("판정 enum·nullable feature를 검사한다", () => {
    expect(MappingOutputSchema.safeParse({ mappings: [{ reqId: "SER-001", verdict: "na", feature: null, rationale: "" }] }).success).toBe(true);
    expect(MappingOutputSchema.safeParse({ mappings: [{ reqId: "SER-001", verdict: "maybe", feature: null, rationale: "" }] }).success).toBe(false);
  });
});
