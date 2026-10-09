/**
 * Confluence 개인 연동 — 순수 로직(네트워크 없음). 연결·토큰은 Jira 연결(jira_connections, 같은 Atlassian 사이트)을 함께 쓴다.
 * Confluence 권한은 CONFLUENCE_ENABLED=true일 때만 요청한다(Atlassian 개발자 콘솔에 권한을 등록한 뒤 켠다 — 미등록 상태로 요청하면 Jira 연결까지 실패).
 */
export const CONFLUENCE_SITE = "https://pms-innogrid.atlassian.net";
export const CONFLUENCE_SCOPES = ["read:confluence-content.all", "read:confluence-content.summary", "read:confluence-space.summary", "search:confluence", "write:confluence-content"] as const;
/** 읽기 기능에 꼭 필요한 권한 — 쓰기는 따로 확인한다 */
const READ_SCOPES = ["read:confluence-content.all", "search:confluence"];

export function confluenceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CONFLUENCE_ENABLED?.trim() === "true";
}

export function hasConfluenceScopes(scopes: readonly string[] | null | undefined): boolean {
  return !!scopes && READ_SCOPES.every((s) => scopes.includes(s));
}
export function canWriteConfluence(scopes: readonly string[] | null | undefined): boolean {
  return !!scopes && scopes.includes("write:confluence-content");
}

/** Jira 연결의 api_base(…/ex/jira/{cloudId}) → 같은 사이트의 Confluence(…/ex/confluence/{cloudId}) */
export function confluenceBase(jiraApiBase: string): string {
  const m = /^https:\/\/api\.atlassian\.com\/ex\/jira\/([0-9a-f-]{36})$/.exec(jiraApiBase);
  if (!m) throw new Error("Atlassian 연결 주소가 올바르지 않습니다.");
  return `https://api.atlassian.com/ex/confluence/${m[1]}`;
}

/** CQL 문자열 리터럴 — 따옴표·역슬래시 이스케이프, 200자 상한 */
export function cqlString(s: string): string {
  return `"${s.slice(0, 200).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const DOCS = "type in (page, blogpost)";
export function searchCql(q: string, spaceKey?: string): string {
  const space = spaceKey ? ` and space = ${cqlString(spaceKey)}` : "";
  return `${DOCS}${space} and text ~ ${cqlString(q)} order by lastmodified desc`;
}

export type FeedKind = "mentions" | "watching" | "recent";
export const FEED_KINDS: readonly FeedKind[] = ["mentions", "watching", "recent"];
export function feedCql(kind: FeedKind): string {
  if (kind === "mentions") return "type in (page, blogpost, comment) and mention = currentUser() order by lastmodified desc";
  if (kind === "watching") return `${DOCS} and watcher = currentUser() and lastmodified >= now("-14d") order by lastmodified desc`;
  return `${DOCS} and contributor = currentUser() order by lastmodified desc`;
}

export interface ConfluenceItem {
  id: string;
  type: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  url: string;
  excerpt: string;
  lastModified: string;
  by: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
export function siteUrl(webui: string): string {
  return webui.startsWith("/") ? `${CONFLUENCE_SITE}/wiki${webui}` : CONFLUENCE_SITE + "/wiki";
}

/** /wiki/rest/api/search 결과 한 줄 → 항목. id·제목이 없으면 null */
export function mapSearchResult(r: unknown): ConfluenceItem | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const c = (o.content ?? {}) as Record<string, unknown>;
  const id = str(c.id), title = str(c.title) || str(o.title);
  if (!id || !title) return null;
  const space = (c.space ?? {}) as Record<string, unknown>;
  const version = (c.version ?? {}) as Record<string, unknown>;
  const links = (c._links ?? {}) as Record<string, unknown>;
  return {
    id,
    type: str(c.type),
    title,
    spaceKey: str(space.key),
    spaceName: str(space.name),
    url: siteUrl(str(links.webui) || str(o.url)),
    excerpt: str(o.excerpt).replace(/@@@(?:end)?hl@@@/g, "").replace(/\s+/g, " ").trim().slice(0, 300),
    lastModified: str(o.lastModified) || str(version.when),
    by: str(((version.by ?? {}) as Record<string, unknown>).displayName),
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 줄 안 서식: 이스케이프 뒤 **굵게**·`코드` */
function inline(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
}
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/**
 * LLM·사용자가 쓴 마크다운 → Confluence storage(XHTML). 제목(#~###)·글머리(-, *)·번호(1.)·표(|)·문단만.
 * ponytail: 중첩 목록·링크·이미지는 평문으로 남긴다 — 필요해지면 그때 문법을 늘린다.
 */
export function markdownToStorage(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^[-*](\s+|$)/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*](\s+|$)/.test(lines[i].trim())) items.push(`<li>${inline(lines[i++].trim().replace(/^[-*]\s*/, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+[.)]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) items.push(`<li>${inline(lines[i++].trim().replace(/^\d+[.)]\s+/, ""))}</li>`);
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (t.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const r = cells(lines[i++]);
        if (!r.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(r);
      }
      const [head, ...body] = rows;
      out.push(`<table><tbody><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*](\s|$)|\d+[.)]\s|\|)/.test(lines[i].trim())) para.push(inline(lines[i++].trim()));
    out.push(`<p>${para.join("<br/>")}</p>`);
  }
  return out.join("");
}
