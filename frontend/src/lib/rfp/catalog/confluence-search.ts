import { ConfluenceFetchError, type ConfluenceConfig } from "./confluence";
import type { ConfluenceSearchHit } from "@/types/rfp";

/** 어드민 "Confluence에서 찾기"(4단계 스펙 §4.6). 제목만 검색한다(본문 검색은 회의록 잡음이 커서 제외). */
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 25;

export function buildTitleCql(q: string): string {
  const clean = q.replace(/["\\]/g, "").replace(/\s+/g, " ").trim();
  return `type=page AND title ~ "${clean}" ORDER BY lastmodified DESC`;
}

interface SearchResponse {
  results?: {
    id?: string | number;
    title?: string;
    space?: { key?: string; name?: string };
    version?: { when?: string };
    _links?: { webui?: string };
  }[];
}

/** GET {site}/wiki/rest/api/content/search?cql=…&expand=space,version&limit=… — Basic 인증은 2단계 confluenceConfig. 실패 본문은 로그에도 남기지 않는다. */
export async function searchConfluencePages(cfg: ConfluenceConfig, q: string, limit: number = SEARCH_LIMIT_DEFAULT, fetchImpl: typeof fetch = fetch): Promise<ConfluenceSearchHit[]> {
  const n = Math.min(Math.max(1, Math.floor(limit)), SEARCH_LIMIT_MAX);
  const res = await fetchImpl(`${cfg.site}/wiki/rest/api/content/search?cql=${encodeURIComponent(buildTitleCql(q))}&expand=space,version&limit=${n}`, {
    headers: { Authorization: cfg.auth, Accept: "application/json" },
  });
  if (!res.ok) throw new ConfluenceFetchError(res.status, `Confluence 검색 실패(${res.status})`);
  const j = (await res.json()) as SearchResponse;
  return (j.results ?? [])
    .map((r) => ({
      pageId: r.id === undefined || r.id === null ? "" : String(r.id),
      title: r.title ?? "",
      spaceKey: r.space?.key ?? null,
      spaceName: r.space?.name ?? null,
      url: `${cfg.site}/wiki${r._links?.webui ?? ""}`,
      lastModified: r.version?.when ?? null,
    }))
    .filter((h) => h.pageId);
}
