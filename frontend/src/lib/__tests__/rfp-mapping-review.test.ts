import { describe, expect, it } from "vitest";
import { buildReviewUnits, cleanRationale, responseText, reviewProgress, unitKey, unitStatus } from "@/lib/rfp/mapping/review";
import type { MappingRow } from "@/lib/rfp/mapping/types";

const m = (id: string, verdict: MappingRow["verdict"], o: Partial<MappingRow & { score: number | null }> = {}): MappingRow & { score: number | null } => ({
  id, requirementId: "r1", verdict, featureId: verdict === "build" || verdict === "na" ? null : `f-${id}`, solutionCode: verdict === "build" || verdict === "na" ? null : "secloudit",
  rationale: `자동 매칭 — 이유 ${id}`, evidenceUrl: null, edited: false, sortOrder: 0, score: null, ...o,
});
const req = (id: string, sortOrder: number, details: string) => ({ id, categoryCode: "SER", categoryName: "보안", reqId: `SER-00${sortOrder}`, title: `제목 ${id}`, definition: "", details, sortOrder });

describe("unitStatus", () => {
  it("확정 행이 있으면 그중 가장 좋은 판정, 후보만 있으면 검토 대기, 없으면 미매핑", () => {
    expect(unitStatus([])).toBe("unmapped");
    expect(unitStatus([m("a", "candidate"), m("b", "candidate")])).toBe("pending");
    // 후보가 남아 있어도 확정 행 하나가 상태를 정한다
    expect(unitStatus([m("a", "candidate"), m("b", "partial")])).toBe("partial");
    expect(unitStatus([m("a", "partial"), m("b", "fulfilled")])).toBe("fulfilled");
    expect(unitStatus([m("a", "na")])).toBe("na");
  });
});

describe("buildReviewUnits / reviewProgress", () => {
  it("요구사항 × 세부 항목이 단위이고, 행이 없는 요구사항도 미매핑 단위로 들어간다", () => {
    const reqs = [
      req("r2", 2, "○ 하나\n○ 둘"), // 세부 항목 2개
      req("r1", 1, "한 덩어리"), // 목록 아님 → 단위 1개
      req("r3", 3, ""), // 매핑 없음
    ];
    const rows = [
      { ...m("c1", "candidate", { score: 0.4 }), requirementId: "r2", detailKey: "1" },
      { ...m("c2", "candidate", { score: 0.7 }), requirementId: "r2", detailKey: "1" },
      { ...m("c3", "fulfilled"), requirementId: "r1" },
    ];
    const units = buildReviewUnits(reqs, rows);
    expect(units.map((u) => u.key)).toEqual([unitKey("r1", null), unitKey("r2", "1"), unitKey("r2", "2"), unitKey("r3", null)]);
    expect(units.map((u) => u.status)).toEqual(["fulfilled", "pending", "unmapped", "unmapped"]);
    // 후보는 점수 높은 순
    expect(units[1].candidates.map((c) => c.id)).toEqual(["c2", "c1"]);
    const p = reviewProgress(units);
    expect(p).toMatchObject({ total: 4, decided: 1, pending: 1, unmapped: 2 });
  });
});

describe("responseText / cleanRationale", () => {
  it("규칙 엔진 접두를 떼고 근거 문장을 앞세운다", () => {
    expect(cleanRationale("자동 매칭 — 키워드 3개 일치")).toBe("키워드 3개 일치");
    expect(cleanRationale("사람이 쓴 설명")).toBe("사람이 쓴 설명");
    const text = responseText([
      m("a", "fulfilled", { evidenceText: "접근통제 기능을 제공한다.", rationale: "자동 매칭 — 키워드 일치" }),
      m("b", "partial", { rationale: "일부만 지원" }),
    ]);
    expect(text).toBe("접근통제 기능을 제공한다. — 키워드 일치\n일부만 지원");
  });
});
