/**
 * Confluence 개인 연동 — 네트워크. 토큰은 Jira 연결(jira_connections)의 Atlassian OAuth 토큰을 그대로 쓴다(accessTokenFor가 갱신).
 * 사용자 본인 권한으로만 조회·작성한다(공용 ATLASSIAN_* 계정은 쓰지 않는다 — 남의 비공개 공간이 보이면 안 된다).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { JiraError } from "@/lib/jira/config";
import { accessTokenFor, loadConnection } from "@/lib/jira/client";
import { storageToText } from "@/lib/rfp/catalog/storage-text";
import { canWriteConfluence, confluenceBase, confluenceEnabled, feedCql, hasConfluenceScopes, mapSearchResult, markdownToStorage, searchCql, siteUrl, type ConfluenceItem, type FeedKind } from "./core";

export const CONFLUENCE_BASE_RE = /^https:\/\/api\.atlassian\.com\/ex\/confluence\/[0-9a-f-]{36}$/;
export type ConfluenceFetch = (path: string, init?: RequestInit) => Promise<unknown>;

export async function confluenceRequest(base: string, token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  if (!CONFLUENCE_BASE_RE.test(base) || !path.startsWith("/wiki/rest/api/")) throw new JiraError("Confluence 연결 주소가 올바르지 않습니다.", 500);
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" } });
  } catch {
    throw new JiraError(init.method && init.method !== "GET" ? "Confluence 응답을 확인하지 못했습니다. Confluence에서 반영 여부를 확인한 뒤 다시 시도하세요." : "Confluence에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
  if (!res.ok) {
    if (res.status === 401) throw new JiraError("Atlassian 인증이 만료되었습니다. 설정에서 다시 연결하세요.", 409, "reconnect");
    if (res.status === 403) throw new JiraError("이 Confluence 문서·공간에 접근하거나 쓸 권한이 없습니다.", 403, "forbidden");
    if (res.status === 404) throw new JiraError("Confluence 문서를 찾을 수 없거나 볼 권한이 없습니다.", 404);
    if (res.status === 429) throw new JiraError("Confluence 요청이 많습니다. 잠시 후 다시 시도하세요.", 429);
    if (res.status === 400) throw new JiraError("Confluence가 요청을 처리하지 못했습니다(같은 공간에 같은 제목의 페이지가 있거나 입력이 올바르지 않음).", 400);
    throw new JiraError(`Confluence 요청에 실패했습니다(HTTP ${res.status}). 잠시 후 다시 시도하세요.`);
  }
  return res.status === 204 ? null : res.json();
}

export interface ConfluenceSession { request: ConfluenceFetch; canWrite: boolean; accountId: string }

/** 로그인 사용자의 Confluence 세션. 미연결·기능 꺼짐·권한 부족은 각각 다른 안내(code)로 */
export async function confluenceFor(admin: SupabaseClient, userId: string): Promise<ConfluenceSession> {
  if (!confluenceEnabled()) throw new JiraError("Confluence 연동을 준비 중입니다. 관리자에게 문의하세요.", 503, "not_configured");
  const conn = await loadConnection(admin, userId);
  if (!conn || conn.auth_type !== "oauth") throw new JiraError("설정에서 Atlassian(Jira·Confluence) 계정을 연결하세요.", 400, "not_connected");
  if (!hasConfluenceScopes(conn.scopes)) throw new JiraError("Confluence 권한을 추가하려면 설정에서 Atlassian 계정을 다시 연결하세요.", 409, "confluence_scope");
  const token = await accessTokenFor(conn, admin, userId);
  const base = confluenceBase(conn.api_base);
  return { request: (path, init) => confluenceRequest(base, token, path, init), canWrite: canWriteConfluence(conn.scopes), accountId: conn.account_id };
}

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
const results = (j: unknown): unknown[] => (j && typeof j === "object" && Array.isArray((j as { results?: unknown }).results) ? (j as { results: unknown[] }).results : []);
const clampLimit = (n: number | undefined, d: number) => Math.min(25, Math.max(1, Math.floor(n ?? d)));

export async function cqlSearch(request: ConfluenceFetch, cql: string, limit: number): Promise<ConfluenceItem[]> {
  const j = await request(`/wiki/rest/api/search?${qs({ cql, limit: String(limit), expand: "content.space,content.version" })}`);
  return results(j).map(mapSearchResult).filter((x): x is ConfluenceItem => !!x);
}
export const searchPages = (request: ConfluenceFetch, q: string, o: { spaceKey?: string; limit?: number } = {}) =>
  cqlSearch(request, searchCql(q, o.spaceKey), clampLimit(o.limit, 10));
