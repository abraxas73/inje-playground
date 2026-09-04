/**
 * Confluence Cloud 페이지 조회(스펙 §3.2). 사용자가 준 URL은 요청하지 않는다 — 페이지 id만 뽑아
 * ATLASSIAN_SITE의 REST를 부른다. 자격은 work-metrics/confluence.ts와 같은 ATLASSIAN_* Basic 인증.
 */
export interface ConfluenceConfig {
  /** 끝 슬래시 없는 사이트 URL: https://xxx.atlassian.net */
  site: string;
  /** URL 호스트 검사용: xxx.atlassian.net */
  host: string;
  /** "Basic base64(email:token)" */
  auth: string;
}

export function confluenceConfig(env: Record<string, string | undefined> = process.env): ConfluenceConfig | null {
  const site = (env.ATLASSIAN_SITE ?? "").trim().replace(/\/+$/, "");
  const email = (env.ATLASSIAN_EMAIL ?? "").trim();
  const token = (env.ATLASSIAN_API_TOKEN ?? "").trim();
  if (!site || !email || !token) return null;
  let host: string;
  try {
    host = new URL(site).host;
  } catch {
    return null;
  }
  return { site, host, auth: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` };
}

export class ConfluenceUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfluenceUrlError";
  }
}

/**
 * 지원 URL: /wiki/spaces/{KEY}/pages/{id}[/{title}], /wiki/pages/{id}, /wiki/pages/viewpage.action?pageId={id}.
 * 짧은 링크(/wiki/x/…)와 다른 호스트는 거부한다.
 */
export function parseConfluencePageId(url: string, expectedHost: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new ConfluenceUrlError("올바른 URL이 아닙니다.");
  }
  if (u.host.toLowerCase() !== expectedHost.toLowerCase()) {
    throw new ConfluenceUrlError(`설정된 Confluence 사이트(${expectedHost})의 페이지만 등록할 수 있습니다.`);
  }
  if (/^\/wiki\/x\//.test(u.pathname)) {
    throw new ConfluenceUrlError("짧은 링크(/wiki/x/…)는 지원하지 않습니다. 페이지 전체 URL을 넣어 주세요.");
  }
  const spaces = /^\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/|$)/.exec(u.pathname);
  if (spaces) return spaces[1];
  const pages = /^\/wiki\/pages\/(\d+)(?:\/|$)/.exec(u.pathname);
  if (pages) return pages[1];
  if (u.pathname === "/wiki/pages/viewpage.action") {
    const id = u.searchParams.get("pageId");
    if (id && /^\d+$/.test(id)) return id;
  }
  throw new ConfluenceUrlError("페이지 전체 URL을 넣어 주세요(예: https://…/wiki/spaces/KEY/pages/123456/제목).");
}

export class ConfluenceFetchError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ConfluenceFetchError";
  }
}

export interface ConfluencePage {
  id: string;
  title: string;
  version: number;
  storageHtml: string;
}

interface ContentResponse {
  id?: string | number;
  title?: string;
  version?: { number?: number };
  body?: { storage?: { value?: string } };
}

/** GET {site}/wiki/rest/api/content/{id}?expand=body.storage,version — fetch는 테스트에서 주입 */
export async function fetchConfluencePage(cfg: ConfluenceConfig, pageId: string, fetchImpl: typeof fetch = fetch): Promise<ConfluencePage> {
  const res = await fetchImpl(`${cfg.site}/wiki/rest/api/content/${pageId}?expand=body.storage,version`, {
    headers: { Authorization: cfg.auth, Accept: "application/json" },
  });
  if (!res.ok) {
    const label = res.status === 403 ? "권한 없음(403)" : res.status === 404 ? "페이지 없음(404)" : `Confluence 오류(${res.status})`;
    throw new ConfluenceFetchError(res.status, label);
  }
  const j = (await res.json()) as ContentResponse;
  return {
    id: String(j.id ?? pageId),
    title: j.title ?? "",
    version: Number(j.version?.number ?? 0),
    storageHtml: j.body?.storage?.value ?? "",
  };
}
