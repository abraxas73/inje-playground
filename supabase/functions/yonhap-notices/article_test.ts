import { enrichSummaries, extractArticleLines, fetchArticleLines, mergeSummary, needsArticleText } from "./article.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

/** 소제목이 여러 번 바뀌는 인사 기사(연세대학교 의료원 형태) */
const ARTICLE = `<html><body><div class="story-news article">
  <p>◇ 의과대학</p>
  <p>▲ 피부생물학연구소장 박창욱</p>
  <p>◇ 보건대학원</p>
  <p>▲ 산업환경보건학과 주임교수 김치년 (서울=연합뉴스)</p>
  <p>제보는 카카오톡 okjebo &lt;저작권자(c) 연합뉴스, 무단 전재-재배포, AI 학습 및 활용 금지&gt; 2026/09/16 22:09 송고</p>
  <p>다양한 채널에서 연합뉴스를 만나보세요!</p>
</div></body></html>`;
const BODY = "◇ 의과대학\n▲ 피부생물학연구소장 박창욱\n◇ 보건대학원\n▲ 산업환경보건학과 주임교수 김치년 (서울=연합뉴스)";

Deno.test("발신지 표기까지 온 요약만 완결로 본다", () => {
  assert(needsArticleText("◇ 과장급 전보"), "소제목만 있으면 본문을 읽는다");
  assert(needsArticleText("   "));
  assert(needsArticleText("◇ 의과대학 ▲ 피부생물학연구소장 박창욱"), "항목이 있어도 기사 끝이 아니면 읽는다");
  assert(needsArticleText("▲ 논설실장 신범수 ▲ AX전략부장 임희진 (서울=연합뉴스)..."), "RSS 말줄임은 잘린 것이다");
  assert(!needsArticleText("▲ 부원장 신현웅 ▲ 보건의료정책연구실장 채수미 (서울=연합뉴스)"));
  assert(!needsArticleText("▲ 김영실씨 별세 = 16일, 발인 18일. ☎ 02-2227-7500 (광주=연합뉴스)"));
});

Deno.test("본문 문단을 순서대로 뽑고 상용구부터는 버린다", () => {
  const lines = extractArticleLines(ARTICLE);
  assert(lines.length === 4, JSON.stringify(lines));
  assert(lines.join("\n") === BODY, JSON.stringify(lines));
  assert(extractArticleLines("<html><body><p>제보는 카카오톡</p></body></html>").length === 0);
  const obituary = `<div class="story-news article"><p>▲ 나종희씨 별세 (서울=연합뉴스)</p>
    <p>※ 부고 요청은 카톡 okjebo, 전화 02-398-3000, 이메일 jebo@yna.co.kr, 팩스 02-398-3111(확인용 유족 연락처 필수)</p></div>`;
  assert(extractArticleLines(obituary).length === 1, "부고 접수 안내도 본문이 아니다");
});

Deno.test("원문을 읽었으면 본문 전체로 갈음한다", () => {
  const lines = extractArticleLines(ARTICLE);
  assert(mergeSummary("◇ 의과대학", lines) === BODY, mergeSummary("◇ 의과대학", lines));
  assert(mergeSummary("◇ 의과대학 ▲ 피부생물학연구소장 박창욱...", lines) === BODY, "RSS 말줄임·줄바꿈 차이가 있어도 본문으로 갈음한다");
  // 항목만 이어 붙이면 김치년이 앞 소제목(의과대학)에 딸린 것처럼 읽힌다 — 소제목째 다시 담는다.
  const scrambled = mergeSummary("◇ 의과대학 ▲ 피부생물학연구소장 박창욱 ▲ 산업환경보건학과 주임교수 김치년", lines);
  assert(scrambled === BODY, scrambled);
  assert(mergeSummary("◇ 의과대학", []) === "◇ 의과대학", "본문을 못 읽으면 그대로 둔다");
});

Deno.test("발신지 표기만 있는 문단은 앞 줄에 붙인다", () => {
  const merged = mergeSummary("◇ 승진", ["◇ 승진", "▲ 경마본부장 배영필", "(서울=연합뉴스)"]);
  assert(merged === "◇ 승진\n▲ 경마본부장 배영필 (서울=연합뉴스)", merged);
});

Deno.test("본문 영역을 못 찾으면 다른 문단을 긁지 않는다", () => {
  const changed = '<html><body><div class="news-view"><p>◇ 인사</p><p>▲ 홍길동</p></div><p>많이 본 기사</p></body></html>';
  assert(extractArticleLines(changed).length === 0, "지면 구조가 바뀌면 빈 목록");
  assert(mergeSummary("◇ 인사", extractArticleLines(changed)) === "◇ 인사", "기존 요약을 덮어쓰지 않는다");
});

