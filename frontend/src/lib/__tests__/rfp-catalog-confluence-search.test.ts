// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { confluenceConfig, ConfluenceFetchError } from "@/lib/rfp/catalog/confluence";
import { buildTitleCql, searchConfluencePages, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX } from "@/lib/rfp/catalog/confluence-search";

const cfg = confluenceConfig({ ATLASSIAN_SITE: "https://pms-innogrid.atlassian.net/", ATLASSIAN_EMAIL: "a@b.c", ATLASSIAN_API_TOKEN: "tok" })!;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("buildTitleCql", () => {
  it("따옴표·역슬래시를 없애고 공백을 정리한 제목 검색 CQL", () => {
    expect(buildTitleCql('  기능명세서  v2.6 "x" \\y ')).toBe('type=page AND title ~ "기능명세서 v2.6 x y" ORDER BY lastmodified DESC');
  });
});

describe("searchConfluencePages", () => {
  const body = {
    results: [
      { id: 1789919378, title: "SECloudit 2.6 기능명세서", space: { key: "rndshare", name: "R&D 공유" }, version: { when: "2026-08-01T00:00:00.000Z" }, _links: { webui: "/spaces/rndshare/pages/1789919378/SECloudit+2.6" } },
      { id: "5", title: "제목만", _links: {} },
      { title: "id 없음" },
    ],
  };
  it("CQL·limit·expand로 부르고 결과를 매핑한다(url = site + /wiki + webui)", async () => {
    const fetchImpl = vi.fn(async () => json(200, body));
    const hits = await searchConfluencePages(cfg, "기능명세서", 5, fetchImpl as unknown as typeof fetch);
    expect(hits).toEqual([
      { pageId: "1789919378", title: "SECloudit 2.6 기능명세서", spaceKey: "rndshare", spaceName: "R&D 공유", url: "https://pms-innogrid.atlassian.net/wiki/spaces/rndshare/pages/1789919378/SECloudit+2.6", lastModified: "2026-08-01T00:00:00.000Z" },
      { pageId: "5", title: "제목만", spaceKey: null, spaceName: null, url: "https://pms-innogrid.atlassian.net/wiki", lastModified: null },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://pms-innogrid.atlassian.net/wiki/rest/api/content/search?cql=${encodeURIComponent(buildTitleCql("기능명세서"))}&expand=space,version&limit=5`);
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });
  it("limit은 1~25로 자르고 기본 20", async () => {
    const fetchImpl = vi.fn(async () => json(200, { results: [] }));
    await searchConfluencePages(cfg, "x", 999, fetchImpl as unknown as typeof fetch);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain(`&limit=${SEARCH_LIMIT_MAX}`);
    await searchConfluencePages(cfg, "x", undefined, fetchImpl as unknown as typeof fetch);
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toContain(`&limit=${SEARCH_LIMIT_DEFAULT}`);
  });
  it("비-2xx는 ConfluenceFetchError(status)", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 502 }));
    await expect(searchConfluencePages(cfg, "x", 5, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({ status: 502, message: "Confluence 검색 실패(502)" });
    await expect(searchConfluencePages(cfg, "x", 5, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(ConfluenceFetchError);
  });
});
