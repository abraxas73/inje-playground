import { describe, it, expect } from "vitest";
import { loadDetailSiblings } from "@/lib/rfp/mapping/siblings";

/** 체이닝만 흉내 내는 최소 fake — select→eq→order 순서로 호출된다 */
function fakeAdmin(rows: Record<string, unknown>[], error?: { message: string }) {
  const calls: Record<string, unknown>[] = [];
  const q = {
    select: () => q,
    eq: (col: string, val: unknown) => { calls.push({ eq: [col, val] }); return q; },
    order: () => Promise.resolve({ data: rows, error: error ?? null }),
  };
  return { client: { from: (table: string) => { calls.push({ table }); return q; } } as never, calls };
}

const row = (id: string, detailKey: string | null, verdict = "candidate") => ({
  id, project_id: "p1", requirement_id: "q1", solution_code: "secloudit", feature_id: `f-${id}`, verdict,
  rationale: "", evidence_url: null, edited: false, sort_order: 0, engine: "rules", score: 1,
  detail_key: detailKey, detail_text: null, evidence_text: null, note: null, updated_at: "2026-09-08T00:00:00Z", updated_by: null,
});

describe("loadDetailSiblings", () => {
  it("같은 세부 항목의 행만 형제로 본다", async () => {
    const { client } = fakeAdmin([row("a", "1"), row("b", "2"), row("c", "1"), row("d", null)]);
    const res = await loadDetailSiblings(client, "q1", "1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.siblings.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("detailKey가 null이면 요구사항 전체 단위 행만", async () => {
    const { client } = fakeAdmin([row("a", "1"), row("d", null), row("e", null)]);
    const res = await loadDetailSiblings(client, "q1", null);
    if (res.ok) expect(res.siblings.map((s) => s.id)).toEqual(["d", "e"]);
  });

  it("수정 중인 행(excludeId)은 제외한다", async () => {
    const { client } = fakeAdmin([row("a", "1"), row("c", "1")]);
    const res = await loadDetailSiblings(client, "q1", "1", "a");
    if (res.ok) expect(res.siblings.map((s) => s.id)).toEqual(["c"]);
  });

  it("요구사항으로 조회하고 DB 오류는 그대로 돌려준다", async () => {
    const { client, calls } = fakeAdmin([row("a", "1")]);
    await loadDetailSiblings(client, "q1", "1");
    expect(calls).toContainEqual({ table: "rfp_requirement_mappings" });
    expect(calls).toContainEqual({ eq: ["requirement_id", "q1"] });

    const bad = fakeAdmin([], { message: "boom" });
    const res = await loadDetailSiblings(bad.client, "q1", "1");
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});
