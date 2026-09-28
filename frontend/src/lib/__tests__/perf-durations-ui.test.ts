import { describe, expect, it } from "vitest";
import { pickStat, weightedP50 } from "@/lib/work-metrics/durations-view";
import type { TimeStatRow } from "@/types/work-metrics";

const row = (grp: string, kind: "issue" | "mr", metric: "lead" | "cycle" | "wait", n: number, p50: number): TimeStatRow => ({ grp, kind, metric, n, p50, p90: p50 * 2, avg: p50, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0 });

describe("durations-view", () => {
  const rows = [row("all", "issue", "cycle", 10, 20), row("user:a@innogrid.com", "issue", "cycle", 4, 10), row("user:b@innogrid.com", "issue", "cycle", 6, 30), row("all", "mr", "lead", 3, 5)];
  it("pickStat은 grp·kind·metric으로 한 행", () => {
    expect(pickStat(rows, "all", "issue", "cycle")?.p50).toBe(20);
    expect(pickStat(rows, "all", "issue", "wait")).toBeUndefined();
  });
  it("weightedP50은 건수 가중 평균, 비면 null", () => {
    expect(weightedP50([rows[1], rows[2]])).toBe(22);
    expect(weightedP50([])).toBeNull();
  });
});
