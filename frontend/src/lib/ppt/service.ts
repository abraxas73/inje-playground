/**
 * ppt-service(별도 Vercel FastAPI 프로젝트) 클라이언트. 서버 라우트·after()에서만 쓴다(토큰이 필요하므로 브라우저 금지).
 * 파일은 서명 URL로만 오간다 — 여기서는 JSON만 주고받는다.
 */
export interface PptCatalogEntry {
  name: string; slide: number | null; arity: number | null; desc: string; use: string;
  closing: { required: boolean; maxLines: number } | null; chips: number | null; required: string[];
  example: Record<string, unknown>;
}
export interface PptCatalog {
  layouts: PptCatalogEntry[]; message: PptCatalogEntry; products: string[]; overview: string[];
  productExample: Record<string, unknown>[]; templateSlides: number; package: string;
}
export interface PptExtractSlide {
  no: number; title: string | null; texts: string[]; pictures: number; hasTable: boolean; hasChart: boolean; titleBottomCm: number | null;
}
export interface PptBuildRequest {
  spec: unknown; sourceUrl?: string; extract?: PptExtractSlide[]; upload: { pptxUrl: string; yamlUrl: string };
}
export interface PptBuildOk { ok: true; slides: number; advisories: string[]; issues: Record<string, string[]>; bytes: number }
export interface PptBuildFail { ok: false; kind: "spec" | "overflow" | "template" | "internal"; message: string; section: number | null; slide: number | null }
export type PptBuildResult = PptBuildOk | PptBuildFail;

export class PptServiceError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "PptServiceError"; }
}

export interface PptServiceClient {
  catalog(): Promise<PptCatalog>;
  extract(sourceUrl: string): Promise<PptExtractSlide[]>;
  build(req: PptBuildRequest): Promise<PptBuildResult>;
}

let catalogCache: PptCatalog | null = null;
export function resetCatalogCache() { catalogCache = null; }

const CATALOG_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 90_000;

export function createPptServiceClient(opts: { baseUrl?: string; token?: string; fetchImpl?: typeof fetch } = {}): PptServiceClient {
  const baseUrl = (opts.baseUrl ?? process.env.PPT_SERVICE_URL ?? "").replace(/\/+$/, "");
  const token = opts.token ?? process.env.PPT_SERVICE_TOKEN ?? "";
  if (!baseUrl || !token) throw new PptServiceError(500, "PPT_SERVICE_URL/PPT_SERVICE_TOKEN이 설정되지 않았습니다.");
  const f = opts.fetchImpl ?? fetch;

  async function call<T>(path: string, init: { method?: string; body?: unknown; timeoutMs: number; accept422?: boolean }): Promise<T> {
    let res: Response;
    try {
      res = await f(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: { "x-ppt-token": token, "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs),
      });
    } catch (e) {
      throw new PptServiceError(503, `PPT 서비스에 연결할 수 없습니다(${e instanceof Error ? e.name : "error"}).`);
    }
    if (res.ok || (init.accept422 && res.status === 422)) return (await res.json()) as T;
    const body = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
    throw new PptServiceError(res.status, body.detail ?? body.message ?? `PPT 서비스 오류(${res.status})`);
  }

  return {
    async catalog() {
      if (catalogCache) return catalogCache;
      const c = await call<PptCatalog>("/catalog", { timeoutMs: CATALOG_TIMEOUT_MS });
      catalogCache = c;
      return c;
    },
    async extract(sourceUrl) {
      const r = await call<{ slides: PptExtractSlide[] }>("/extract", { method: "POST", body: { sourceUrl }, timeoutMs: CATALOG_TIMEOUT_MS });
      return r.slides;
    },
    build(req) {
      return call<PptBuildResult>("/build", { method: "POST", body: req, timeoutMs: BUILD_TIMEOUT_MS, accept422: true });
    },
  };
}
