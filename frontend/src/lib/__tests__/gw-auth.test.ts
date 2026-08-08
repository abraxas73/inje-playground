import { describe, it, expect } from "vitest";
import { buildGwSignature, isInnogridEmail } from "@/lib/gw-auth";

describe("buildGwSignature", () => {
  it("결정적 base64 서명을 만든다", () => {
    const args = { oAuthToken: "tok", signKey: "key", transactionId: "tid", timestamp: 1700000000, pathname: "/gw/gw016A02" };
    const sig = buildGwSignature(args);
    expect(sig).toBe("yvDIqALtlRKuypAFWlDC9IJc17iGZdh922GuEpphRak="); // Step 4에서 실제값으로 확정
    expect(buildGwSignature(args)).toBe(sig); // 결정성
  });
});

describe("isInnogridEmail", () => {
  it("innogrid.com 도메인만 허용", () => {
    expect(isInnogridEmail("a@innogrid.com")).toBe(true);
    expect(isInnogridEmail("a@INNOGRID.COM")).toBe(true);
    expect(isInnogridEmail("a@gmail.com")).toBe(false);
    expect(isInnogridEmail("  a@innogrid.com  ")).toBe(true);
  });
});