Deno.test("발신지 표기가 없는 기사도 본문 그대로 담는다", () => {
  // 국세청·방송미디어통신위 인사처럼 발신지 표기 없이 끝나는 기사가 있다.
  const merged = mergeSummary("◇ 고위공무원 승진 ▲ 윤순상 ▲ 오주희", ["◇ 고위공무원 승진", "▲ 윤순상", "◇ 과장급 전보", "▲ 오주희"]);
  assert(merged === "◇ 고위공무원 승진\n▲ 윤순상\n◇ 과장급 전보\n▲ 오주희", merged);
});

Deno.test("상한을 넘으면 항목 경계에서 자르고 말줄임을 남긴다", () => {
  const long = mergeSummary("", ["▲ 가나다라마바사".repeat(30)], 60);
  assert(long.length <= 60, `${long.length}`);
  assert(long.endsWith("…"), long);
  const boundary = mergeSummary("", [`◇ 전보 ${"▲ 홍길동 ".repeat(20)}`.trim()], 80);
  assert(boundary.length <= 80 && boundary.endsWith("…"), boundary);
});

Deno.test("원문 URL은 고정 호스트와 AKR ID로만 만든다", async () => {
  let requested = "";
  const fetcher = (async (url: string | URL | Request) => { requested = String(url); return new Response(ARTICLE, { status: 200 }); }) as typeof fetch;
  const lines = await fetchArticleLines("AKR20260916187800530", fetcher);
  assert(requested === "https://www.yna.co.kr/view/AKR20260916187800530", requested);
  assert(lines.length === 4);
  let rejected = false;
  try { await fetchArticleLines("../evil"); } catch { rejected = true; }
  assert(rejected, "AKR 형식이 아니면 요청하지 않는다");
});

Deno.test("보강이 필요한 기사만, 상한까지만 읽는다", async () => {
  const notices = [
    { source_id: "AKR1", summary: "◇ 과장급 전보" },
    { source_id: "AKR2", summary: "▲ 이미 끝까지 온 요약 (서울=연합뉴스)" },
    { source_id: "AKR3", summary: "▲ 잘린 요약..." },
  ];
  const read: string[] = [];
  const result = await enrichSummaries(notices, {
    fetchLines: (id) => { read.push(id); return Promise.resolve([`◇ 머리글 ${id}`, `▲ 보강 ${id} (서울=연합뉴스)`]); },
    concurrency: 1,
  });
  assert(read.length === 2 && !read.includes("AKR2"), JSON.stringify(read));
  assert(result.enriched === 2 && result.failed === 0);
  assert(notices[0].summary === "◇ 머리글 AKR1\n▲ 보강 AKR1 (서울=연합뉴스)", notices[0].summary);
  assert(notices[1].summary === "▲ 이미 끝까지 온 요약 (서울=연합뉴스)", "손대지 않는다");

  const capped = Array.from({ length: 80 }, (_, i) => ({ source_id: `AKR${i}`, summary: "◇ 전보" }));
  const hits: string[] = [];
  await enrichSummaries(capped, { fetchLines: (id) => { hits.push(id); return Promise.resolve(["▲ 내용"]); }, limit: 60 });
  assert(hits.length === 60, `${hits.length}`);
});

Deno.test("원문을 못 읽어도 RSS 요약을 그대로 두고 실패만 센다", async () => {
  const notices = [{ source_id: "AKR1", summary: "◇ 과장급 전보" }];
  const result = await enrichSummaries(notices, { fetchLines: () => Promise.reject(new Error("원문 HTTP 503")) });
  assert(result.enriched === 0 && result.failed === 1);
  assert(notices[0].summary === "◇ 과장급 전보");
});

Deno.test("시간 예산을 넘기면 남은 기사는 다음 수집으로 넘긴다", async () => {
  const notices = Array.from({ length: 5 }, (_, i) => ({ source_id: `AKR${i}`, summary: "◇ 전보" }));
  const hits: string[] = [];
  await enrichSummaries(notices, {
    concurrency: 1,
    budgetMs: 30,
    fetchLines: async (id) => { hits.push(id); await new Promise((r) => setTimeout(r, 20)); return ["▲ 내용 (서울=연합뉴스)"]; },
  });
  assert(hits.length < 5, `${hits.length}`);
});

Deno.test("발신지 표기 뒤에 안내 한 줄이 더 있어도 완결로 본다", () => {
  assert(!needsArticleText("▲ 김귀조씨 별세 ☎ 02-2227-7500 (서울=연합뉴스)\n※ 조의금은 정중히 사양합니다."));
});
