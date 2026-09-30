import { describe, expect, it } from "vitest";
import { PAGES, canOpenPage, pagesForPath } from "@/lib/page-access";
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABEL } from "@/lib/audit";

describe("ppt page access", () => {
  it("registers /ppt for users and maps its API", () => {
    const page = PAGES.find((p) => p.key === "ppt");
    expect(page).toMatchObject({ href: "/ppt", label: "PPT 만들기", group: "work", minRole: "user" });
    expect(pagesForPath("/ppt")).toEqual(["ppt"]);
    expect(pagesForPath("/ppt/abc")).toEqual(["ppt"]);
    expect(pagesForPath("/api/ppt/decks")).toEqual(["ppt"]);
    expect(canOpenPage("guest", "/ppt")).toBe(false);
    expect(canOpenPage("user", "/ppt")).toBe(true);
  });
  it("lets shared view and its API through the proxy (route checks the session itself)", () => {
    expect(pagesForPath("/ppt/s/abcdefghijklmnopqrstuvwx")).toEqual([]);
    expect(pagesForPath("/api/ppt/shared/abcdefghijklmnopqrstuvwx")).toEqual([]);
    expect(pagesForPath("/api/ppt/shared/abc/file")).toEqual([]);
  });
  it("has an audit category", () => {
    expect(AUDIT_CATEGORIES).toContain("ppt");
    expect(AUDIT_CATEGORY_LABEL.ppt).toBe("PPT 만들기");
  });
});
