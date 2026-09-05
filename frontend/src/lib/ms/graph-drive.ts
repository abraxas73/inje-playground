/**
 * Microsoft Graph 드라이브(위임 토큰) — 공유 링크 → 폴더 해석, 파일 업로드(스펙 §4·§5.2).
 * 4MiB 미만은 단순 PUT(conflictBehavior=replace), 이상은 업로드 세션 + 10MiB 청크.
 * 429·503은 Retry-After(기본 2초, 최대 5초) 뒤 1회 재시도. 토큰은 로그에 쓰지 않는다.
 */
import type { FetchLike } from "@/lib/notify/types";
import { GRAPH_BASE } from "@/lib/teams-graph";

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Graph 응답 request-id 헤더 — 지원 문의용, 로그에 남긴다 */
    public readonly requestId: string | null,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

/** 사용자에게 그대로 보여줄 폴더 링크 오류(400 형식/파일 링크/해석 불가, 403 권한) */
export class FolderResolveError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "FolderResolveError";
  }
}

/** shares API 규격: "u!" + base64url(url) — 패딩 제거, + → -, / → _ */
export function encodeShareUrl(url: string): string {
  return "u!" + Buffer.from(url, "utf8").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function readGraphError(res: Response): Promise<GraphError> {
  const requestId = res.headers.get("request-id");
  let code = `http_${res.status}`;
  let message = `Graph ${res.status}`;
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    if (j.error?.code) code = j.error.code;
    if (j.error?.message) message = j.error.message;
  } catch {
    // 본문 없음
  }
  return new GraphError(res.status, code, message, requestId);
}

export type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const RETRY_STATUSES = new Set([429, 503]);

export function retryDelayMs(retryAfter: string | null): number {
  const s = Number(retryAfter);
  if (!retryAfter || !Number.isFinite(s) || s <= 0) return 2000;
  return Math.min(s, 5) * 1000;
}

/** 429·503이면 Retry-After 뒤 같은 요청을 한 번 더 보낸다(두 번째 응답을 그대로 돌려준다) */
export async function fetchWithRetry(fetchImpl: FetchLike, url: string, init: RequestInit, sleep: Sleep = defaultSleep): Promise<Response> {
  const first = await fetchImpl(url, init);
  if (!RETRY_STATUSES.has(first.status)) return first;
  await sleep(retryDelayMs(first.headers.get("Retry-After")));
  return fetchImpl(url, init);
}

export interface ResolvedFolder {
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string;
}

const RESOLVE_FAIL = "링크를 해석할 수 없습니다. 폴더의 '링크 복사'를 사용하세요.";

/** GET /shares/{u!…}/driveItem — 폴더가 아니면·해석 불가·권한 없음은 FolderResolveError, 그 외 실패는 GraphError */
export async function resolveFolder(token: string, url: string, fetchImpl: FetchLike = fetch, sleep: Sleep = defaultSleep): Promise<ResolvedFolder> {
  const res = await fetchWithRetry(
    fetchImpl,
    `${GRAPH_BASE}/shares/${encodeShareUrl(url)}/driveItem?$select=id,name,webUrl,folder,parentReference`,
    { headers: { Authorization: `Bearer ${token}` } },
    sleep,
  );
  if (!res.ok) {
    const err = await readGraphError(res);
    if (res.status === 403) throw new FolderResolveError(403, "이 폴더를 볼 권한이 없습니다.");
    if (res.status === 400 || res.status === 404) throw new FolderResolveError(400, RESOLVE_FAIL);
    throw err;
  }
  const j = (await res.json()) as { id?: string; name?: string; webUrl?: string; folder?: unknown; parentReference?: { driveId?: string } };
  if (!j.folder) throw new FolderResolveError(400, "폴더 링크가 아닙니다. 파일이 아닌 폴더의 링크를 붙여 주세요.");
  if (!j.id || !j.parentReference?.driveId) throw new FolderResolveError(400, RESOLVE_FAIL);
  return { driveId: j.parentReference.driveId, itemId: j.id, name: j.name ?? "", webUrl: j.webUrl ?? "" };
}

export const SMALL_UPLOAD_MAX = 4 * 1024 * 1024;
export const CHUNK_SIZE = 10 * 1024 * 1024;
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface UploadTarget {
  driveId: string;
  itemId: string;
  fileName: string;
  buffer: Buffer;
  contentType?: string;
}

export interface UploadedItem {
  id: string;
  name: string;
  webUrl: string;
  size: number;
}

function itemUrl(t: UploadTarget, suffix: string): string {
  return `${GRAPH_BASE}/drives/${encodeURIComponent(t.driveId)}/items/${encodeURIComponent(t.itemId)}:/${encodeURIComponent(t.fileName)}:/${suffix}`;
}

function toItem(j: Record<string, unknown>): UploadedItem {
  return { id: String(j.id ?? ""), name: String(j.name ?? ""), webUrl: String(j.webUrl ?? ""), size: Number(j.size ?? 0) };
}

/** 폴더(driveId/itemId) 아래에 fileName으로 올린다. 같은 이름은 덮어쓴다(SharePoint 버전 이력 보존). */
export async function uploadFile(token: string, t: UploadTarget, fetchImpl: FetchLike = fetch, sleep: Sleep = defaultSleep): Promise<UploadedItem> {
  const auth = { Authorization: `Bearer ${token}` };
  const contentType = t.contentType ?? XLSX_MIME;

  if (t.buffer.length < SMALL_UPLOAD_MAX) {
    const res = await fetchWithRetry(
      fetchImpl,
      itemUrl(t, "content?@microsoft.graph.conflictBehavior=replace"),
      { method: "PUT", headers: { ...auth, "Content-Type": contentType }, body: new Uint8Array(t.buffer) },
      sleep,
    );
    if (!res.ok) throw await readGraphError(res);
    return toItem((await res.json()) as Record<string, unknown>);
  }

  const sess = await fetchWithRetry(
    fetchImpl,
    itemUrl(t, "createUploadSession"),
    { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace", name: t.fileName } }) },
    sleep,
  );
  if (!sess.ok) throw await readGraphError(sess);
  const { uploadUrl } = (await sess.json()) as { uploadUrl?: string };
  if (!uploadUrl) throw new GraphError(502, "no_upload_url", "업로드 세션 응답에 uploadUrl이 없습니다.", sess.headers.get("request-id"));

  const total = t.buffer.length;
  let last: Response | null = null;
  for (let start = 0; start < total; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, total) - 1;
    // uploadUrl은 사전 인증된 URL — Authorization을 붙이면 401이 난다(Graph 규격)
    last = await fetchWithRetry(
      fetchImpl,
      uploadUrl,
      { method: "PUT", headers: { "Content-Range": `bytes ${start}-${end}/${total}` }, body: new Uint8Array(t.buffer.subarray(start, end + 1)) },
      sleep,
    );
    if (!last.ok) throw await readGraphError(last);
  }
  if (!last || (last.status !== 200 && last.status !== 201)) {
    throw new GraphError(last?.status ?? 502, "incomplete", "업로드 세션이 완료되지 않았습니다.", last?.headers.get("request-id") ?? null);
  }
  return toItem((await last.json()) as Record<string, unknown>);
}
