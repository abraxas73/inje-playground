import { describe, expect, it } from "vitest";
import { loadDurations } from "@/lib/work-metrics/perf-report";

const fake = (rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>) => ({ rpc }) as never;

describe("loadDurations", () => {
  it("RPC가 없으면(스키마 캐시) durationsReady=false, 500 아님", async () => {
    const r = await loadDurations(fake(async () => ({ data: null, error: { message: "Could not find the function public.work_items_time_stats in the schema cache" } })), "2026-09-01", "2026-09-28", null);
    expect(r).toEqual({ durations: [], durationsReady: false });
  });
  it("다른 오류는 error로 돌려주고, 정상이면 숫자로 바꾼다", async () => {
    expect(await loadDurations(fake(async () => ({ data: null, error: { message: "timeout" } })), "2026-09-01", "2026-09-28", null)).toEqual({ error: "durations: timeout" });
    const r = await loadDurations(fake(async (_n, args) => {
      expect(args).toEqual({ p_from: "2026-09-01", p_to: "2026-09-28", p_emails: ["a@innogrid.com"] });
      return { data: [{ grp: "all", kind: "issue", metric: "lead", n: "3", p50: "24", p90: "70.5", avg: "30", b1: "0", b2: "2", b3: "1", b4: "0", b5: "0" }], error: null };
    }), "2026-09-01", "2026-09-28", ["a@innogrid.com"]);
    expect(r).toEqual({ durations: [{ grp: "all", kind: "issue", metric: "lead", n: 3, p50: 24, p90: 70.5, avg: 30, b1: 0, b2: 2, b3: 1, b4: 0, b5: 0 }], durationsReady: true });
  });
});
