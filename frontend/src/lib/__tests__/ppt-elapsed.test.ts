import { describe, expect, it } from "vitest";
import { formatElapsed } from "@/lib/ppt/elapsed";

describe("formatElapsed", () => {
  it("seconds under a minute, then m분 ss초; never negative", () => {
    expect(formatElapsed(0)).toBe("0초");
    expect(formatElapsed(59_900)).toBe("59초");
    expect(formatElapsed(60_000)).toBe("1분 00초");
    expect(formatElapsed(125_400)).toBe("2분 05초");
    expect(formatElapsed(-5_000)).toBe("0초");
    expect(formatElapsed(Number.NaN)).toBe("0초");
  });
});
