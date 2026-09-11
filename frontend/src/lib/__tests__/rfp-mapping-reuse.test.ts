import { describe, expect, it } from "vitest";
import { cosine, reuseText, suggestReuse, type ReusePoolItem } from "@/lib/rfp/mapping/reuse";
import { charBigrams } from "@/lib/rfp/mapping/tokenize";
import type { MappingRow } from "@/lib/rfp/mapping/types";

const row = (id: string, requirementId: string, verdict: MappingRow["verdict"], featureId: string | null): MappingRow => ({
  id, requirementId, verdict, featureId, solutionCode: featureId ? "secloudit" : null, rationale: `이유 ${id}`, evidenceUrl: null, edited: true, sortOrder: 0,
});
const item = (id: string, requirementId: string, title: string, detail: string, verdict: MappingRow["verdict"] = "fulfilled", featureId: string | null = "f-iam"): ReusePoolItem => ({
  row: row(id, requirementId, verdict, featureId), projectId: "p-old", projectName: "K-에듀파인", reqId: `SER-${id}`, title, text: reuseText(title, detail, ""),
});

describe("cosine / reuseText", () => {
  it("같은 문장은 1, 다른 문장은 낮다", () => {
    const a = charBigrams(reuseText("접근통제", "인가된 사용자만 시스템에 접근하도록 통제한다", ""));
    expect(cosine(a, a)).toBeCloseTo(1);
    expect(cosine(a, charBigrams(reuseText("GPU 서버", "수량 10대, CPU 2소켓", "")))).toBeLessThan(0.2);
  });
});

describe("suggestReuse", () => {
  const pool = [
    item("1", "old-1", "접근통제", "○ 인가된 사용자만 시스템에 접근하도록 통제해야 함"),
    item("2", "old-2", "접근 통제", "○ 인가된 사용자만 시스템에 접근하도록 통제한다", "partial", "f-iam"),
    item("3", "old-3", "GPU 서버 도입", "○ 수량 10대 ○ CPU 2소켓 128코어 이상"),
    item("4", "self", "접근통제", "○ 인가된 사용자만 시스템에 접근하도록 통제해야 함"),
  ];

  it("문장이 비슷한 확정만 제안하고, 같은 요구사항의 행은 빼며, 유사도 순으로 정렬한다", () => {
    const out = suggestReuse({ title: "접근통제", detailText: "○ 인가된 사용자만 시스템에 접근하도록 통제해야 함", details: "", excludeRequirementId: "self" }, pool);
    expect(out.map((s) => s.sourceMappingId)).toEqual(["1", "2"]);
    expect(out[0].similarity).toBeGreaterThan(0.9);
    expect(out[0]).toMatchObject({ projectName: "K-에듀파인", reqId: "SER-1", verdict: "fulfilled", featureId: "f-iam" });
  });

  it("같은 (솔루션, 기능, 판정)은 가장 비슷한 것 하나만 남긴다", () => {
    const dup = [...pool, item("5", "old-5", "접근통제 기능", "○ 인가된 사용자만 시스템에 접근하도록 통제해야 함")];
    const out = suggestReuse({ title: "접근통제", detailText: "○ 인가된 사용자만 시스템에 접근하도록 통제해야 함", details: "", excludeRequirementId: "x" }, dup);
    // 1·4·5는 (secloudit, f-iam, fulfilled)로 같은 조합 → 하나, 2는 partial → 따로
    expect(out.filter((s) => s.verdict === "fulfilled")).toHaveLength(1);
    expect(out.filter((s) => s.verdict === "partial")).toHaveLength(1);
  });

  it("임계값 아래면 제안하지 않는다", () => {
    expect(suggestReuse({ title: "네트워크 스위치", detailText: "○ 800Gbps 포트 32개", details: "", excludeRequirementId: "x" }, pool)).toEqual([]);
  });
});
