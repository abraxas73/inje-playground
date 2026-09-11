import { XMLParser, XMLValidator } from "fast-xml-parser";

export const FEED_URL = "https://www.yna.co.kr/rss/people.xml";
const MAX_FEED_BYTES = 2 * 1024 * 1024;

export interface Notice {
  source_id: string;
  category: "personnel" | "obituary";
  title: string;
  summary: string;
  source_url: string;
  published_at: string;
}

/** RSS descriptions are plain text excerpts, never trusted HTML. */
function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFeed(xml: string): Notice[] {
  if (new TextEncoder().encode(xml).length > MAX_FEED_BYTES) throw new Error("RSS 응답 크기 초과");
  // Do not expand custom entities or accept a login/error HTML page as an empty feed.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error("올바르지 않은 RSS 응답");
  }
  const parsed = new XMLParser({
    parseTagValue: false,
    trimValues: true,
    isArray: (_name, path) => path === "rss.channel.item",
  }).parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel || !String(channel.title ?? "").includes("연합뉴스")) {
    throw new Error("연합뉴스 RSS 채널을 확인할 수 없습니다.");
  }
  const notices = new Map<string, Notice>();
  for (const item of channel.item ?? []) {
    const title = plainText(item.title);
    const match = title.match(/^\[\s*(인사|부고)\s*\]/);
    if (!match) continue;
    const url = new URL(String(item.link));
    const sourceId = url.pathname.match(/^\/view\/(AKR\d+)$/)?.[1];
    if (!sourceId || !["www.yna.co.kr", "yna.co.kr"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
      throw new Error("인사·부고 원문 URL이 올바르지 않습니다.");
    }
    const published = Date.parse(String(item.pubDate));
    if (!Number.isFinite(published)) throw new Error("인사·부고 송고 시각이 올바르지 않습니다.");
    notices.set(sourceId, {
      source_id: sourceId,
      category: match[1] === "인사" ? "personnel" : "obituary",
      title: title.slice(0, 500),
      summary: plainText(item.description).replace(/\s*\(끝\)\s*$/, "").trim().slice(0, 600),
      source_url: `https://www.yna.co.kr/view/${sourceId}`,
      published_at: new Date(published).toISOString(),
    });
  }
  return [...notices.values()];
}

export async function fetchNotices(fetcher: typeof fetch = fetch): Promise<Notice[]> {
  const response = await fetcher(FEED_URL, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`연합뉴스 RSS HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_FEED_BYTES) {
    throw new Error("RSS 응답 크기 초과");
  }
  return parseFeed(await response.text());
}
