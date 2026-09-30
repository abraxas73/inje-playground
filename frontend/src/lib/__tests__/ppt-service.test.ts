import { describe, expect, it, vi } from "vitest";
import { createPptServiceClient, PptServiceError, resetCatalogCache } from "@/lib/ppt/service";

const catalogBody = { layouts: [{ name: "card-4", slide: 28, arity: 4, desc: "d", use: "u", closing: { required: true, maxLines: 2 }, chips: null, required: [], example: { layout: "card-4" } }], message: { name: "message", slide: 26, arity: null, desc: "", use: "", closing: null, chips: null, required: ["headline"], example: { layout: "message" } }, products: ["openstackit"], overview: ["tafa"], productExample: [], templateSlides: 106, package: "v3.1" };

function fetchMock(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const r = handler(String(url), init);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("createPptServiceClient", () => {
  it("sends the token header and caches the catalog", async () => {
    resetCatalogCache();
    const f = fetchMock(() => ({ status: 200, body: catalogBody }));
    const c = createPptServiceClient({ baseUrl: "http://svc", token: "t", fetchImpl: f });
    const a = await c.catalog();
    const b = await c.catalog();
    expect(a.layouts[0].name).toBe("card-4");
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
    const init = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    expect((init.headers as Record<string, string>)["x-ppt-token"]).toBe("t");
  });
  it("returns a typed failure for 422 build errors and throws for other errors", async () => {
    resetCatalogCache();
    const c = createPptServiceClient({ baseUrl: "http://svc", token: "t", fetchImpl: fetchMock((url) => (url.endsWith("/build") ? { status: 422, body: { ok: false, kind: "spec", message: "card-4는 4개", section: 0, slide: 1 } } : { status: 500, body: { detail: "boom" } })) });
    const r = await c.build({ spec: { meta: { title: ["a"] }, sections: [] }, upload: { pptxUrl: "u1", yamlUrl: "u2" } });
    expect(r).toEqual({ ok: false, kind: "spec", message: "card-4는 4개", section: 0, slide: 1 });
    await expect(c.extract("https://x/y")).rejects.toBeInstanceOf(PptServiceError);
  });
  it("maps 401 to a token mismatch message", async () => {
    const c = createPptServiceClient({ baseUrl: "http://svc", token: "t", fetchImpl: fetchMock(() => ({ status: 401, body: { detail: "unauthorized" } })) });
    await expect(c.extract("https://x/y")).rejects.toMatchObject({ status: 401, message: "PPT 서비스 토큰이 일치하지 않습니다(PPT_SERVICE_TOKEN)." });
  });
  it("treats a FastAPI validation 422 on /build as an error, not a build result", async () => {
    const c = createPptServiceClient({ baseUrl: "http://svc", token: "t", fetchImpl: fetchMock(() => ({ status: 422, body: { detail: [{ loc: ["body", "spec"], msg: "field required" }] } })) });
    const p = c.build({ spec: {}, upload: { pptxUrl: "u1", yamlUrl: "u2" } });
    await expect(p).rejects.toBeInstanceOf(PptServiceError);
    await expect(p).rejects.toThrow(/field required/);
  });
  it("throws PptServiceError when a 2xx body is not JSON", async () => {
    const f = vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    const c = createPptServiceClient({ baseUrl: "http://svc", token: "t", fetchImpl: f });
    await expect(c.extract("https://x/y")).rejects.toBeInstanceOf(PptServiceError);
  });
  it("fails clearly when env is missing", () => {
    expect(() => createPptServiceClient({ baseUrl: "", token: "" })).toThrow(PptServiceError);
  });
});
