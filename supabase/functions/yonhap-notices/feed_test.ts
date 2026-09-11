import { fetchNotices, parseFeed } from "./feed.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const item = (title: string, id = "AKR20260911000100001", extras = "") => `<item>
  <title><![CDATA[${title}]]></title><link>https://www.yna.co.kr/view/${id}?section=people</link>
  <pubDate>Fri, 11 Sep 2026 07:00:00 +0900</pubDate>
  <description><![CDATA[<p>홍길동 &amp; 김철수</p><script>alert(1)</script> (끝)]]></description>${extras}</item>`;
const rss = (items: string) => `<rss version="2.0"><channel><title>연합뉴스 사람들 최신기사</title>${items}</channel></rss>`;

Deno.test("classifies notices, strips markup, converts KST, canonicalizes URLs, deduplicates revisions", () => {
  const result = parseFeed(rss(item("[인사] 기관") + item("[인사] 기관(수정)") + item("[부고] 홍길동씨 별세", "AKR20260911000200001") + item("일반 사람들 기사", "AKR20260911000300001")));
  assert(result.length === 2);
  assert(result[0].title === "[인사] 기관(수정)");
  assert(result[0].category === "personnel" && result[1].category === "obituary");
  assert(result[0].source_url === "https://www.yna.co.kr/view/AKR20260911000100001");
  assert(result[0].published_at === "2026-09-10T22:00:00.000Z");
  assert(result[0].summary === "홍길동 & 김철수");
});

Deno.test("empty or unrelated valid feed is allowed", () => {
  assert(parseFeed(rss("")).length === 0);
  assert(parseFeed(rss(item("인사 관련 일반 기사"))).length === 0);
});

for (const [name, xml] of [
  ["HTML response", "<html><body>temporary error</body></html>"],
  ["broken XML", "<rss><channel>"],
  ["custom entities", '<!DOCTYPE rss [<!ENTITY x "payload">]>' + rss("")],
  ["offsite article", rss(item("[인사] 기관")).replace("www.yna.co.kr/view", "example.com/view")],
  ["host suffix attack", rss(item("[인사] 기관")).replace("www.yna.co.kr/view", "www.yna.co.kr.evil.test/view")],
  ["invalid date", rss(item("[인사] 기관")).replace("Fri, 11 Sep 2026 07:00:00 +0900", "invalid")],
]) {
  Deno.test(`rejects ${name} instead of recording false success`, () => {
    let threw = false;
    try { parseFeed(xml); } catch { threw = true; }
    assert(threw);
  });
}

Deno.test("HTTP failures are visible to the collector", async () => {
  let threw = false;
  try { await fetchNotices((() => Promise.resolve(new Response("unavailable", { status: 503 }))) as typeof fetch); }
  catch (e) { threw = e instanceof Error && e.message.includes("503"); }
  assert(threw);
});
