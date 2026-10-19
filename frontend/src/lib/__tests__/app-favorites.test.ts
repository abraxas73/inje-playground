import { describe, expect, it } from "vitest";
import { parseAppFavorites, toggleAppFavorite, validPath } from "@/lib/app-favorites";

describe("app favorites", () => {
  it("accepts in-app paths only", () => {
    expect(validPath("/web?path=%2Fppt")).toBe(true);
    expect(validPath("/gw/mail")).toBe(true);
    for (const bad of ["//evil.test", "https://x", "javascript:alert(1)", "/a b", "/a\\b", "", 1]) expect(validPath(bad)).toBe(false);
  });
  it("toggles to the front, updates titles, caps at 30, drops invalid saved rows", () => {
    let list = toggleAppFavorite([], { path: "/gw/mail", title: "메일" }, true);
    list = toggleAppFavorite(list, { path: "/food", title: "뭐 먹지" }, true);
    list = toggleAppFavorite(list, { path: "/gw/mail", title: "아마란스 메일" }, true);
    expect(list).toEqual([{ path: "/gw/mail", title: "아마란스 메일" }, { path: "/food", title: "뭐 먹지" }]);
    expect(toggleAppFavorite(list, { path: "/food", title: "" }, false)).toEqual([{ path: "/gw/mail", title: "아마란스 메일" }]);
    for (let i = 0; i < 40; i++) list = toggleAppFavorite(list, { path: `/web?path=%2Fp${i}`, title: `p${i}` }, true);
    expect(list).toHaveLength(30);
    expect(parseAppFavorites(JSON.stringify([{ path: "//x", title: "x" }, { path: "/food", title: "뭐 먹지" }]))).toEqual([{ path: "/food", title: "뭐 먹지" }]);
    expect(parseAppFavorites("not json")).toEqual([]);
  });
});
