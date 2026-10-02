/**
 * API 비용을 키별로 나눈다. cost_report는 group_by가 workspace_id·description뿐이라 키별 금액이 없고,
 * usage_report/messages는 api_key_id·model별 토큰 수만 준다. 그래서 (일, 모델, 토큰 종류)의 실제 금액을
 * 그날 그 모델·종류의 키별 토큰 수 비중으로 나눈다 — 같은 조직·같은 종류면 단가가 같아 합은 실제 청구액과 같다.
 * 토큰 종류를 알 수 없는 항목(웹 검색 등)과 그날 사용량이 없는 금액은 미배분(apiKeyId null)으로 남긴다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/claude-usage/aggregate";
import { ADMIN_KEY_ENV, chunkDateRange, requestPage, syncApiCost } from "./anthropic-cost-report";
import type { ApiCostRow, ApiKeyCostRow, ApiKeyInfo, ApiUsageRow } from "@/types/claude-cost";

const USAGE_ENDPOINT = "https://api.anthropic.com/v1/organizations/usage_report/messages";
const KEYS_ENDPOINT = "https://api.anthropic.com/v1/organizations/api_keys";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseUsageReport(json: unknown): { rows: ApiUsageRow[]; hasMore: boolean; nextPage: string | null } {
  const j = json as { data?: unknown; has_more?: unknown; next_page?: unknown } | null;
  if (!j || !Array.isArray(j.data)) throw new Error("usage_report 응답 형식이 아닙니다.");
  const rows: ApiUsageRow[] = [];
  for (const b of j.data as { starting_at?: unknown; results?: unknown }[]) {
    const day = typeof b.starting_at === "string" ? b.starting_at.slice(0, 10) : null;
    if (!day || !Array.isArray(b.results)) continue;
    for (const r of b.results as Record<string, unknown>[]) {
      const cc = (r.cache_creation ?? {}) as Record<string, unknown>;
      const st = (r.server_tool_use ?? {}) as Record<string, unknown>;
      rows.push({
        day,
        api_key_id: typeof r.api_key_id === "string" ? r.api_key_id : "",
        model: typeof r.model === "string" ? r.model : "",
        uncached_input: num(r.uncached_input_tokens),
        cache_write_5m: num(cc.ephemeral_5m_input_tokens),
        cache_write_1h: num(cc.ephemeral_1h_input_tokens),
        cache_read: num(r.cache_read_input_tokens),
        output: num(r.output_tokens),
        web_search: num(st.web_search_requests),
      });
    }
  }
  return { rows: mergeUsageRows(rows), hasMore: j.has_more === true, nextPage: typeof j.next_page === "string" ? j.next_page : null };
}

/** pk(day, api_key_id, model)가 같은 행(서비스 등급·컨텍스트 창 차이)은 더한다 */
export function mergeUsageRows(rows: ApiUsageRow[]): ApiUsageRow[] {
  const m = new Map<string, ApiUsageRow>();
  for (const r of rows) {
    const k = `${r.day}|${r.api_key_id}|${r.model}`;
    const c = m.get(k);
    if (!c) { m.set(k, { ...r }); continue; }
    c.uncached_input += r.uncached_input; c.cache_write_5m += r.cache_write_5m; c.cache_write_1h += r.cache_write_1h;
    c.cache_read += r.cache_read; c.output += r.output; c.web_search += r.web_search;
  }
  return [...m.values()];
}

export async function fetchUsageReport(opts: { apiKey: string; from: string; to: string; fetchImpl?: typeof fetch; retryDelayMs?: number }): Promise<ApiUsageRow[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out: ApiUsageRow[] = [];
  for (const chunk of chunkDateRange(opts.from, opts.to)) {
    let page: string | null = null;
    do {
      const url = new URL(USAGE_ENDPOINT);
      url.searchParams.set("starting_at", `${chunk.from}T00:00:00Z`);
      url.searchParams.set("ending_at", `${addDays(chunk.to, 1)}T00:00:00Z`);
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.append("group_by[]", "api_key_id");
      url.searchParams.append("group_by[]", "model");
      url.searchParams.set("limit", "31");
      if (page) url.searchParams.set("page", page);
      const parsed = parseUsageReport(await requestPage(url, opts.apiKey, fetchImpl, opts.retryDelayMs ?? 1000, "usage_report"));
      out.push(...parsed.rows);
      page = parsed.hasMore ? parsed.nextPage : null;
    } while (page);
  }
  return mergeUsageRows(out);
}

