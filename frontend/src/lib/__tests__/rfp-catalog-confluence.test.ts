// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  confluenceConfig, parseConfluencePageId, fetchConfluencePage, ConfluenceUrlError, ConfluenceFetchError,
} from "@/lib/rfp/catalog/confluence";

const HOST = "nhnent.atlassian.net";
const ENV: Record<string, string | undefined> = { ATLASSIAN_SITE: `https://${HOST}/`, ATLASSIAN_EMAIL: "a@b.c", ATLASSIAN_API_TOKEN: "tok" };

describe("confluenceConfig", () => {
  it("세 변수가 모두 있어야 하고 끝 슬래시를 떼고 host를 준다", () => {
    expect(confluenceConfig(ENV)).toMatchObject({ site: `https://${HOST}`, host: HOST });
    expect(confluenceConfig(ENV)!.auth).toMatch(/^Basic /);
    const partial: Record<string, string | undefined> = { ATLASSIAN_SITE: `https://${HOST}` };
    expect(confluenceConfig(partial)).toBeNull();
  });
});

describe("parseConfluencePageId", () => {
  it("스페이스 경로·viewpage·pages 3형태에서 id를 뽑는다", () => {
    expect(parseConfluencePageId(`https://${HOST}/wiki/spaces/SEC/pages/123456/SECloudit+기능`, HOST)).toBe("123456");
    expect(parseConfluencePageId(`https://${HOST}/wiki/spaces/SEC/pages/123456`, HOST)).toBe("123456");
    expect(parseConfluencePageId(`https://${HOST}/wiki/pages/viewpage.action?pageId=987`, HOST)).toBe("987");
    expect(parseConfluencePageId(`  https://${HOST}/wiki/pages/555/  `, HOST)).toBe("555");
  });
  it("짧은 링크·다른 호스트·형식 불일치·URL 아님은 ConfluenceUrlError", () => {
    expect(() => parseConfluencePageId(`https://${HOST}/wiki/x/AbCd`, HOST)).toThrow(/짧은 링크/);
    expect(() => parseConfluencePageId("https://other.atlassian.net/wiki/spaces/A/pages/1", HOST)).toThrow(/설정된 Confluence 사이트\(nhnent\.atlassian\.net\)/);
    expect(() => parseConfluencePageId(`https://${HOST}/wiki/spaces/SEC/overview`, HOST)).toThrow(/전체 URL/);
    expect(() => parseConfluencePageId("not a url", HOST)).toThrow(ConfluenceUrlError);
  });
});

describe("fetchConfluencePage", () => {
  const cfg = confluenceConfig(ENV)!;
  it("id로 REST를 부르고 title·version·storage 본문을 돌려준다", async () => {
    let calledUrl = "";
    let authHeader = "";
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(url);
      authHeader = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ id: "42", title: "기능 목록", version: { number: 7 }, body: { storage: { value: "<p>hi</p>" } } }), { status: 200 });
    }) as typeof fetch;
    await expect(fetchConfluencePage(cfg, "42", fetchImpl)).resolves.toEqual({ id: "42", title: "기능 목록", version: 7, storageHtml: "<p>hi</p>" });
    expect(calledUrl).toBe(`https://${HOST}/wiki/rest/api/content/42?expand=body.storage,version`);
    expect(authHeader).toBe(cfg.auth);
  });
  it("403·404·5xx는 ConfluenceFetchError와 한국어 문구", async () => {
    const mk = (status: number) => (async () => new Response("no", { status })) as typeof fetch;
    await expect(fetchConfluencePage(cfg, "1", mk(403))).rejects.toMatchObject({ status: 403, message: "권한 없음(403)" });
    await expect(fetchConfluencePage(cfg, "1", mk(404))).rejects.toMatchObject({ status: 404, message: "페이지 없음(404)" });
    await expect(fetchConfluencePage(cfg, "1", mk(500))).rejects.toBeInstanceOf(ConfluenceFetchError);
    await expect(fetchConfluencePage(cfg, "1", mk(500))).rejects.toThrow("Confluence 오류(500)");
  });
});
