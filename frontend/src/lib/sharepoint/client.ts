/**
 * SharePoint·OneDrive 개인 연동 — Graph 호출(위임 토큰). 토큰은 호출자(graphTokenForRoute)가 준다. 토큰·본문은 로그에 쓰지 않는다.
 * 인사이트(used·shared·trending)는 테넌트가 끌 수 있다(403·404) — used는 /me/drive/recent로 갈음하고 나머지는 unavailable로 알린다.
 */
import type { FetchLike } from "@/lib/notify/types";
import { GRAPH_BASE } from "@/lib/teams-graph";
import { downloadFile, encodeShareUrl, fetchWithRetry, GraphError, readGraphError, XLSX_SOURCE_MAX_BYTES } from "@/lib/ms/graph-drive";
import { textFromDocument } from "@/lib/ppt/source";
import { parseDocumentAsync } from "@/lib/rfp/parse";
import { documentText } from "@/lib/rfp/document-model";
import { dedupe, mapDriveItem, mapInsight, mapSearchResponse, READABLE_EXTENSIONS, searchBody, SharepointError, type FeedKind, type SharepointItem } from "./core";

const clamp = (n: number | undefined, d: number) => Math.min(25, Math.max(1, Math.floor(n ?? d)));
const value = (j: unknown): unknown[] => (j && typeof j === "object" && Array.isArray((j as { value?: unknown }).value) ? (j as { value: unknown[] }).value : []);

async function graph(token: string, path: string, init: RequestInit = {}, fetchImpl: FetchLike = fetch): Promise<unknown> {
  const res = await fetchWithRetry(fetchImpl, `${GRAPH_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await readGraphError(res);
  return res.json();
}

export interface FeedResult { kind: FeedKind; source: FeedKind; items: SharepointItem[]; unavailable?: boolean }
export async function feed(token: string, kind: FeedKind, limit?: number, fetchImpl: FetchLike = fetch): Promise<FeedResult> {
  const top = clamp(limit, 10);
  const recent = async (): Promise<SharepointItem[]> =>
    dedupe(value(await graph(token, `/me/drive/recent?$top=${top * 2}`, {}, fetchImpl)).map(mapDriveItem)).filter((i) => i.kind === "file").slice(0, top);
  if (kind === "recent") return { kind, source: kind, items: await recent() };
  try {
    const items = dedupe(value(await graph(token, `/me/insights/${kind}?$top=${top * 2}`, {}, fetchImpl)).map(mapInsight)).filter((i) => i.kind === "file").slice(0, top);
    return { kind, source: kind, items };
  } catch (e) {
    if (!(e instanceof GraphError && (e.status === 403 || e.status === 404))) throw e;
    // 인사이트 꺼짐 — 자주 쓰는 문서는 최근 연 문서로 갈음
    return kind === "used" ? { kind, source: "recent", items: await recent() } : { kind, source: kind, items: [], unavailable: true };
  }
}

export async function searchDocs(token: string, q: string, limit?: number, fetchImpl: FetchLike = fetch): Promise<SharepointItem[]> {
  const body = searchBody(q, clamp(limit, 10));
  if (!body.requests[0].query.queryString) throw new SharepointError("검색어는 1~200자로 입력하세요.", 400);
  return mapSearchResponse(await graph(token, "/search/query", { method: "POST", body: JSON.stringify(body) }, fetchImpl));
}

export type ItemRef = { url: string } | { driveId: string; id: string };
const ID_RE = /^[A-Za-z0-9!_.-]{1,200}$/;
/** 링크(shares) 또는 driveId/id → 항목(@microsoft.graph.downloadUrl 포함). 400·404 해석 불가, 403 권한 */
export async function resolveRef(token: string, ref: ItemRef, fetchImpl: FetchLike = fetch): Promise<SharepointItem & { downloadUrl: string; size: number }> {
  let path: string;
  if ("url" in ref) {
    if (!/^https:\/\//i.test(ref.url) || ref.url.length > 2000) throw new SharepointError("https로 시작하는 문서 링크를 붙여 주세요.", 400);
    path = `/shares/${encodeShareUrl(ref.url.trim())}/driveItem`;
  } else {
    if (!ID_RE.test(ref.driveId) || !ID_RE.test(ref.id)) throw new SharepointError("문서 번호가 올바르지 않습니다.", 400);
    path = `/drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.id)}`;
  }
  let j: Record<string, unknown>;
  try { j = (await graph(token, path, {}, fetchImpl)) as Record<string, unknown>; }
  catch (e) {
    if (e instanceof GraphError && e.status === 403) throw new SharepointError("이 문서를 볼 권한이 없습니다.", 403, "forbidden");
    if (e instanceof GraphError && (e.status === 400 || e.status === 404)) throw new SharepointError("링크를 해석할 수 없습니다. 문서의 '링크 복사'를 사용하세요.", 400);
    throw e;
  }
  const item = mapDriveItem(j);
  if (!item) throw new SharepointError("링크를 해석할 수 없습니다. 문서의 '링크 복사'를 사용하세요.", 400);
  return { ...item, downloadUrl: String(j["@microsoft.graph.downloadUrl"] ?? ""), size: Number(j.size ?? 0) };
}

export interface DocText { item: SharepointItem; text: string; truncated: boolean }
export interface ReadDeps { fetchImpl?: FetchLike; /** pptx → 장표 텍스트(ppt-service /extract) */ extractPptx?: (downloadUrl: string) => Promise<string> }
/** 문서 본문을 텍스트로(LLM·원고용). READABLE_EXTENSIONS만, 20MiB 이하. maxChars를 넘으면 자르고 truncated */
export async function readDoc(token: string, ref: ItemRef, maxChars = 20_000, deps: ReadDeps = {}): Promise<DocText> {
  const item = await resolveRef(token, ref, deps.fetchImpl);
  if (item.kind !== "file") throw new SharepointError("폴더는 읽을 수 없습니다. 문서 파일을 지정하세요.", 400);
  if (!(READABLE_EXTENSIONS as readonly string[]).includes(item.ext)) throw new SharepointError(`${item.ext || "확장자 없는"} 파일은 본문을 읽을 수 없습니다(${READABLE_EXTENSIONS.join("·")}).`, 415);
  if (item.size > XLSX_SOURCE_MAX_BYTES) throw new SharepointError("파일이 너무 큽니다(20MB 이하).", 413);
  let full: string;
  if (item.ext === "pptx") {
    if (!deps.extractPptx || !item.downloadUrl) throw new SharepointError("PPT 본문 읽기를 쓸 수 없습니다.", 503);
    full = await deps.extractPptx(item.downloadUrl);
  } else {
    const buf = await downloadFile(token, item.driveId, item.id, deps.fetchImpl);
    full = item.ext === "xlsx" ? documentText(await parseDocumentAsync(buf, item.name)) : await textFromDocument(buf, item.name);
  }
  const { downloadUrl: _d, size: _s, ...rest } = item; void _d; void _s;
  return { item: rest, text: full.slice(0, maxChars), truncated: full.length > maxChars };
}
