import { ConfluenceFetchError, type ConfluenceConfig } from "./confluence";
import type { ConfluenceSearchHit } from "@/types/rfp";

/**
 * 어드민 "Confluence에서 찾기"(4단계 스펙 §4.6 + 5단계 전체 검색).
 * 기본은 제목 검색(회의록 잡음이 적다). scope "text"는 본문까지 찾아 솔루션 문서를 폭넓게 모을 때 쓴다 — 결과를 사람이 골라 등록한다.
 */
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 50;

export type SearchScope = "title" | "text";

export function buildSearchCql(q: string, scope: SearchScope = "title"): string {
  const clean = q.replace(/["\\]/g, "").replace(/\s+/g, " ").trim();
  const where = scope === "text" ? `(title ~ "${clean}" OR text ~ "${clean}")` : `title ~ "${clean}"`;
  return `type=page AND ${where} ORDER BY lastmodified DESC`;
}

/** 예전 이름(제목 검색) — 호출부·테스트 호환 */
export function buildTitleCql(q: string): string {
  return buildSearchCql(q, "title");
}

/** 아직 소스로 등록되지 않은 검색 결과만. 순수 함수(화면·일괄 등록 공용) */
export function unregisteredHits<T extends { pageId: string }>(hits: readonly T[], registeredPageIds: ReadonlySet<string>): T[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (!h.pageId || registeredPageIds.has(h.pageId) || seen.has(h.pageId)) return false;
    seen.add(h.pageId);
    return true;
  });
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
export async function searchConfluencePages(
  cfg: ConfluenceConfig, q: string, limit: number = SEARCH_LIMIT_DEFAULT, fetchImpl: typeof fetch = fetch, scope: SearchScope = "title",
): Promise<ConfluenceSearchHit[]> {
  const n = Math.min(Math.max(1, Math.floor(limit)), SEARCH_LIMIT_MAX);
  const res = await fetchImpl(`${cfg.site}/wiki/rest/api/content/search?cql=${encodeURIComponent(buildSearchCql(q, scope))}&expand=space,version&limit=${n}`, {
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
