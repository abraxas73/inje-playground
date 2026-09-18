/**
 * Anthropic Admin API — GET /v1/organizations/cost_report (Claude Console 조직의 API 사용분 실제 비용).
 * claude.ai Team 좌석 구독료는 여기 없다(인보이스로만). 키(`sk-ant-admin01-…`)는 env CLAUDE_ADMIN_API_KEY.
 * amount는 센트 단위 소수 문자열("123.78912")이라 문자열로 보존해 numeric 컬럼에 넣는다.
 * 문서: 1d 버킷, 호출당 최대 31버킷, has_more/next_page 페이지네이션, 값은 30일간 사후 보정될 수 있다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/claude-usage/aggregate";
import type { ApiCostRow } from "@/types/claude-cost";

export const ADMIN_KEY_ENV = "CLAUDE_ADMIN_API_KEY";
const ENDPOINT = "https://api.anthropic.com/v1/organizations/cost_report";
const USER_AGENT = "inje-playground/1.0 (https://inje-playground.vercel.app)";

export function isApiCostAvailable(): boolean {
  return !!process.env[ADMIN_KEY_ENV];
}

export function parseCostReport(json: unknown): { rows: ApiCostRow[]; hasMore: boolean; nextPage: string | null } {
  const j = json as { data?: unknown; has_more?: unknown; next_page?: unknown } | null;
  if (!j || !Array.isArray(j.data)) throw new Error("cost_report 응답 형식이 아닙니다.");
  const rows: ApiCostRow[] = [];
  for (const b of j.data as { starting_at?: unknown; results?: unknown }[]) {
    const day = typeof b.starting_at === "string" ? b.starting_at.slice(0, 10) : null;
    if (!day || !Array.isArray(b.results)) continue;
    for (const r of b.results as Record<string, unknown>[]) {
      const amount = typeof r.amount === "string" ? r.amount : typeof r.amount === "number" ? String(r.amount) : null;
      if (amount === null || !/^-?\d+(\.\d+)?$/.test(amount)) continue;
      rows.push({
        day,
        workspace_id: typeof r.workspace_id === "string" ? r.workspace_id : "",
        description: typeof r.description === "string" ? r.description : "(전체)",
        cost_type: typeof r.cost_type === "string" ? r.cost_type : null,
        model: typeof r.model === "string" ? r.model : null,
        amount_cents: amount,
        currency: typeof r.currency === "string" ? r.currency : "USD",
      });
    }
  }
  return { rows, hasMore: j.has_more === true, nextPage: typeof j.next_page === "string" ? j.next_page : null };
}

/** pk(day, workspace_id, description)가 같은 행(컨텍스트 창·토큰 종류가 달라도 description이 같을 수 있다)은 금액을 더한다 */
export function mergeCostRows(rows: ApiCostRow[]): ApiCostRow[] {
  const byKey = new Map<string, ApiCostRow & { sum: number }>();
  for (const r of rows) {
    const k = `${r.day}|${r.workspace_id}|${r.description}`;
    const cur = byKey.get(k);
    if (cur) cur.sum += Number(r.amount_cents);
    else byKey.set(k, { ...r, sum: Number(r.amount_cents) });
  }
  return [...byKey.values()].map(({ sum, ...r }) => ({ ...r, amount_cents: sum.toFixed(6) }));
}

export function chunkDateRange(from: string, to: string, maxDays = 31): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let start = from; start <= to; start = addDays(start, maxDays)) {
    const end = addDays(start, maxDays - 1);
    out.push({ from: start, to: end < to ? end : to });
  }
  return out;
}

async function requestPage(url: URL, apiKey: string, fetchImpl: typeof fetch, retryDelayMs: number): Promise<unknown> {
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "User-Agent": USER_AGENT, Accept: "application/json" };
  let res = await fetchImpl(url.toString(), { headers });
  if (res.status === 429 || res.status >= 500) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    res = await fetchImpl(url.toString(), { headers });
  }
  if (res.status === 401 || res.status === 403) throw new Error(`관리자 키가 거부되었습니다(HTTP ${res.status}). Console > Admin keys에서 키를 확인하세요.`);
  if (!res.ok) throw new Error(`cost_report HTTP ${res.status}`);
  return res.json();
}

/** from~to(양끝 포함, UTC 날짜)의 일별 비용. 31일 청크 × 페이지네이션 */
export async function fetchCostReport(opts: { apiKey: string; from: string; to: string; fetchImpl?: typeof fetch; retryDelayMs?: number }): Promise<ApiCostRow[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out: ApiCostRow[] = [];
  for (const chunk of chunkDateRange(opts.from, opts.to)) {
    let page: string | null = null;
    do {
      const url = new URL(ENDPOINT);
      url.searchParams.set("starting_at", `${chunk.from}T00:00:00Z`);
      url.searchParams.set("ending_at", `${addDays(chunk.to, 1)}T00:00:00Z`);
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.append("group_by[]", "workspace_id");
      url.searchParams.append("group_by[]", "description");
      url.searchParams.set("limit", "31");
      if (page) url.searchParams.set("page", page);
      const parsed = parseCostReport(await requestPage(url, opts.apiKey, fetchImpl, opts.retryDelayMs ?? 1000));
      out.push(...parsed.rows);
      page = parsed.hasMore ? parsed.nextPage : null;
    } while (page);
  }
  return mergeCostRows(out);
}

export async function upsertApiCost(admin: SupabaseClient, rows: ApiCostRow[]): Promise<{ upserted: number }> {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("claude_api_cost_daily").upsert(rows.slice(i, i + 500).map((r) => ({ ...r, synced_at: now })), { onConflict: "day,workspace_id,description" });
    if (error) throw new Error(`claude_api_cost_daily: ${error.message}`);
  }
  return { upserted: rows.length };
}

/** env 키로 수집해 저장. 키가 없으면 throw — 라우트가 먼저 isApiCostAvailable()로 걸러야 한다 */
export async function syncApiCost(admin: SupabaseClient, from: string, to: string): Promise<{ upserted: number }> {
  const apiKey = process.env[ADMIN_KEY_ENV];
  if (!apiKey) throw new Error("CLAUDE_ADMIN_API_KEY가 설정되지 않았습니다.");
  const rows = await fetchCostReport({ apiKey, from, to });
  return upsertApiCost(admin, rows);
}
