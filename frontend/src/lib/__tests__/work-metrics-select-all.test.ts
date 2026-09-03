import { describe, expect, it } from "vitest";
import { selectAll, type PageResult } from "@/lib/work-metrics/common";

/** PostgREST처럼 max-rows 상한으로 페이지를 자르는 가짜 서버 */
function fakeServer(total: number, serverCap: number, opts: { withCount?: boolean; failAt?: number } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const make = () => ({
    range(from: number, to: number): PromiseLike<PageResult<{ id: number }>> {
      calls.push([from, to]);
      if (opts.failAt !== undefined && calls.length === opts.failAt) return Promise.resolve({ data: null, error: { message: "boom" }, count: null });
      const data = rows.slice(from, Math.min(to + 1, from + serverCap));
      return Promise.resolve({ data, error: null, count: opts.withCount === false ? null : total });
    },
  });
  return { make, calls };
}

describe("selectAll", () => {
  it("1000행 상한을 넘는 결과를 끝까지 읽는다", async () => {
    const { make, calls } = fakeServer(3554, 1000);
    const r = await selectAll<{ id: number }>(make);
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(3554);
    expect(r.data!.at(-1)).toEqual({ id: 3553 });
    expect(calls).toHaveLength(4);
  });

  it("서버 상한이 pageSize보다 작아도 count로 끝까지 읽는다", async () => {
    const { make } = fakeServer(2500, 400);
    const r = await selectAll<{ id: number }>(make);
    expect(r.data).toHaveLength(2500);
  });

  it("count가 없으면 페이지가 덜 찼을 때 끝낸다", async () => {
    const { make, calls } = fakeServer(1500, 1000, { withCount: false });
    const r = await selectAll<{ id: number }>(make);
    expect(r.data).toHaveLength(1500);
    expect(calls).toHaveLength(2);
  });

  it("빈 결과는 빈 배열", async () => {
    const { make, calls } = fakeServer(0, 1000);
    const r = await selectAll<{ id: number }>(make);
    expect(r.data).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("중간 페이지 오류는 그대로 전달한다", async () => {
    const { make } = fakeServer(2500, 1000, { failAt: 2 });
    const r = await selectAll<{ id: number }>(make);
    expect(r.data).toBeNull();
    expect(r.error?.message).toBe("boom");
  });
});
