import { describe, expect, it } from "vitest";
import { loadDurations } from "@/lib/work-metrics/perf-report";

type Page = { data: unknown; error: { message: string } | null; count: number | null };
/** rpc(...) → 체이닝 .order() → .range(lo, hi) 빌더. page(lo, hi)가 페이지를 만든다 */
const fake = (page: (lo: number, hi: number) => Page, onRpc?: (name: string, args: unknown, opts: unknown) => void) => ({
  rpc: (name: string, args: unknown, opts: unknown) => {
    onRpc?.(name, args, opts);
    const b = { order: () => b, range: async (lo: number, hi: number) => page(lo, hi) };
    return b;
  },
}) as never;

describe("loadDurations", () => {
  it("RPC가 없으면(스키마 캐시) durationsReady=false, 500 아님", async () => {
    const r = await loadDurations(fake(() => ({ data: null, error: { message: "Could not find the function public.work_items_time_stats in the schema cache" }, count: null })), "2026-09-01", "2026-09-28", null);
    expect(r).toEqual({ durations: [], durationsReady: false });
  });
  it("다른 오류도 페이지를 깨지 않고 durationsReady=false, 정상이면 숫자로 바꾼다", async () => {
    expect(await loadDurations(fake(() => ({ data: null, error: { message: "timeout" }, count: null })), "2026-09-01", "2026-09-28", null)).toEqual({ durations: [], durationsReady: false });
    const row = { grp: "all", kind: "issue", metric: "lead", n: "3", p50: "24", p90: "70.5", avg: "30", b1: "0", b2: "2", b3: "1", b4: "0", b5: "0" };
    const r = await loadDurations(fake(() => ({ data: [row], error: null, count: 1 }), (name, args, opts) => {
      expect(name).toBe("work_items_time_stats");
      expect(args).toEqual({ p_from: "2026-09-01", p_to: "2026-09-28", p_emails: ["a@innogrid.com"] });
      expect(opts).toEqual({ count: "exact" });
    }), "2026-09-01", "2026-09-28", ["a@innogrid.com"]);
    expect(r).toEqual({ durations: [{ grp: "all", kind: "issue", metric: "lead", n: 3, p50: 24, p90: 70.5, avg: 30, b1: 0, b2: 2, b3: 1, b4: 0, b5: 0 }], durationsReady: true });
  });
  it("1000행 상한을 넘으면 페이지를 이어 붙인다", async () => {
    const all = Array.from({ length: 1001 }, (_, i) => ({ grp: `u${i}`, kind: "issue", metric: "lead", n: "1" }));
    const r = await loadDurations(fake((lo, hi) => ({ data: all.slice(lo, Math.min(hi + 1, lo + 1000)), error: null, count: 1001 })), "2026-09-01", "2026-09-28", null);
    expect("durations" in r && r.durations.length).toBe(1001);
    expect(r.durationsReady).toBe(true);
  });
});
