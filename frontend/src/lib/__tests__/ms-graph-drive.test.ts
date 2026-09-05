// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  encodeShareUrl, resolveFolder, uploadFile, fetchWithRetry, retryDelayMs, GraphError, FolderResolveError, SMALL_UPLOAD_MAX, CHUNK_SIZE, XLSX_MIME,
} from "@/lib/ms/graph-drive";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const noSleep = vi.fn(async () => undefined);
const FOLDER_URL = "https://innogrid.sharepoint.com/sites/RFP/Shared%20Documents/2026/%EC%A0%9C%EC%95%88";
const folderItem = { id: "01ITEM", name: "제안", webUrl: FOLDER_URL, folder: { childCount: 3 }, parentReference: { driveId: "b!drive" } };
const target = { driveId: "b!drive", itemId: "01ITEM", fileName: "(한국석유공사) 사업_요구사항 검토_20260905.xlsx" };

describe("encodeShareUrl", () => {
  it("u! + base64url(패딩 없음, +/ 대신 -_)", () => {
    expect(encodeShareUrl(FOLDER_URL)).toBe("u!aHR0cHM6Ly9pbm5vZ3JpZC5zaGFyZXBvaW50LmNvbS9zaXRlcy9SRlAvU2hhcmVkJTIwRG9jdW1lbnRzLzIwMjYvJUVDJUEwJTlDJUVDJTk1JTg4");
    expect(encodeShareUrl("https://onedrive.live.com/redir?resid=1231244193912!12&authKey=1201919!12921!1")).toBe("u!aHR0cHM6Ly9vbmVkcml2ZS5saXZlLmNvbS9yZWRpcj9yZXNpZD0xMjMxMjQ0MTkzOTEyITEyJmF1dGhLZXk9MTIwMTkxOSExMjkyMSEx");
    expect(encodeShareUrl("https://a/b?c=d&e=f/g+h")).not.toMatch(/[+/=]/);
  });
});

describe("retryDelayMs / fetchWithRetry", () => {
  it("Retry-After 없으면 2초, 있으면 초 단위, 최대 5초", () => {
    expect(retryDelayMs(null)).toBe(2000);
    expect(retryDelayMs("1")).toBe(1000);
    expect(retryDelayMs("10")).toBe(5000);
    expect(retryDelayMs("abc")).toBe(2000);
    expect(retryDelayMs("0")).toBe(2000);
  });
  it("429·503은 한 번만 재시도하고, 다른 상태는 바로 돌려준다", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "1" } })).mockResolvedValueOnce(json(200, { ok: 1 }));
    const res = await fetchWithRetry(fetchImpl, "https://g/x", { method: "GET" }, sleep);
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);

    const twice = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const res2 = await fetchWithRetry(twice, "https://g/x", {}, sleep);
    expect(res2.status).toBe(503);
    expect(twice).toHaveBeenCalledTimes(2);

    const once = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    await fetchWithRetry(once, "https://g/x", {}, sleep);
    expect(once).toHaveBeenCalledTimes(1);
  });
});

