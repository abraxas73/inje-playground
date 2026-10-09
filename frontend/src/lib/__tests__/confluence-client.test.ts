// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { confluenceRequest, createPage, readPage, searchPages, listSpaces, CONFLUENCE_BASE_RE } from "@/lib/confluence/client";
const base = "https://api.atlassian.com/ex/confluence/11111111-1111-1111-1111-111111111111";
afterEach(() => vi.unstubAllGlobals());
const req = (fetchImpl: ReturnType<typeof vi.fn>) => { vi.stubGlobal("fetch", fetchImpl); return (path: string, init?: RequestInit) => confluenceRequest(base, "tok", path, init); };

it("고정 게이트웨이·/wiki/rest/api/ 경로에만 Bearer로 보낸다", async () => {
  expect(CONFLUENCE_BASE_RE.test(base)).toBe(true);
  await expect(confluenceRequest("https://evil.test", "t", "/wiki/rest/api/space")).rejects.toMatchObject({ status: 500 });
  await expect(confluenceRequest(base, "t", "/rest/api/3/myself")).rejects.toMatchObject({ status: 500 });
  const f = vi.fn().mockResolvedValue(Response.json({ results: [] }));
  await req(f)("/wiki/rest/api/space?limit=1");
  expect(f.mock.calls[0][0]).toBe(base + "/wiki/rest/api/space?limit=1");
  expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
});
it("401은 다시 연결, 403은 권한 안내", async () => {
  await expect(req(vi.fn().mockResolvedValue(new Response("", { status: 401 })))("/wiki/rest/api/space")).rejects.toMatchObject({ status: 409, code: "reconnect" });
  await expect(req(vi.fn().mockResolvedValue(new Response("", { status: 403 })))("/wiki/rest/api/space")).rejects.toMatchObject({ status: 403 });
});
it("검색은 CQL·상한을 넣고 결과를 항목으로", async () => {
  const f = vi.fn().mockResolvedValue(Response.json({ results: [{ content: { id: "1", type: "page", title: "회의록", space: { key: "D", name: "개발" }, _links: { webui: "/spaces/D/pages/1" } }, excerpt: "", lastModified: "2026-10-01T00:00:00Z" }, { content: {} }] }));
  const items = await searchPages(req(f), "회의 \"록\"", { limit: 50 });
  const url = new URL(f.mock.calls[0][0]);
  expect(url.searchParams.get("cql")).toBe('type in (page, blogpost) and text ~ "회의 \\"록\\"" order by lastmodified desc');
  expect(url.searchParams.get("limit")).toBe("25");
  expect(items.map((i) => i.id)).toEqual(["1"]);
});
it("페이지 읽기는 숫자 id만, 본문은 텍스트로 바꿔 자른다", async () => {
  await expect(readPage(req(vi.fn()), "../x")).rejects.toMatchObject({ status: 400 });
  const f = vi.fn().mockResolvedValue(Response.json({ id: "7", title: "가이드", space: { key: "D", name: "개발" }, version: { number: 3, when: "2026-10-01T00:00:00Z", by: { displayName: "김" } }, body: { storage: { value: "<h1>제목</h1><p>본문 &amp; 내용</p>" } }, _links: { webui: "/spaces/D/pages/7" } }));
  const p = await readPage(req(f), "7", 5);
  expect(f.mock.calls[0][0]).toContain("/wiki/rest/api/content/7?expand=body.storage%2Cspace%2Cversion");
  expect(p).toMatchObject({ id: "7", title: "가이드", spaceKey: "D", url: "https://pms-innogrid.atlassian.net/wiki/spaces/D/pages/7", version: 3, truncated: true });
  expect(p.text.length).toBeLessThanOrEqual(5);
});
it("공간 목록·페이지 만들기(제목·공간·상위 페이지·저장 형식 본문)", async () => {
  const f = vi.fn().mockResolvedValueOnce(Response.json({ results: [{ entityType: "space", space: { key: "D", name: "개발", type: "global" } }, { space: { key: "~me", name: "내 공간", type: "personal" } }, { space: { key: "~other", name: "남의 공간", type: "personal" } }, { space: { key: "D", name: "개발" } }, { title: "x" }], _links: { next: "/rest/api/search?cql=type&cursor=abc" } }))
    .mockResolvedValueOnce(Response.json({ results: [{ space: { key: "Z", name: "마지막", type: "global" } }] }))
    .mockResolvedValueOnce(Response.json({ id: "99", title: "회의록", _links: { webui: "/spaces/D/pages/99" } }));
  const r = req(f);
  expect(await listSpaces(r, "me")).toEqual([{ key: "D", name: "개발", type: "global" }, { key: "~me", name: "내 공간", type: "personal" }, { key: "Z", name: "마지막", type: "global" }]);
  expect(new URL(f.mock.calls[0][0]).searchParams.get("cql")).toBe("type = space order by title");
  expect(f.mock.calls[1][0]).toBe(base + "/wiki/rest/api/search?cql=type&cursor=abc");
  const made = await createPage(r, { spaceKey: "D", parentId: "5", title: "회의록", markdown: "# 안건\n- 배포" });
  const [url, init] = f.mock.calls[2];
  expect(url).toBe(base + "/wiki/rest/api/content");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ type: "page", title: "회의록", space: { key: "D" }, ancestors: [{ id: "5" }], body: { storage: { value: "<h1>안건</h1><ul><li>배포</li></ul>", representation: "storage" } } });
  expect(made).toEqual({ id: "99", title: "회의록", url: "https://pms-innogrid.atlassian.net/wiki/spaces/D/pages/99" });
});
