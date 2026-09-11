import { describe, expect, it } from "vitest";
import { parseNoticeQuery } from "@/lib/people-news/query";
import { canAccess } from "@/lib/roles";

describe("people news filters", () => {
  it("uses inclusive Korean calendar dates and paginates on the server", () => {
    const q = parseNoticeQuery(new URLSearchParams("category=obituary&from=2026-09-11&to=2026-09-11&page=2"));
    expect(q).toMatchObject({ category: "obituary", fromIso: "2026-09-10T15:00:00.000Z", toIso: "2026-09-11T15:00:00.000Z", offset: 20 });
  });
  it("rolls month and year boundaries correctly", () => {
    expect(parseNoticeQuery(new URLSearchParams("to=2026-12-31")).toIso).toBe("2026-12-31T15:00:00.000Z");
  });
  it.each(["page=0", "page=-1", "page=1.5", "page=1e2", "page=10001", "category=other", "from=2026-02-30", "to=2026-13-01", "from=2026-09-12&to=2026-09-11"])("rejects invalid query %s", (query) => {
    expect(() => parseNoticeQuery(new URLSearchParams(query))).toThrow();
  });
  it("escapes LIKE wildcards in a literal title search", () => {
    expect(parseNoticeQuery(new URLSearchParams({ q: "  100%_\\  " })).search).toBe("%100\\%\\_\\\\%");
  });
  it("shows the feature to users and admins, not guests", () => {
    expect(canAccess("user", "/people-news")).toBe(true);
    expect(canAccess("admin", "/people-news")).toBe(true);
    expect(canAccess("guest", "/people-news")).toBe(false);
  });
});
