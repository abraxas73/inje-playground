import { plainText } from "./feed.ts";

/**
 * 인사·부고 기사 본문 보강.
 * 연합뉴스 RSS의 description은 기사 앞부분(대개 80자)만 담아서, 화면·메일 요약이 기사 중간에서 끊긴다.
 * 인사 기사는 소제목만 남기도 하고(`◇ 과장급 전보`), 부고는 발인·장지가 잘려 나간다.
 * 그래서 요약이 기사 끝(발신지 표기)까지 오지 않았을 때만 원문을 읽어 본문으로 갈음한다. 안내·추천 문단은 담지 않는다.
 */
const ARTICLE_HOST = "https://www.yna.co.kr/view/";
const MAX_ARTICLE_BYTES = 1024 * 1024;
/** 저작권·제보·부고 접수 안내 등 본문이 끝난 뒤의 상용구 — 이 문단부터는 기사 내용이 아니다. */
const BOILERPLATE = /제보는|저작권자|무단\s*전재|AI\s*학습|부고 요청|jebo@yna\.co\.kr|송고$|^\(끝\)$/;
/**
 * 기사 본문 끝의 발신지 표기(`(서울=연합뉴스)`) — 이게 있으면 본문을 끝까지 담은 것이다.
 * 뒤에 `※ 조의금은 정중히 사양합니다.` 같은 한 줄이 더 붙는 기사가 있어 끝에 고정하지 않는다.
 */
const DATELINE = /\([^()]{0,20}=연합뉴스\)/;
/** RSS가 잘라내면서 붙이는 말줄임 */
const TRUNCATED = /(\.\.\.|…)\s*$/;
/** 본문 문단 수와 저장 길이 상한 — 가장 긴 인사 기사(전 부서 승진 명단)가 4천 자 남짓이다. */
const MAX_LINES = 60;
const MAX_SUMMARY = 4000;

/** 요약이 기사 끝까지 담지 못해 원문을 읽어야 하는가 */
export function needsArticleText(summary: string): boolean {
  const text = summary.trim();
  if (!text) return true;
  return TRUNCATED.test(text) || !DATELINE.test(text);
}

/** 기사 HTML → 본문 문단 목록. 상용구가 나오면 본문이 끝난 것으로 보고 멈춘다. */
export function extractArticleLines(html: string): string[] {
  const start = html.indexOf('class="story-news article"');
  const body = start === -1 ? html : html.slice(start);
  const lines: string[] = [];
  for (const [, raw] of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = plainText(raw);
    if (!text) continue;
    if (BOILERPLATE.test(text)) break;
    lines.push(text);
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}

/** 상한을 넘으면 문단·항목 경계에서 자르고 말줄임을 남긴다. */
function clamp(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength - 2);
  const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" ▲"), cut.lastIndexOf(" ◇"));
  return `${(boundary > maxLength * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()} …`;
}

const flatten = (text: string) => text.replace(/\s+/g, "");

/** 발신지 표기만 있는 문단은 앞 줄에 붙인다 — 기사에서도 같은 문장의 꼬리다. */
function joinBody(lines: string[]): string {
  const out: string[] = [];
  for (const line of lines) {
    if (out.length && /^\([^()]{0,20}=연합뉴스\)$/.test(line)) out[out.length - 1] += ` ${line}`;
    else out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * 원문 본문으로 요약을 갈음한다.
 * RSS 요약은 본문 앞부분을 잘라낸 것이라, 원문을 읽었으면 본문이 곧 정답이다.
 * 빠진 항목만 골라 붙이면 `◇ 보건대학원` 같은 소제목이 어긋나 다음 사람이 앞 소제목에 딸린 것처럼 읽힌다.
 * 다만 기사 본문을 제대로 읽었는지 확인한다 — 끝에 발신지 표기가 있거나, 요약 앞부분을 그대로 품고 있어야 한다.
 * 확인에 실패하면(지면 구조 변경 등) 기존 요약을 그대로 둔다.
 */
export function mergeSummary(summary: string, lines: string[], maxLength = MAX_SUMMARY): string {
  const base = summary.trim();
  const body = joinBody(lines);
  const opening = flatten(base).replace(TRUNCATED, "").slice(0, 30);
  const isArticle = !!body && (!base || DATELINE.test(body) || flatten(body).includes(opening));
  return clamp(isArticle ? body : base, maxLength);
}

export async function fetchArticleLines(sourceId: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  if (!/^AKR\d+$/.test(sourceId)) throw new Error("원문 ID가 올바르지 않습니다.");
  const response = await fetcher(`${ARTICLE_HOST}${sourceId}`, {
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(8_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`원문 HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_ARTICLE_BYTES) throw new Error("원문 크기 초과");
  const html = await response.text();
  if (new TextEncoder().encode(html).length > MAX_ARTICLE_BYTES) throw new Error("원문 크기 초과");
  return extractArticleLines(html);
}

export interface EnrichTarget { source_id: string; summary: string }

/**
 * 보강이 필요한 기사만 원문을 읽어 요약을 채운다(동시 6건, 1회 최대 60건, 전체 45초).
 * RSS는 120건을 유지하므로 상한에 걸린 나머지는 다음 수집에서 이어 받는다.
 * 실패는 무시하고 RSS 요약을 그대로 둔다 — 수집 자체를 실패시키지 않는다.
 */
export async function enrichSummaries<T extends EnrichTarget>(
  notices: T[],
  options: { fetchLines?: typeof fetchArticleLines; limit?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<{ enriched: number; failed: number }> {
  const fetchLines = options.fetchLines ?? fetchArticleLines;
  const targets = notices.filter((n) => needsArticleText(n.summary)).slice(0, options.limit ?? 60);
  if (!targets.length) return { enriched: 0, failed: 0 };
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  let enriched = 0, failed = 0;
  const queue = [...targets];
  const worker = async () => {
    while (queue.length && Date.now() < deadline) {
      const notice = queue.shift()!;
      try {
        const merged = mergeSummary(notice.summary, await fetchLines(notice.source_id));
        if (merged !== notice.summary.trim()) {
          notice.summary = merged;
          enriched += 1;
        }
      } catch {
        // 원문을 못 읽어도 RSS 요약으로 계속 간다(다음 수집에서 다시 시도).
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 6, targets.length) }, worker));
  return { enriched, failed };
}