export const feed = (request: ConfluenceFetch, kind: FeedKind, limit?: number) => cqlSearch(request, feedCql(kind), clampLimit(limit, 10));

export interface ConfluencePageText { id: string; title: string; spaceKey: string; spaceName: string; url: string; version: number; lastModified: string; by: string; text: string; truncated: boolean }
/** 페이지 본문을 텍스트로(LLM·원고용). maxChars를 넘으면 자르고 truncated */
export async function readPage(request: ConfluenceFetch, id: string, maxChars = 20_000): Promise<ConfluencePageText> {
  if (!/^\d{1,20}$/.test(id)) throw new JiraError("Confluence 페이지 번호가 올바르지 않습니다.", 400);
  const j = (await request(`/wiki/rest/api/content/${id}?${qs({ expand: "body.storage,space,version" })}`)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const full = storageToText(String(j?.body?.storage?.value ?? ""));
  return {
    id: String(j?.id ?? id), title: String(j?.title ?? ""), spaceKey: String(j?.space?.key ?? ""), spaceName: String(j?.space?.name ?? ""),
    url: siteUrl(String(j?._links?.webui ?? "")), version: Number(j?.version?.number ?? 0), lastModified: String(j?.version?.when ?? ""), by: String(j?.version?.by?.displayName ?? ""),
    text: full.slice(0, maxChars), truncated: full.length > maxChars,
  };
}

export interface ConfluenceSpace { key: string; name: string; type: string }
/**
 * 페이지를 만들 수 있는 공간 — 검색 API(type=space, search:confluence)로, 다음 쪽(_links.next)을 따라 최대 4쪽.
 * 개인 OAuth에서는 /wiki/rest/api/space가 실패했다(2026-10-10 실측, 공용 계정 Basic은 정상).
 * 개인 공간은 내 것만 — 남의 개인 공간 수백 개가 목록을 덮지 않게.
 */
export async function listSpaces(request: ConfluenceFetch, accountId = ""): Promise<ConfluenceSpace[]> {
  const out: ConfluenceSpace[] = [];
  const seen = new Set<string>();
  let path: string | null = `/wiki/rest/api/search?${qs({ cql: "type = space order by title", limit: "250" })}`;
  for (let page = 0; path && page < 4; page++) {
    const j = (await request(path)) as { _links?: { next?: unknown } } | null;
    for (const r of results(j)) {
      const o = ((r as Record<string, unknown>)?.space ?? {}) as Record<string, unknown>;
      if (typeof o.key !== "string" || typeof o.name !== "string" || seen.has(o.key)) continue;
      const type = String(o.type ?? "");
      // 개인 공간 key = "~" + accountId에서 ":"·"-"를 뺀 값(2026-10-10 실측)
      if (type === "personal" && !(accountId && o.key === `~${accountId.replace(/[:-]/g, "")}`)) continue;
      seen.add(o.key);
      out.push({ key: o.key, name: o.name, type });
    }
    const next = j?._links?.next;
    path = typeof next === "string" && next.startsWith("/rest/api/search?") ? `/wiki${next}` : null;
  }
  return out;
}

export interface NewPage { spaceKey: string; parentId?: string | null; title: string; markdown: string }
export async function createPage(request: ConfluenceFetch, p: NewPage): Promise<{ id: string; title: string; url: string }> {
  const title = p.title.trim();
  if (!title || title.length > 255) throw new JiraError("페이지 제목은 1~255자여야 합니다.", 400);
  if (!/^[~A-Za-z0-9_-]{1,255}$/.test(p.spaceKey)) throw new JiraError("Confluence 공간을 다시 고르세요.", 400);
  if (p.parentId && !/^\d{1,20}$/.test(p.parentId)) throw new JiraError("상위 페이지 번호가 올바르지 않습니다.", 400);
  const body = { type: "page", title, space: { key: p.spaceKey }, ...(p.parentId ? { ancestors: [{ id: p.parentId }] } : {}), body: { storage: { value: markdownToStorage(p.markdown), representation: "storage" } } };
  const j = (await request("/wiki/rest/api/content", { method: "POST", body: JSON.stringify(body) })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { id: String(j?.id ?? ""), title: String(j?.title ?? title), url: siteUrl(String(j?._links?.webui ?? "")) };
}
