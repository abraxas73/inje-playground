/**
 * SharePoint·OneDrive 개인 연동 — 순수 로직(네트워크 없음).
 * 토큰은 Microsoft 연결(ms_connections)의 위임 토큰을 그대로 쓴다 — 이미 받은 Files.ReadWrite.All·Sites.Read.All로 충분해 새 권한·재연결이 없다.
 * 본인에게 보이는 문서만 다루고, 본문·토큰은 저장·로그하지 않는다.
 */
export class SharepointError extends Error {
  constructor(message: string, public status = 502, public code = "sharepoint_error") { super(message); }
}

export interface SharepointItem {
  /** driveItem id — driveId와 함께 읽기·즐겨찾기 키 */
  id: string;
  driveId: string;
  name: string;
  url: string;
  /** 사이트·문서 라이브러리·폴더(짧게) */
  container: string;
  /** 최근 사용·수정·공유 시각(ISO) */
  at: string;
  by: string;
  ext: string;
  kind: "file" | "folder";
}

export type FeedKind = "used" | "shared" | "trending" | "recent";
export const FEED_KINDS: readonly FeedKind[] = ["used", "shared", "trending", "recent"];
export const FEED_LABEL: Record<FeedKind, string> = { used: "자주 쓰는 문서", shared: "나와 공유", trending: "주변에서 많이 보는", recent: "최근 연 문서" };

/** 본문을 텍스트로 읽을 수 있는 형식(pptx는 ppt-service /extract) */
export const READABLE_EXTENSIONS = ["docx", "pdf", "hwp", "hwpx", "xlsx", "pptx", "md", "txt", "html", "htm"] as const;
export const FAVORITES_MAX = 30;
export const FAVORITES_KEY = "sharepoint_favorites";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
export const extOf = (name: string) => { const i = name.lastIndexOf("."); return i < 0 ? "" : name.slice(i + 1).toLowerCase(); };
export const itemKey = (i: Pick<SharepointItem, "driveId" | "id">) => `${i.driveId}/${i.id}`;

export function isSharepointUrl(url: string): boolean {
  try { const h = new URL(url.trim()).host.toLowerCase(); return h.endsWith(".sharepoint.com") && !h.includes("/"); } catch { return false; }
}

const SKIP_SEGMENTS = new Set(["sites", "teams", "personal", "shared documents", "documents", "forms", "_layouts", "15"]);
/** webUrl → "사이트 › 폴더" 꼴 짧은 위치. 개인 OneDrive는 "OneDrive". 파일 이름은 뺀다. */
export function containerFromUrl(webUrl: string, isFolder = false): string {
  try {
    const u = new URL(webUrl);
    const parts = u.pathname.split("/").map((p) => { try { return decodeURIComponent(p); } catch { return p; } }).filter(Boolean);
    if (!isFolder) parts.pop();
    const mine = u.host.toLowerCase().endsWith("-my.sharepoint.com");
    const kept = parts.filter((p, i) => !(SKIP_SEGMENTS.has(p.toLowerCase()) || (mine && i <= 1)));
    const out = (mine ? ["OneDrive", ...kept] : kept).join(" › ");
    return out.length > 60 ? `…${out.slice(-59)}` : out;
  } catch { return ""; }
}

/** driveItem(검색 hit·/me/drive/recent — remoteItem이면 그쪽이 실제 항목) → 항목. id·driveId·이름이 없으면 null */
export function mapDriveItem(raw: unknown): SharepointItem | null {
  const o = rec(raw);
  const r = rec(o.remoteItem);
  const src = Object.keys(r).length ? { ...o, ...r } : o;
  const id = str(src.id), name = str(src.name), driveId = str(rec(src.parentReference).driveId);
  if (!id || !name || !driveId) return null;
  const kind = src.folder ? "folder" : "file";
  const url = str(src.webUrl) || str(o.webUrl);
  return {
    id, driveId, name, url, kind, ext: kind === "file" ? extOf(name) : "",
    container: containerFromUrl(url, kind === "folder"),
    at: str(src.lastModifiedDateTime) || str(o.lastModifiedDateTime) || str(rec(o.fileSystemInfo).lastAccessedDateTime),
    by: str(rec(rec(src.lastModifiedBy).user).displayName),
  };
}

