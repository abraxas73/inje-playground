// @vitest-environment node
import { expect, it, vi } from "vitest";
import { feed, readDoc, resolveRef, searchDocs } from "@/lib/sharepoint/client";

const G = "https://graph.microsoft.com/v1.0";
const item = (id: string, name: string, extra: object = {}) => ({ id, name, webUrl: `https://x.sharepoint.com/sites/S/Shared%20Documents/${name}`, parentReference: { driveId: "d1" }, lastModifiedDateTime: "2026-10-01T00:00:00Z", file: {}, ...extra });
const insight = (id: string, title: string) => ({ id: `in-${id}`, lastUsed: { lastAccessedDateTime: "2026-10-09T00:00:00Z" }, resourceVisualization: { title, type: "Word", containerDisplayName: "경영기획" }, resourceReference: { id: `drives/d1/items/${id}`, webUrl: "https://x/a.docx" } });

it("자주 쓰는 문서는 /me/insights/used, Bearer·상한 적용, 중복·폴더 제외", async () => {
  const f = vi.fn().mockResolvedValue(Response.json({ value: [insight("1", "a.docx"), insight("1", "a.docx"), insight("2", "b.pdf")] }));
  const r = await feed("tok", "used", 1, f);
  expect(f.mock.calls[0][0]).toBe(`${G}/me/insights/used?$top=2`);
  expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  expect(r).toMatchObject({ kind: "used", source: "used" });
  expect(r.items.map((i) => i.id)).toEqual(["1"]);
});
it("인사이트가 꺼진 조직(403·404): used는 최근 연 문서로 갈음, shared·trending은 unavailable", async () => {
  const f = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: "Forbidden" } }, { status: 403 })).mockResolvedValueOnce(Response.json({ value: [item("9", "r.docx")] }));
  const r = await feed("tok", "used", 5, f);
  expect(f.mock.calls[1][0]).toBe(`${G}/me/drive/recent?$top=10`);
  expect(r).toMatchObject({ kind: "used", source: "recent" });
  expect(r.items[0]).toMatchObject({ id: "9", driveId: "d1" });
  const g = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
  expect(await feed("tok", "shared", 5, g)).toMatchObject({ kind: "shared", items: [], unavailable: true });
  const h = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
  await expect(feed("tok", "trending", 5, h)).rejects.toMatchObject({ status: 500 });
});
it("검색은 POST /search/query(driveItem), 빈 검색어는 400", async () => {
  const f = vi.fn().mockResolvedValue(Response.json({ value: [{ hitsContainers: [{ hits: [{ resource: item("3", "c.xlsx") }] }] }] }));
  const items = await searchDocs("tok", "제안서", 5, f);
  expect(f.mock.calls[0][0]).toBe(`${G}/search/query`);
  expect(JSON.parse(f.mock.calls[0][1].body).requests[0]).toMatchObject({ entityTypes: ["driveItem"], query: { queryString: "제안서" }, from: 0, size: 5, fields: expect.arrayContaining(["file", "folder"]) });
  expect(items.map((i) => i.name)).toEqual(["c.xlsx"]);
  await expect(searchDocs("tok", '""', 5, f)).rejects.toMatchObject({ status: 400 });
});
it("링크는 shares로, driveId/id는 drives로 해석하고 400·404는 안내, 403은 권한", async () => {
  const f = vi.fn().mockImplementation(async () => Response.json({ ...item("5", "e.docx"), size: 10, "@microsoft.graph.downloadUrl": "https://dl" }));
  expect(await resolveRef("tok", { url: "https://x.sharepoint.com/:w:/s/S/abc" }, f)).toMatchObject({ id: "5", downloadUrl: "https://dl", size: 10 });
  expect(f.mock.calls[0][0]).toMatch(new RegExp(`^${G}/shares/u!`));
  await resolveRef("tok", { driveId: "d1", id: "5" }, f);
  expect(f.mock.calls[1][0]).toBe(`${G}/drives/d1/items/5`);
  await expect(resolveRef("tok", { url: "http://x" }, f)).rejects.toMatchObject({ status: 400 });
  await expect(resolveRef("tok", { driveId: "../", id: "5" }, f)).rejects.toMatchObject({ status: 400 });
  await expect(resolveRef("tok", { driveId: "d1", id: "5" }, vi.fn().mockResolvedValue(new Response("", { status: 404 })))).rejects.toMatchObject({ status: 400 });
  await expect(resolveRef("tok", { driveId: "d1", id: "5" }, vi.fn().mockResolvedValue(new Response("", { status: 403 })))).rejects.toMatchObject({ status: 403, code: "forbidden" });
});
it("본문 읽기 — txt는 내려받아 텍스트, pptx는 내려받은 파일로 추출, 폴더·지원 밖 형식·큰 파일은 거절", async () => {
  const meta = (name: string, extra: object = {}) => Response.json({ ...item("7", name), size: 10, "@microsoft.graph.downloadUrl": "https://dl", ...extra });
  const f = vi.fn().mockResolvedValueOnce(meta("memo.txt")).mockResolvedValueOnce(new Response("안녕하세요 본문입니다"));
  const r = await readDoc("tok", { driveId: "d1", id: "7" }, 5, { fetchImpl: f });
  expect(f.mock.calls[1][0]).toBe(`${G}/drives/d1/items/7/content`);
  expect(r).toMatchObject({ item: { id: "7", name: "memo.txt" }, text: "안녕하세요", truncated: true });
  expect((r.item as unknown as Record<string, unknown>).downloadUrl).toBeUndefined();
  const extract = vi.fn().mockResolvedValue("1. 표지\n2. 개요");
  const p = await readDoc("tok", { driveId: "d1", id: "7" }, 100, { fetchImpl: vi.fn().mockResolvedValueOnce(meta("deck.pptx")).mockResolvedValueOnce(new Response("PK")), extractPptx: extract });
  expect(extract.mock.calls[0][0]).toBeInstanceOf(Buffer);
  expect(extract.mock.calls[0][1]).toBe("deck.pptx");
  expect(p.text).toBe("1. 표지\n2. 개요");
  await expect(readDoc("tok", { driveId: "d1", id: "7" }, 100, { fetchImpl: vi.fn().mockResolvedValue(meta("deck.pptx")) })).rejects.toMatchObject({ status: 503 });
  await expect(readDoc("tok", { driveId: "d1", id: "7" }, 100, { fetchImpl: vi.fn().mockResolvedValue(meta("폴더", { folder: {}, file: undefined })) })).rejects.toMatchObject({ status: 400 });
  await expect(readDoc("tok", { driveId: "d1", id: "7" }, 100, { fetchImpl: vi.fn().mockResolvedValue(meta("a.zip")) })).rejects.toMatchObject({ status: 415 });
  await expect(readDoc("tok", { driveId: "d1", id: "7" }, 100, { fetchImpl: vi.fn().mockResolvedValue(meta("a.docx", { size: 21 * 1024 * 1024 })) })).rejects.toMatchObject({ status: 413 });
});
