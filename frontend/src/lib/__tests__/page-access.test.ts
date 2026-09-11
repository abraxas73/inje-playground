import { describe, expect, it } from "vitest";
import { PAGES, canOpenPage, canUsePage, isPagePermissions, pagesForPath } from "@/lib/page-access";

describe("page access catalog", () => {
  it("preserves role defaults and makes admins immune to individual restrictions", () => {
    for (const page of PAGES) {
      expect(canUsePage("user", page.key)).toBe(true);
      expect(canUsePage("guest", page.key)).toBe(page.minRole === "guest");
      expect(canUsePage("admin", page.key, { [page.key]: false })).toBe(true);
      expect(canUsePage("user", page.key, { [page.key]: false })).toBe(false);
    }
  });
  it("cannot elevate a guest using a page override", () => {
    expect(canUsePage("guest", "rfp", { rfp: true })).toBe(false);
    expect(canOpenPage("user", "/admin/page-permissions")).toBe(false);
    expect(canOpenPage("user", "/guide/admin")).toBe(false);
  });
  it.each(["food", "ladder", "team", "survey", "guide", "rfp", "people-news"])("matches /%s children on path boundaries", (prefix) => {
    expect(pagesForPath(`/${prefix}/detail`)).toHaveLength(1);
    expect(pagesForPath(`/${prefix}-unrelated`)).toEqual([]);
  });
  it("keeps external RFP shares outside page restrictions", () => {
    expect(pagesForPath("/rfp/shared/token")).toEqual([]);
    expect(pagesForPath("/api/rfp/shared/token")).toEqual([]);
    expect(pagesForPath("/api/rfp/shares/token")).toEqual(["rfp"]);
  });
  it("guards feature APIs and allows shared usage scope if any usage page remains allowed", () => {
    expect(pagesForPath("/api/people-news/email")).toEqual(["people_news"]);
    expect(pagesForPath("/api/usage/office")).toEqual(["usage_chat"]);
    expect(pagesForPath("/api/team-attendance")).toEqual(["team"]);
    expect(pagesForPath("/api/usage/scope")).toEqual(["usage_code", "usage_chat", "usage_perf"]);
    expect(pagesForPath("/api/cron/yonhap-notice-email")).toEqual([]);
  });
  it.each([null, [], { admin: true }, { rfp: "false" }, { rfp: null }, 12])("rejects invalid overrides %j", (value) => {
    expect(isPagePermissions(value)).toBe(false);
  });
  it("accepts reset-to-default and typed overrides", () => {
    expect(isPagePermissions({})).toBe(true);
    expect(isPagePermissions({ rfp: false, food: true })).toBe(true);
  });
});