describe("resolveFolder", () => {
  it("shares/{enc}/driveItem을 Bearer로 조회해 driveId·itemId·name·webUrl", async () => {
    const fetchImpl = vi.fn(async () => json(200, folderItem));
    expect(await resolveFolder("AT", FOLDER_URL, fetchImpl, noSleep)).toEqual({ driveId: "b!drive", itemId: "01ITEM", name: "제안", webUrl: FOLDER_URL });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.microsoft.com/v1.0/shares/${encodeShareUrl(FOLDER_URL)}/driveItem?$select=id,name,webUrl,folder,parentReference`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer AT");
  });
  it("folder 패싯이 없으면(파일 링크) FolderResolveError 400", async () => {
    const { folder: _f, ...file } = folderItem;
    const fetchImpl = vi.fn(async () => json(200, { ...file, file: { mimeType: "x" } }));
    await expect(resolveFolder("AT", FOLDER_URL, fetchImpl, noSleep)).rejects.toMatchObject({ status: 400, message: "폴더 링크가 아닙니다. 파일이 아닌 폴더의 링크를 붙여 주세요." });
  });
  it("404·400은 '링크를 해석할 수 없습니다', 403은 '볼 권한이 없습니다'", async () => {
    const mk = (status: number) => vi.fn(async () => json(status, { error: { code: "itemNotFound", message: "x" } }));
    await expect(resolveFolder("AT", FOLDER_URL, mk(404), noSleep)).rejects.toMatchObject({ status: 400, message: "링크를 해석할 수 없습니다. 폴더의 '링크 복사'를 사용하세요." });
    await expect(resolveFolder("AT", FOLDER_URL, mk(400), noSleep)).rejects.toBeInstanceOf(FolderResolveError);
    await expect(resolveFolder("AT", FOLDER_URL, mk(403), noSleep)).rejects.toMatchObject({ status: 403, message: "이 폴더를 볼 권한이 없습니다." });
  });
  it("5xx는 GraphError(status, code, requestId)", async () => {
    const fetchImpl = vi.fn(async () => json(500, { error: { code: "generalException", message: "boom" } }, { "request-id": "req-1" }));
    const err = await resolveFolder("AT", FOLDER_URL, fetchImpl, noSleep).catch((e) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect(err).toMatchObject({ status: 500, code: "generalException", message: "boom", requestId: "req-1" });
  });
});

describe("uploadFile", () => {
  const item = { id: "01FILE", name: target.fileName, webUrl: "https://innogrid.sharepoint.com/sites/RFP/x.xlsx", size: 1234 };
  it("4MiB 미만은 :/content?conflictBehavior=replace 로 단순 PUT", async () => {
    const buffer = Buffer.alloc(SMALL_UPLOAD_MAX - 1, 1);
    const fetchImpl = vi.fn(async () => json(201, item));
    expect(await uploadFile("AT", { ...target, buffer }, fetchImpl, noSleep)).toEqual(item);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.microsoft.com/v1.0/drives/b!drive/items/01ITEM:/${encodeURIComponent(target.fileName)}:/content?@microsoft.graph.conflictBehavior=replace`);
    expect(init.method).toBe("PUT");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer AT");
    expect(h["Content-Type"]).toBe(XLSX_MIME);
    expect((init.body as Uint8Array).byteLength).toBe(SMALL_UPLOAD_MAX - 1);
  });
  it("4MiB 이상은 업로드 세션 + 10MiB 청크(25MiB → 10/10/5), 청크 PUT에는 Authorization 없음", async () => {
    const total = 25 * 1024 * 1024;
    const buffer = Buffer.alloc(total, 2);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { uploadUrl: "https://up.sharepoint.com/session/abc" }))
      .mockResolvedValueOnce(json(202, { nextExpectedRanges: ["10485760-"] }))
      .mockResolvedValueOnce(json(202, { nextExpectedRanges: ["20971520-"] }))
      .mockResolvedValueOnce(json(201, item));
    expect(await uploadFile("AT", { ...target, buffer }, fetchImpl, noSleep)).toEqual(item);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const [sessUrl, sessInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(sessUrl).toBe(`https://graph.microsoft.com/v1.0/drives/b!drive/items/01ITEM:/${encodeURIComponent(target.fileName)}:/createUploadSession`);
    expect(sessInit.method).toBe("POST");
    expect(JSON.parse(sessInit.body as string)).toEqual({ item: { "@microsoft.graph.conflictBehavior": "replace", name: target.fileName } });
    const ranges = fetchImpl.mock.calls.slice(1).map((c) => (c as unknown as [string, RequestInit])[1]);
    expect(fetchImpl.mock.calls.slice(1).every((c) => (c as unknown as [string])[0] === "https://up.sharepoint.com/session/abc")).toBe(true);
    expect(ranges.map((r) => (r.headers as Record<string, string>)["Content-Range"])).toEqual([`bytes 0-10485759/${total}`, `bytes 10485760-20971519/${total}`, `bytes 20971520-26214399/${total}`]);
    expect(ranges.map((r) => (r.body as Uint8Array).byteLength)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 5 * 1024 * 1024]);
    expect(ranges.every((r) => !(r.headers as Record<string, string>).Authorization)).toBe(true);
  });
  it("정확히 4MiB는 세션 경로(세션 1 + 청크 1)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, { uploadUrl: "https://up/s" })).mockResolvedValueOnce(json(201, item));
    await uploadFile("AT", { ...target, buffer: Buffer.alloc(SMALL_UPLOAD_MAX) }, fetchImpl, noSleep);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("423(잠김)·403은 GraphError로 상태·코드를 보존한다", async () => {
    const fetchImpl = vi.fn(async () => json(423, { error: { code: "resourceLocked", message: "locked" } }, { "request-id": "r-2" }));
    await expect(uploadFile("AT", { ...target, buffer: Buffer.alloc(10) }, fetchImpl, noSleep)).rejects.toMatchObject({ status: 423, code: "resourceLocked", requestId: "r-2" });
  });
  it("세션 응답에 uploadUrl이 없으면 GraphError(no_upload_url)", async () => {
    const fetchImpl = vi.fn(async () => json(200, {}));
    await expect(uploadFile("AT", { ...target, buffer: Buffer.alloc(SMALL_UPLOAD_MAX) }, fetchImpl, noSleep)).rejects.toMatchObject({ code: "no_upload_url" });
  });
  it("429는 Retry-After 뒤 한 번 재시도해 성공하면 정상 반환", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "3" } })).mockResolvedValueOnce(json(201, item));
    expect(await uploadFile("AT", { ...target, buffer: Buffer.alloc(10) }, fetchImpl, sleep)).toEqual(item);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
