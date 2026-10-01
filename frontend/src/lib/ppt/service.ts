/**
 * ppt-service(별도 Vercel FastAPI 프로젝트) 클라이언트. 서버 라우트·after()에서만 쓴다(토큰이 필요하므로 브라우저 금지).
 * 파일은 서명 URL로만 오간다 — 여기서는 JSON만 주고받는다.
 */
export interface PptCatalogEntry {
  name: string; slide: number | null; arity: number | null; desc: string; use: string;
  closing: { required: boolean; maxLines: number } | null; chips: number | null; required: string[];
  example: Record<string, unknown>;
  /** 슬롯 용량 {역할: [줄당 글자, 줄 수]} — 패키지 capacity.py 실측값(구버전 서비스에는 없다) */
  capacity?: Record<string, [number, number]>;
  /** 표 장표의 표 자리 — 높이·폭과 드는 행 수(한 줄 행/두 줄 행), 한 줄 글자 수(열 합계) */
  table?: { widthCm: number; heightCm: number; rowsOneLine: number; rowsTwoLine: number; charsPerLine: number } | null;
}
export interface PptCatalog {
  layouts: PptCatalogEntry[]; message: PptCatalogEntry; products: string[]; overview: string[];
  productExample: Record<string, unknown>[]; templateSlides: number; package: string;
  /** 내장 템플릿 파일명 */
  templateFile?: string;
  /** 모든 장표 공통 슬롯(page_title·section_label) 용량 */
  capacityCommon?: Record<string, [number, number]>;
}
export interface PptExtractSlide {
  no: number; title: string | null; texts: string[]; pictures: number; hasTable: boolean; hasChart: boolean; titleBottomCm: number | null;
}
export interface PptBuildRequest {
  spec: unknown; sourceUrl?: string; extract?: PptExtractSlide[]; upload: { pptxUrl: string; yamlUrl: string };
  /** 업로드 템플릿(서명 URL)과 캐시 키. 없으면 내장 템플릿 */
  templateUrl?: string; templateId?: string;
  /** URL 원고 이미지 {"N": 서명 URL} — deck JSON의 images "url:N" */
  imageUrls?: Record<string, string>;
}
export type PptTemplateValidation = { ok: true; file: string; slides: number; issues: Record<string, string[]>; advisories: string[]; bytes: number } | { ok: false; error: string };
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
  /** 업로드 템플릿 검증(장 수 + 샘플 덱 전체 빌드) */
  validateTemplate(templateUrl: string): Promise<PptTemplateValidation>;
}

let catalogCache: PptCatalog | null = null;
function detailText(body: { detail?: unknown; message?: string }, status: number): string {
  if (typeof body.detail === "string") return body.detail;
  if (body.detail !== undefined && body.detail !== null) return JSON.stringify(body.detail);
  return body.message ?? `PPT 서비스 오류(${status})`;
}

export function resetCatalogCache() { catalogCache = null; }

const CATALOG_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 90_000;
const VALIDATE_TIMEOUT_MS = 180_000;

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
    if (res.ok || (init.accept422 && res.status === 422)) {
      let body: unknown;
      try { body = await res.json(); } catch { throw new PptServiceError(res.status, "PPT 서비스 응답이 JSON이 아닙니다."); }
      // 빌드 실패 본문은 ok:boolean을 갖는다. FastAPI 요청 검증 422({detail})는 실패로 취급한다.
      if (!res.ok && typeof (body as { ok?: unknown })?.ok !== "boolean") throw new PptServiceError(422, detailText((body ?? {}) as { detail?: unknown }, 422));
      return body as T;
    }
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown; message?: string };
    if (res.status === 401) throw new PptServiceError(401, "PPT 서비스 토큰이 일치하지 않습니다(PPT_SERVICE_TOKEN).");
    throw new PptServiceError(res.status, detailText(body, res.status));
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
    validateTemplate(templateUrl) {
      return call<PptTemplateValidation>("/template/validate", { method: "POST", body: { templateUrl }, timeoutMs: VALIDATE_TIMEOUT_MS, accept422: true });
    },
  };
}