/** 인사이트(used·shared·trending) 한 줄 → 항목. resourceReference.id "drives/{driveId}/items/{id}"가 아니면(웹 링크 등) null */
export function mapInsight(raw: unknown): SharepointItem | null {
  const o = rec(raw);
  const ref = rec(o.resourceReference), vis = rec(o.resourceVisualization);
  const m = /^drives\/([^/]+)\/items\/([^/]+)$/.exec(str(ref.id));
  if (!m) return null;
  const url = str(ref.webUrl);
  const name = str(vis.title) || decodeURIComponent(url.split("/").pop() ?? "");
  if (!name) return null;
  const shared = rec(o.lastShared), used = rec(o.lastUsed);
  const kind = str(vis.type).toLowerCase() === "folder" ? "folder" : "file";
  return {
    id: m[2], driveId: m[1], name, url, kind, ext: kind === "file" ? extOf(name) : "",
    container: str(vis.containerDisplayName) || containerFromUrl(url, kind === "folder"),
    at: str(used.lastAccessedDateTime) || str(shared.sharedDateTime) || str(o.lastModifiedDateTime) || str(used.lastModifiedDateTime),
    by: str(rec(rec(shared.sharedBy).user).displayName) || str(rec(shared.sharedBy).displayName),
  };
}

/** 같은 문서(driveId/id)는 한 번만 */
export function dedupe(items: Array<SharepointItem | null>): SharepointItem[] {
  const seen = new Set<string>();
  const out: SharepointItem[] = [];
  for (const i of items) { if (!i || seen.has(itemKey(i))) continue; seen.add(itemKey(i)); out.push(i); }
  return out;
}

/** POST /search/query 본문 — driveItem만, 본인 권한 범위. 따옴표는 KQL이 해석하지 않게 뺀다 */
export function searchBody(q: string, size: number) {
  const queryString = q.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return { requests: [{ entityTypes: ["driveItem"], query: { queryString }, from: 0, size: Math.min(25, Math.max(1, size)) }] };
}
/** 검색 응답 → 항목(폴더 제외) */
export function mapSearchResponse(j: unknown): SharepointItem[] {
  const hits: unknown[] = [];
  for (const v of (rec(j).value as unknown[]) ?? []) for (const c of (rec(v).hitsContainers as unknown[]) ?? []) hits.push(...(((rec(c).hits as unknown[]) ?? [])));
  return dedupe(hits.map((h) => mapDriveItem(rec(h).resource))).filter((i) => i.kind === "file");
}

export interface Favorite { driveId: string; id: string; name: string; url: string; container: string; kind: "file" | "folder"; addedAt: string }
export function parseFavorites(raw: string | null | undefined): Favorite[] {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.filter((f): f is Favorite => !!f && typeof f === "object" && typeof f.driveId === "string" && typeof f.id === "string" && typeof f.name === "string" && typeof f.url === "string").slice(0, FAVORITES_MAX);
  } catch { return []; }
}
/** 앞에 넣고(최근 추가가 먼저) 같은 문서는 빼고, 상한을 넘으면 거절 */
export function addFavorite(list: Favorite[], f: Favorite): Favorite[] {
  const rest = list.filter((x) => itemKey(x) !== itemKey(f));
  if (rest.length >= FAVORITES_MAX) throw new SharepointError(`즐겨찾기는 ${FAVORITES_MAX}개까지 둘 수 있습니다.`, 400);
  return [f, ...rest];
}
export const removeFavorite = (list: Favorite[], key: string) => list.filter((x) => itemKey(x) !== key);
