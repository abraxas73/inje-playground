import { expect, it } from "vitest";
import { addFavorite, containerFromUrl, dedupe, isSharepointUrl, mapDriveItem, mapInsight, mapSearchResponse, parseFavorites, removeFavorite, searchBody, FAVORITES_MAX, type Favorite } from "@/lib/sharepoint/core";

it("회사 SharePoint·OneDrive 주소 판별", () => {
  expect(isSharepointUrl("https://innogridoffice.sharepoint.com/:x:/s/PQS/abc")).toBe(true);
  expect(isSharepointUrl("https://innogridoffice-my.sharepoint.com/personal/a_b/Documents/x.docx")).toBe(true);
  expect(isSharepointUrl("https://evil.sharepoint.com.attacker.test/x")).toBe(false);
  expect(isSharepointUrl("https://pms-innogrid.atlassian.net/wiki/x")).toBe(false);
  expect(isSharepointUrl("nope")).toBe(false);
});
it("webUrl → 짧은 위치(사이트 › 폴더, 파일 이름 제외, 개인 OneDrive는 OneDrive)", () => {
  expect(containerFromUrl("https://innogridoffice.sharepoint.com/sites/%EC%98%81%EC%97%85%EB%B3%B8%EB%B6%80/Shared%20Documents/2026/%EC%A0%9C%EC%95%88%EC%84%9C.pptx")).toBe("영업본부 › 2026");
  expect(containerFromUrl("https://innogridoffice-my.sharepoint.com/personal/seunguk_kang_innogrid_com/Documents/메모/a.docx")).toBe("OneDrive › 메모");
  expect(containerFromUrl("https://innogridoffice.sharepoint.com/sites/A/Shared%20Documents/폴더", true)).toBe("A › 폴더");
  expect(containerFromUrl("bad")).toBe("");
});
it("driveItem 매핑 — remoteItem이 있으면 그쪽이 실제 항목, id·driveId·이름이 없으면 null", () => {
  const plain = mapDriveItem({ id: "1", name: "a.docx", webUrl: "https://x.sharepoint.com/sites/S/Shared%20Documents/a.docx", lastModifiedDateTime: "2026-10-01T00:00:00Z", lastModifiedBy: { user: { displayName: "홍길동" } }, parentReference: { driveId: "d1" }, file: {} });
  expect(plain).toMatchObject({ id: "1", driveId: "d1", name: "a.docx", ext: "docx", kind: "file", container: "S", by: "홍길동", at: "2026-10-01T00:00:00Z" });
  const remote = mapDriveItem({ id: "local", name: "a.xlsx", webUrl: "https://x", remoteItem: { id: "r1", name: "b.xlsx", webUrl: "https://y.sharepoint.com/sites/T/Shared%20Documents/b.xlsx", parentReference: { driveId: "d2" }, folder: {} } });
  expect(remote).toMatchObject({ id: "r1", driveId: "d2", name: "b.xlsx", kind: "folder", ext: "", url: "https://y.sharepoint.com/sites/T/Shared%20Documents/b.xlsx" });
  expect(mapDriveItem({ id: "1", name: "x" })).toBeNull();
  expect(mapDriveItem(null)).toBeNull();
});
it("인사이트 매핑 — drives/{d}/items/{i}만, 제목·컨테이너·사용/공유 시각·공유한 사람", () => {
  const used = mapInsight({ id: "u", lastUsed: { lastAccessedDateTime: "2026-10-09T01:00:00Z" }, resourceVisualization: { title: "주간보고.docx", type: "Word", containerDisplayName: "경영기획" }, resourceReference: { webUrl: "https://x/a.docx", id: "drives/d1/items/i1" } });
  expect(used).toMatchObject({ id: "i1", driveId: "d1", name: "주간보고.docx", container: "경영기획", at: "2026-10-09T01:00:00Z", ext: "docx" });
  const shared = mapInsight({ lastShared: { sharedDateTime: "2026-10-08T00:00:00Z", sharedBy: { user: { displayName: "김민준" } } }, resourceVisualization: { title: "제안서.pptx" }, resourceReference: { webUrl: "https://x.sharepoint.com/sites/S/Shared%20Documents/제안서.pptx", id: "drives/d1/items/i2" } });
  expect(shared).toMatchObject({ id: "i2", by: "김민준", at: "2026-10-08T00:00:00Z", container: "S" });
  expect(mapInsight({ resourceVisualization: { title: "웹 링크" }, resourceReference: { id: "https://web", webUrl: "https://web" } })).toBeNull();
});
it("검색 본문은 따옴표를 빼고 25개 상한, 응답은 폴더 제외·중복 제거", () => {
  expect(searchBody(' 제안서 "2026" \\x ', 99)).toEqual({ requests: [{ entityTypes: ["driveItem"], query: { queryString: "제안서 2026 x" }, from: 0, size: 25 }] });
  const hit = (id: string, extra: object = {}) => ({ resource: { id, name: `${id}.docx`, webUrl: "https://x", parentReference: { driveId: "d" }, ...extra } });
  const items = mapSearchResponse({ value: [{ hitsContainers: [{ hits: [hit("1"), hit("1"), hit("2", { folder: {} }), hit("3")] }] }] });
  expect(items.map((i) => i.id)).toEqual(["1", "3"]);
  expect(dedupe([null, items[0], items[0]])).toHaveLength(1);
});
it("즐겨찾기 — JSON 검증·상한·앞에 넣기·같은 문서 교체·빼기", () => {
  expect(parseFavorites(undefined)).toEqual([]);
  expect(parseFavorites("nope")).toEqual([]);
  expect(parseFavorites(JSON.stringify([{ driveId: "d", id: "1", name: "a", url: "u" }, { bad: true }]))).toHaveLength(1);
  const f = (id: string): Favorite => ({ driveId: "d", id, name: id, url: "u", container: "", kind: "file", addedAt: "t" });
  const list = addFavorite([f("1"), f("2")], f("2"));
  expect(list.map((x) => x.id)).toEqual(["2", "1"]);
  expect(removeFavorite(list, "d/2").map((x) => x.id)).toEqual(["1"]);
  expect(() => addFavorite(Array.from({ length: FAVORITES_MAX }, (_, i) => f(String(i))), f("new"))).toThrow(/30개/);
});
