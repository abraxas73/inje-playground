import { describe, expect, it } from "vitest";
import { addConfluenceFavorite, favoriteIdFrom, parseConfluenceFavorites, removeConfluenceFavorite, resolveConfluenceFavorite, type ConfluenceFavorite } from "@/lib/confluence/favorites";

const fav = (id: string): ConfluenceFavorite => ({ id, type: "page", title: `문서 ${id}`, spaceName: "R&D본부", url: `https://pms-innogrid.atlassian.net/wiki/spaces/RD/pages/${id}`, addedAt: "2026-10-29T00:00:00.000Z" });

describe("Confluence 즐겨찾기", () => {
  it("저장값 해석 — 깨진 JSON·모양이 틀린 항목은 버린다", () => {
    expect(parseConfluenceFavorites("{")).toEqual([]);
    expect(parseConfluenceFavorites(JSON.stringify([fav("1"), { id: 2 }, null]))).toEqual([fav("1")]);
  });
  it("추가는 맨 앞(중복이면 앞으로), 30개가 차면 거절, 삭제는 id로", () => {
    expect(addConfluenceFavorite([fav("1"), fav("2")], fav("2")).map((f) => f.id)).toEqual(["2", "1"]);
    const full = Array.from({ length: 30 }, (_, i) => fav(String(i + 1)));
    expect(() => addConfluenceFavorite(full, fav("99"))).toThrow("30개");
    expect(addConfluenceFavorite(full, fav("5"))[0].id).toBe("5");
    expect(removeConfluenceFavorite([fav("1"), fav("2")], "1").map((f) => f.id)).toEqual(["2"]);
  });
  it("id 또는 회사 Confluence 링크 → 내용 번호, 다른 사이트·짧은 링크·빈 값은 400", () => {
    expect(favoriteIdFrom({ id: "123" })).toBe("123");
    expect(favoriteIdFrom({ url: "https://pms-innogrid.atlassian.net/wiki/spaces/RD/pages/4567/제목" })).toBe("4567");
    for (const body of [{ url: "https://evil.example.com/wiki/spaces/RD/pages/1" }, { url: "https://pms-innogrid.atlassian.net/wiki/x/AbC" }, { id: "1 or 1=1" }, {}])
      expect(() => favoriteIdFrom(body)).toThrow(expect.objectContaining({ status: 400 }));
  });
  it("CQL id로 본인 권한에서 찾아 제목·공간·주소를 채우고, 없으면 404", async () => {
    const paths: string[] = [];
    const found = await resolveConfluenceFavorite(async (p) => { paths.push(p); return { results: [{ content: { id: "4567", type: "page", title: "주간회의", space: { name: "R&D본부" }, _links: { webui: "/spaces/RD/pages/4567" } } }] }; }, "4567", new Date("2026-10-29T00:00:00Z"));
    expect(new URLSearchParams(paths[0].split("?")[1]).get("cql")).toBe("id = 4567");
    expect(found).toEqual({ id: "4567", type: "page", title: "주간회의", spaceName: "R&D본부", url: "https://pms-innogrid.atlassian.net/wiki/spaces/RD/pages/4567", addedAt: "2026-10-29T00:00:00.000Z" });
    await expect(resolveConfluenceFavorite(async () => ({ results: [] }), "1")).rejects.toMatchObject({ status: 404 });
  });
});
