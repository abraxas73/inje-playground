import { describe, expect, it } from "vitest";
import { checkSourceUrl, clampSourceText, decodeBody, fetchUrlSource, htmlToText, UrlSourceError } from "@/lib/ppt/web-source";
import { SOURCE_MAX_CHARS } from "@/types/ppt";

const page = `<!doctype html><html><head><meta charset="utf-8"><title> 사내 LLM &amp; 위키 </title><style>p{}</style><script>var x=1</script></head>
<body><header><nav><a href="/">홈</a> 메뉴</nav></header>
<main><h1>제목 하나</h1><p>첫 문단입니다 &nbsp; 공백&#44; 그리고 &lt;태그&gt;.</p>
<h2>목록</h2><ul><li>첫째</li><li>둘째<br>줄바꿈</li></ul>
<table><tr><th>구분</th><th>값</th></tr><tr><td>A</td><td>1</td></tr></table>
<!-- 주석 --><p>${"본문 ".repeat(60)}</p></main>
<aside>사이드바 광고</aside><footer>푸터</footer></body></html>`;

describe("htmlToText", () => {
  it("keeps the main content as light markdown and drops chrome, scripts, comments", () => {
    const { title, text } = htmlToText(page);
    expect(title).toBe("사내 LLM & 위키");
    expect(text).toContain("# 제목 하나");
    expect(text).toContain("첫 문단입니다 공백, 그리고 <태그>.");
    expect(text).toContain("## 목록\n\n- 첫째\n- 둘째\n줄바꿈");
    expect(text).toContain("구분 | 값\nA | 1");
    for (const bad of ["메뉴", "사이드바", "푸터", "var x", "주석", "p{}"]) expect(text).not.toContain(bad);
  });
  it("falls back to <body> when there is no substantial <main>/<article>", () => {
    const { text } = htmlToText("<html><body><main>짧음</main><div><p>본문 문단 1</p><p>본문 문단 2</p></div></body></html>");
    expect(text).toContain("본문 문단 1\n\n본문 문단 2");
  });
});

describe("decodeBody / clampSourceText / checkSourceUrl", () => {
  it("honors charset from the header or the meta tag", () => {
    const euc = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]); // "한글" in EUC-KR
    expect(decodeBody(euc.buffer, "text/html; charset=euc-kr", false)).toBe("한글");
    const html = new TextEncoder().encode('<meta charset="utf-8"><p>가</p>');
    expect(decodeBody(html.buffer, "text/html", true)).toContain("가");
  });
  it("clamps long text at the cap and says so at the end", () => {
    const out = clampSourceText("가".repeat(SOURCE_MAX_CHARS + 5000));
    expect(out.length).toBeLessThanOrEqual(SOURCE_MAX_CHARS);
    expect(out).toMatch(/\[이하 생략 — 원문 65,000자 중 60,000자까지만 가져왔습니다\]$/);
    expect(clampSourceText("짧다")).toBe("짧다");
  });
  it("accepts public https only", () => {
    expect(checkSourceUrl("https://docs.example.com/a?b=1").ok).toBe(true);
    expect(checkSourceUrl("http://example.com")).toMatchObject({ ok: false });
    expect(checkSourceUrl("https://10.0.0.5/x")).toMatchObject({ ok: false, error: expect.stringContaining("사내망") });
    expect(checkSourceUrl("https://wiki/x")).toMatchObject({ ok: false });
    expect(checkSourceUrl("")).toMatchObject({ ok: false, error: "웹 주소를 입력하세요." });
  });
});

describe("fetchUrlSource", () => {
  const html = (body: string) => new Response(`<html><head><title>T</title></head><body><main>${body}</main></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  it("follows a redirect to a public host and extracts text", async () => {
    const calls: string[] = [];
    const f: typeof fetch = async (input) => {
      const u = String(input); calls.push(u);
      if (u === "https://a.example.com/x") return new Response(null, { status: 302, headers: { location: "/y" } });
      return html(`<p>${"내용 ".repeat(40)}</p>`);
    };
    const r = await fetchUrlSource("https://a.example.com/x", f);
    expect(calls).toEqual(["https://a.example.com/x", "https://a.example.com/y"]);
    expect(r.title).toBe("T"); expect(r.text.startsWith("내용 내용")).toBe(true); expect(r.finalUrl).toBe("https://a.example.com/y");
  });
  it("refuses a redirect into a private host, non-OK status, unsupported type and near-empty pages", async () => {
    const to = (status: number, location: string): typeof fetch => async () => new Response(null, { status, headers: { location } });
    await expect(fetchUrlSource("https://a.example.com/x", to(302, "https://10.0.0.8/admin"))).rejects.toThrow(/리다이렉트된 주소/);
    await expect(fetchUrlSource("https://a.example.com/x", async () => new Response("nope", { status: 403 }))).rejects.toMatchObject({ status: 502, message: expect.stringContaining("403") } satisfies Partial<UrlSourceError>);
    await expect(fetchUrlSource("https://a.example.com/x", async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }))).rejects.toMatchObject({ status: 415 });
    await expect(fetchUrlSource("https://a.example.com/x", async () => html("<p>짧음</p>"))).rejects.toThrow(/글을 거의 찾지 못했습니다/);
  });
  it("treats text/plain as the source as-is", async () => {
    const r = await fetchUrlSource("https://a.example.com/readme.txt", async () => new Response("# README\n\n" + "설명 ".repeat(30), { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }));
    expect(r.text.startsWith("# README")).toBe(true);
  });
});
