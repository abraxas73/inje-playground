import { describe, expect, it } from "vitest";
import { estimateCostUsd, formatUsd, PRICES_USD_PER_M } from "@/lib/ppt/pricing";

describe("ppt pricing", () => {
  it("sums the four token kinds at their own rates", () => {
    // sonnet 5.5: in $2, out $10, cache write $2.5, cache read $0.2 per 1M
    const usd = estimateCostUsd("claude-sonnet-5-5", { in: 1_000_000, out: 100_000, cacheWrite: 200_000, cacheRead: 2_000_000 });
    expect(usd).toBeCloseTo(2 + 1 + 0.5 + 0.4, 6);
  });
  it("returns null for unknown or missing models", () => {
    expect(estimateCostUsd("claude-unknown-9", { in: 1, out: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull();
    expect(estimateCostUsd(null, { in: 1, out: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
  it("cache write is 1.25x input for every listed model", () => {
    for (const p of Object.values(PRICES_USD_PER_M)) expect(p.cacheWrite).toBeCloseTo(p.input * 1.25, 6);
  });
  it("formats small and large amounts", () => {
    expect(formatUsd(0.00123)).toBe("$0.0012");
    expect(formatUsd(0.0456)).toBe("$0.046");
    expect(formatUsd(3.14159)).toBe("$3.14");
  });
});
