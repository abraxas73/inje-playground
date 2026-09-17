import { enrichSummaries, extractArticleLines, fetchArticleLines, mergeSummary, needsArticleText } from "./article.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

const ARTICLE = `<html><body><div class="story-news article">
  <p>◇ 과장급 전보</p>
  <p>▲ 요양보험운영과장 박지혜 (서울=연합뉴스)</p>
  <p>제보는 카카오톡 okjebo &lt;저작권자(c) 연합뉴스, 무단 전재-재배포, AI 학습 및 활용 금지&gt; 2026/09/16 22:09 송고</p>
</div></body></html>`;

Deno.test("머리글만 있는 요약만 본문을 읽는다", () => {
  assert(needsArticleText("◇ 과장급 전보"));
  assert(needsArticleText("   "));
  assert(!needsArticleText("▲ 부원장 신현웅 ▲ 보건의료정책연구실장 채수미 (서울=연합뉴스)"));
  assert(!needsArticleText("▲ 김종원씨 별세"));
  assert(!needsArticleText("가".repeat(60)), "충분히 길면 그대로 둔다");
});

Deno.test("본문 문단을 뽑고 저작권·제보 상용구는 버린다", () => {
  const lines = extractArticleLines(ARTICLE);
  assert(lines.length === 2, JSON.stringify(lines));
  assert(lines[0] === "◇ 과장급 전보" && lines[1] === "▲ 요양보험운영과장 박지혜 (서울=연합뉴스)", JSON.stringify(lines));
  assert(extractArticleLines("<html><body><p>제보는 카카오톡</p></body></html>").length === 0);
});

Deno.test("요약에 없는 줄만, 최대 2줄·80자 남짓 덧붙인다", () => {
  assert(mergeSummary("◇ 과장급 전보", extractArticleLines(ARTICLE)) === "◇ 과장급 전보 ▲ 요양보험운영과장 박지혜 (서울=연합뉴스)");
  assert(mergeSummary("◇ 인사", ["◇ 인사"]) === "◇ 인사", "중복은 붙이지 않는다");
  assert(mergeSummary("◇ 과장급 전보", ["◇ 다른 머리글", "▲ 박지혜"]) === "◇ 과장급 전보 ▲ 박지혜", "항목이 있으면 머리글은 건너뛴다");
  const many = ["▲ 가".repeat(1), "▲ 나", "▲ 다", "▲ 라"];
  assert(mergeSummary("◇ 전보", many).split("▲").length - 1 === 2, "두 줄까지만");
  assert(mergeSummary("◇ 전보", ["가".repeat(300)], 50).length === 50, "상한을 넘기지 않는다");
});

Deno.test("원문 URL은 고정 호스트와 AKR ID로만 만든다", async () => {
  let requested = "";
  const fetcher = (async (url: string | URL | Request) => { requested = String(url); return new Response(ARTICLE, { status: 200 }); }) as typeof fetch;
  const lines = await fetchArticleLines("AKR20260916187800530", fetcher);
  assert(requested === "https://www.yna.co.kr/view/AKR20260916187800530", requested);
  assert(lines.length === 2);
  let rejected = false;
  try { await fetchArticleLines("../evil"); } catch { rejected = true; }
  assert(rejected, "AKR 형식이 아니면 요청하지 않는다");
});

Deno.test("보강이 필요한 기사만, 상한까지만 읽는다", async () => {
  const notices = [
    { source_id: "AKR1", summary: "◇ 과장급 전보" },
    { source_id: "AKR2", summary: "▲ 이미 충분한 내용 (서울=연합뉴스)" },
    { source_id: "AKR3", summary: "◇ 승진" },
  ];
  const read: string[] = [];
  const result = await enrichSummaries(notices, {
    fetchLines: (id) => { read.push(id); return Promise.resolve(["◇ 머리글", `▲ 보강 ${id}`]); },
    concurrency: 1,
  });
  assert(read.length === 2 && !read.includes("AKR2"), JSON.stringify(read));
  assert(result.enriched === 2 && result.failed === 0);
  assert(notices[0].summary === "◇ 과장급 전보 ▲ 보강 AKR1", notices[0].summary);
  assert(notices[1].summary === "▲ 이미 충분한 내용 (서울=연합뉴스)", "손대지 않는다");

  const capped = Array.from({ length: 20 }, (_, i) => ({ source_id: `AKR${i}`, summary: "◇ 전보" }));
  const hits: string[] = [];
  await enrichSummaries(capped, { fetchLines: (id) => { hits.push(id); return Promise.resolve(["▲ 내용"]); }, limit: 12 });
  assert(hits.length === 12, `${hits.length}`);
});

Deno.test("원문을 못 읽어도 RSS 요약을 그대로 두고 실패만 센다", async () => {
  const notices = [{ source_id: "AKR1", summary: "◇ 과장급 전보" }];
  const result = await enrichSummaries(notices, { fetchLines: () => Promise.reject(new Error("원문 HTTP 503")) });
  assert(result.enriched === 0 && result.failed === 1);
  assert(notices[0].summary === "◇ 과장급 전보");
});
