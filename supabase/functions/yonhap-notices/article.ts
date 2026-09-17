import { plainText } from "./feed.ts";

/**
 * 인사 기사 본문 한 줄 보강.
 * 연합뉴스 RSS의 description은 기사 첫 문단만 담아서, 인사 기사 상당수가 "◇ 과장급 전보" 같은 **분류 머리글만** 남는다.
 * 실제 발령 내용(`▲ 요양보험운영과장 박지혜`)은 다음 문단에 있어 화면·메일에서 알맹이가 빠진다.
 * 그래서 요약이 실질 내용을 담고 있지 않을 때만 원문 첫 문단 몇 줄을 읽어 붙인다. 전문을 저장하지 않는다.
 */
const ARTICLE_HOST = "https://www.yna.co.kr/view/";
const MAX_ARTICLE_BYTES = 1024 * 1024;
/** 저작권·제보 안내 등 기사 끝 상용구 */
const BOILERPLATE = /제보는|저작권자|무단\s*전재|AI\s*학습|송고$|^\(끝\)$/;
/** 실제 항목 한 줄(▲ …) 또는 그만큼 긴 문장 */
const ENTRY = /[▲△]/;

/** 요약에 실질 내용이 없어 본문을 봐야 하는가 — 항목 표시가 없고 머리글 수준으로 짧을 때 */
export function needsArticleText(summary: string): boolean {
  const text = summary.trim();
  if (!text) return true;
  return !ENTRY.test(text) && text.length < 60;
}

/** 기사 HTML → 본문 문단 목록(상용구 제외) */
export function extractArticleLines(html: string): string[] {
  const start = html.indexOf('class="story-news article"');
  const body = start === -1 ? html : html.slice(start);
  const lines: string[] = [];
  for (const [, raw] of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = plainText(raw);
    if (!text || BOILERPLATE.test(text)) continue;
    lines.push(text);
    if (lines.length >= 8) break;
  }
  return lines;
}

/** 원문의 항목 줄 중 요약에 없는 것을 최대 2줄, 80자 남짓까지 덧붙인다. 최종 길이는 RSS 요약과 같은 600자 상한. */
export function mergeSummary(summary: string, lines: string[], maxLength = 600): string {
  const base = summary.trim();
  // 실질 내용은 항목 줄(▲ 요양보험운영과장 박지혜)이다. 항목이 있으면 머리글·부연은 건너뛴다.
  const entries = lines.filter((line) => ENTRY.test(line));
  let added = 0;
  let out = base;
  for (const line of entries.length ? entries : lines) {
    if (added >= 2 || out.length - base.length >= 80) break;
    if (!line || base.includes(line) || out.includes(line)) continue;
    out = out ? `${out} ${line}` : line;
    added += 1;
  }
  return out.slice(0, maxLength).trim();
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
 * 보강이 필요한 기사만 원문을 읽어 요약을 채운다(동시 4건, 1회 최대 12건).
 * 실패는 무시하고 RSS 요약을 그대로 둔다 — 수집 자체를 실패시키지 않는다.
 */
export async function enrichSummaries<T extends EnrichTarget>(
  notices: T[],
  options: { fetchLines?: typeof fetchArticleLines; limit?: number; concurrency?: number } = {},
): Promise<{ enriched: number; failed: number }> {
  const fetchLines = options.fetchLines ?? fetchArticleLines;
  const targets = notices.filter((n) => needsArticleText(n.summary)).slice(0, options.limit ?? 12);
  if (!targets.length) return { enriched: 0, failed: 0 };
  let enriched = 0, failed = 0;
  const queue = [...targets];
  const worker = async () => {
    while (queue.length) {
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
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, targets.length) }, worker));
  return { enriched, failed };
}
