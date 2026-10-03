import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/mobile/next-path";

describe("safeNextPath", () => {
  it("같은 오리진 경로만 통과시키고 쿼리는 보존한다", () => {
    expect(safeNextPath("/ppt")).toBe("/ppt");
    expect(safeNextPath("/admin/settings?tab=ppt")).toBe("/admin/settings?tab=ppt");
  });
  it("오픈 리다이렉트가 될 값은 전부 /", () => {
    for (const v of ["//evil.com", "https://evil.com/x", "javascript:alert(1)", "evil.com", "/\\evil.com", "", null, undefined, "/%2F%2Fevil.com"]) {
      expect(safeNextPath(v)).toBe("/");
    }
  });
});