export async function fetchApiKeys(opts: { apiKey: string; fetchImpl?: typeof fetch }): Promise<ApiKeyInfo[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out: ApiKeyInfo[] = [];
  let after: string | null = null;
  do {
    const url = new URL(KEYS_ENDPOINT);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after_id", after);
    const j = (await requestPage(url, opts.apiKey, fetchImpl, 1000, "api_keys")) as { data?: Record<string, unknown>[]; has_more?: boolean; last_id?: string };
    for (const k of j.data ?? []) {
      if (typeof k.id !== "string") continue;
      out.push({
        id: k.id,
        name: typeof k.name === "string" ? k.name : k.id,
        status: typeof k.status === "string" ? k.status : "unknown",
        workspace_id: typeof k.workspace_id === "string" ? k.workspace_id : null,
        hint: typeof k.partial_key_hint === "string" ? k.partial_key_hint : null,
        created_at: typeof k.created_at === "string" ? k.created_at : null,
      });
    }
    after = j.has_more && j.last_id ? j.last_id : null;
  } while (after);
  return out;
}

type TokenKind = "input" | "cache_read" | "cache_write" | "output";

/** cost_report description의 토큰 종류("Claude Opus 5.5 - Input Tokens, Cache Hit"). 모르면 null */
export function tokenKindOf(description: string): TokenKind | null {
  const d = description.toLowerCase();
  if (d.includes("output tokens")) return "output";
  if (d.includes("cache hit") || d.includes("cache read")) return "cache_read";
  if (d.includes("cache write")) return "cache_write";
  if (d.includes("input tokens")) return "input";
  return null;
}

function weightOf(u: ApiUsageRow, kind: TokenKind): number {
  switch (kind) {
    case "input": return u.uncached_input;
    case "cache_read": return u.cache_read;
    // 캐시 쓰기는 5분 ×1.25, 1시간 ×2 단가 — 한 항목에 섞여 오므로 단가 비율로 가중한다
    case "cache_write": return u.cache_write_5m * 1.25 + u.cache_write_1h * 2;
    case "output": return u.output;
  }
}

/** 실제 비용 행을 키별로 배분. 결과 합 = 입력 합(소수 센트 오차 제외) */
export function allocateCostByKey(costs: ApiCostRow[], usage: ApiUsageRow[]): ApiKeyCostRow[] {
  const usageBy = new Map<string, ApiUsageRow[]>();
  for (const u of usage) {
    const k = `${u.day}|${u.model}`;
    usageBy.set(k, [...(usageBy.get(k) ?? []), u]);
  }
  const out = new Map<string, ApiKeyCostRow>();
  const add = (day: string, apiKeyId: string | null, model: string, cents: number) => {
    const k = `${day}|${apiKeyId ?? ""}|${model}`;
    const c = out.get(k);
    if (c) c.cents += cents;
    else out.set(k, { day, apiKeyId, model, cents });
  };
  for (const c of costs) {
    const cents = Number(c.amount_cents);
    if (!cents) continue;
    const model = c.model ?? "";
    const kind = c.cost_type === "tokens" ? tokenKindOf(c.description) : null;
    const us = kind && model ? usageBy.get(`${c.day}|${model}`) ?? [] : [];
    const weights = kind ? us.map((u) => weightOf(u, kind)) : [];
    const total = weights.reduce((a, b) => a + b, 0);
    if (!kind || total <= 0) { add(c.day, null, model, cents); continue; }
    us.forEach((u, i) => { if (weights[i] > 0) add(c.day, u.api_key_id || null, model, (cents * weights[i]) / total); });
  }
  return [...out.values()];
}

export async function upsertApiUsage(admin: SupabaseClient, rows: ApiUsageRow[], keys: ApiKeyInfo[]): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("claude_api_usage_daily").upsert(rows.slice(i, i + 500).map((r) => ({ ...r, synced_at: now })), { onConflict: "day,api_key_id,model" });
    if (error) throw new Error(`claude_api_usage_daily: ${error.message}`);
  }
  if (keys.length) {
    const { error } = await admin.from("claude_api_keys").upsert(keys.map((k) => ({ ...k, synced_at: now })), { onConflict: "id" });
    if (error) throw new Error(`claude_api_keys: ${error.message}`);
  }
}

/** 비용(cost_report) + 키별 토큰(usage_report) + 키 목록을 함께 수집. 크론·지금 수집이 이것을 부른다 */
export async function syncApiCostAndUsage(admin: SupabaseClient, from: string, to: string): Promise<{ upserted: number; usageRows: number; keys: number }> {
  const apiKey = process.env[ADMIN_KEY_ENV];
  if (!apiKey) throw new Error("CLAUDE_ADMIN_API_KEY가 설정되지 않았습니다.");
  const cost = await syncApiCost(admin, from, to);
  const [usage, keys] = await Promise.all([fetchUsageReport({ apiKey, from, to }), fetchApiKeys({ apiKey })]);
  await upsertApiUsage(admin, usage, keys);
  return { ...cost, usageRows: usage.length, keys: keys.length };
}
