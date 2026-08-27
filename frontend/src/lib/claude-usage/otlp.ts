/**
 * OTLP/HTTP JSON(ExportMetricsServiceRequest / ExportLogsServiceRequest) → 앱 내부 행.
 * Claude Code는 delta temporality로 보내므로 같은 (day, org, email[, model]) 키를 합산한다.
 * 순수 함수 — I/O 없음.
 */
import {
  DAILY_NUMERIC_FIELDS,
  emptyDailyMetrics,
  type ApiRequestEvent,
  type DailyRow,
  type ModelRow,
} from "@/types/claude-usage";

type AnyValue = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
};
type KeyValue = { key: string; value?: AnyValue };
type Attrs = Record<string, string | number | boolean>;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function nanoToMs(nano: string | number | undefined): number | null {
  if (nano === undefined || nano === null || nano === "") return null;
  try {
    const big = typeof nano === "number" ? BigInt(Math.trunc(nano)) : BigInt(nano);
    return Number(big / BigInt(1_000_000));
  } catch {
    return null;
  }
}

/** ms(UTC) → Asia/Seoul 기준 YYYY-MM-DD */
export function kstDay(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function attrsToRecord(list: unknown): Attrs {
  const out: Attrs = {};
  if (!Array.isArray(list)) return out;
  for (const kv of list as KeyValue[]) {
    if (!kv || typeof kv.key !== "string" || !kv.value) continue;
    const v = kv.value;
    if (typeof v.stringValue === "string") out[kv.key] = v.stringValue;
    else if (v.intValue !== undefined) out[kv.key] = Number(v.intValue);
    else if (typeof v.doubleValue === "number") out[kv.key] = v.doubleValue;
    else if (typeof v.boolValue === "boolean") out[kv.key] = v.boolValue;
  }
  return out;
}

function str(a: Attrs, key: string): string | null {
  const v = a[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function num(a: Attrs, key: string): number | null {
  const v = a[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

interface Identity {
  org_id: string;
  user_email: string;
  account_uuid: string | null;
  session_id: string | null;
}
function identity(point: Attrs, resource: Attrs): Identity {
  const pick = (k: string) => str(point, k) ?? str(resource, k);
  const account_uuid = pick("user.account_uuid");
  const email = pick("user.email")?.toLowerCase() ?? null;
  return {
    org_id: pick("organization.id")?.toLowerCase() ?? "unknown",
    user_email: email ?? (account_uuid ? `uuid:${account_uuid}` : "unknown"),
    account_uuid,
    session_id: pick("session.id"),
  };
}

function isCumulative(t: unknown): boolean {
  if (t === 2) return true;
  return typeof t === "string" && t.toUpperCase().includes("CUMULATIVE");
}

function pointValue(p: { asDouble?: number; asInt?: string | number }): number | null {
  if (typeof p.asDouble === "number") return p.asDouble;
  if (p.asInt !== undefined) {
    const n = Number(p.asInt);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

class DailyAcc {
  private map = new Map<string, DailyRow>();
  add(day: string, id: Identity, field: (typeof DAILY_NUMERIC_FIELDS)[number], value: number) {
    const key = `${day}|${id.org_id}|${id.user_email}`;
    let row = this.map.get(key);
    if (!row) {
      row = { ...emptyDailyMetrics(), day, org_id: id.org_id, user_email: id.user_email, account_uuid: id.account_uuid };
      this.map.set(key, row);
    }
    if (!row.account_uuid && id.account_uuid) row.account_uuid = id.account_uuid;
    row[field] += value;
  }
  rows(): DailyRow[] {
    return [...this.map.values()];
  }
}

class ModelAcc {
  private map = new Map<string, ModelRow>();
  add(day: string, id: Identity, model: string, field: keyof Omit<ModelRow, "day" | "org_id" | "user_email" | "model">, value: number) {
    const key = `${day}|${id.org_id}|${id.user_email}|${model}`;
    let row = this.map.get(key);
    if (!row) {
      row = { day, org_id: id.org_id, user_email: id.user_email, model, cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
      this.map.set(key, row);
    }
    row[field] += value;
  }
  rows(): ModelRow[] {
    return [...this.map.values()];
  }
}

const TOKEN_TYPE_FIELD: Record<string, "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_creation_tokens"> = {
  input: "input_tokens",
  output: "output_tokens",
  cacheread: "cache_read_tokens",
  cachecreation: "cache_creation_tokens",
  cache_read: "cache_read_tokens",
  cache_creation: "cache_creation_tokens",
};

export function parseMetricsPayload(body: unknown): { daily: DailyRow[]; model: ModelRow[]; dropped: number } {
  const daily = new DailyAcc();
  const model = new ModelAcc();
  let dropped = 0;
  const rms = (body as { resourceMetrics?: unknown })?.resourceMetrics;
  if (!Array.isArray(rms)) return { daily: [], model: [], dropped: 0 };

  for (const rm of rms as { resource?: { attributes?: unknown }; scopeMetrics?: unknown }[]) {
    const resource = attrsToRecord(rm?.resource?.attributes);
    if (!Array.isArray(rm?.scopeMetrics)) continue;
    for (const sm of rm.scopeMetrics as { metrics?: unknown }[]) {
      if (!Array.isArray(sm?.metrics)) continue;
      for (const m of sm.metrics as { name?: string; sum?: { dataPoints?: unknown; aggregationTemporality?: unknown }; gauge?: { dataPoints?: unknown } }[]) {
        const name = m?.name;
        const dps = m?.sum?.dataPoints ?? m?.gauge?.dataPoints;
        if (!name || !Array.isArray(dps)) continue;
        if (m.sum && isCumulative(m.sum.aggregationTemporality)) {
          dropped += dps.length;
          continue;
        }
        for (const p of dps as { attributes?: unknown; timeUnixNano?: string | number; asDouble?: number; asInt?: string | number }[]) {
          const ms = nanoToMs(p.timeUnixNano);
          const value = pointValue(p);
          if (ms === null || value === null) {
            dropped++;
            continue;
          }
          const a = attrsToRecord(p.attributes);
          const id = identity(a, resource);
          const day = kstDay(ms);
          const type = (str(a, "type") ?? "").replace(/[\s-]/g, "").toLowerCase();
          switch (name) {
            case "claude_code.session.count":
              daily.add(day, id, "sessions", value);
              break;
            case "claude_code.cost.usage": {
              daily.add(day, id, "cost_usd", value);
              const mdl = str(a, "model");
              if (mdl) model.add(day, id, mdl, "cost_usd", value);
              break;
            }
            case "claude_code.token.usage": {
              const field = TOKEN_TYPE_FIELD[type];
              if (!field) {
                dropped++;
                break;
              }
              daily.add(day, id, field, value);
              const mdl = str(a, "model");
              if (mdl) model.add(day, id, mdl, field, value);
              break;
            }
            case "claude_code.lines_of_code.count":
              if (type === "added") daily.add(day, id, "loc_added", value);
              else if (type === "removed") daily.add(day, id, "loc_removed", value);
              else dropped++;
              break;
            case "claude_code.code_edit_tool.decision": {
              const d = (str(a, "decision") ?? "").toLowerCase();
              if (d === "accept") daily.add(day, id, "edits_accepted", value);
              else if (d === "reject") daily.add(day, id, "edits_rejected", value);
              else dropped++;
              break;
            }
            case "claude_code.commit.count":
              daily.add(day, id, "commits", value);
              break;
            case "claude_code.pull_request.count":
              daily.add(day, id, "pull_requests", value);
              break;
            case "claude_code.active_time.total":
              if (type === "user") daily.add(day, id, "active_user_seconds", value);
              else if (type === "cli") daily.add(day, id, "active_cli_seconds", value);
              else dropped++;
              break;
            default:
              // 알 수 없는 메트릭은 무시(카운트하지 않음)
              break;
          }
        }
      }
    }
  }
  return { daily: daily.rows(), model: model.rows(), dropped };
}

/**
 * 로그 레코드의 이벤트 이름 후보를 접두어 없는 형태로 정규화한다.
 * Claude Code는 `event.name` 속성에 "claude_code.api_request" 또는 접두어 없는 "api_request"를 넣고,
 * body(stringValue)에도 이름을 넣을 수 있다 — 어느 쪽이든 인식하도록 둘 다 본다.
 */
function eventNames(...raw: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const s = r.trim().replace(/^claude_code\./, "");
    if (s && s.length <= 64 && !/\s/.test(s)) out.add(s);
  }
  return out;
}

export function parseLogsPayload(body: unknown): { requests: ApiRequestEvent[]; promptDaily: DailyRow[]; dropped: number; ignored: Record<string, number> } {
  const requests: ApiRequestEvent[] = [];
  const prompts = new DailyAcc();
  let dropped = 0;
  /** 저장하지 않는 이벤트 이름별 개수(tool_result 등) — 수신은 되는데 저장 0인 상황을 진단하기 위해 돌려준다 */
  const ignored: Record<string, number> = {};
  const rls = (body as { resourceLogs?: unknown })?.resourceLogs;
  if (!Array.isArray(rls)) return { requests: [], promptDaily: [], dropped: 0, ignored: {} };

  for (const rl of rls as { resource?: { attributes?: unknown }; scopeLogs?: unknown }[]) {
    const resource = attrsToRecord(rl?.resource?.attributes);
    if (!Array.isArray(rl?.scopeLogs)) continue;
    for (const sl of rl.scopeLogs as { logRecords?: unknown }[]) {
      if (!Array.isArray(sl?.logRecords)) continue;
      for (const rec of sl.logRecords as { timeUnixNano?: string | number; observedTimeUnixNano?: string | number; body?: AnyValue; attributes?: unknown }[]) {
        const a = attrsToRecord(rec.attributes);
        const names = eventNames(str(a, "event.name"), rec.body?.stringValue);
        const ms = nanoToMs(rec.timeUnixNano) ?? nanoToMs(rec.observedTimeUnixNano);
        if (names.size === 0 || ms === null) {
          dropped++;
          continue;
        }
        const id = identity(a, resource);
        if (names.has("api_request")) {
          requests.push({
            ts: new Date(ms).toISOString(),
            org_id: id.org_id,
            user_email: id.user_email,
            account_uuid: id.account_uuid,
            session_id: id.session_id,
            model: str(a, "model"),
            cost_usd: num(a, "cost_usd") ?? 0,
            input_tokens: num(a, "input_tokens") ?? 0,
            output_tokens: num(a, "output_tokens") ?? 0,
            cache_read_tokens: num(a, "cache_read_tokens") ?? 0,
            cache_creation_tokens: num(a, "cache_creation_tokens") ?? 0,
            duration_ms: num(a, "duration_ms"),
            query_source: str(a, "query_source"),
            request_id: str(a, "request_id"),
          });
        } else if (names.has("user_prompt")) {
          prompts.add(kstDay(ms), id, "prompts", 1);
        } else {
          // 그 외 이벤트(tool_result, tool_decision, assistant_response, api_error)는 저장하지 않고 이름만 센다
          const label = [...names][0];
          ignored[label] = (ignored[label] ?? 0) + 1;
        }
      }
    }
  }
  return { requests, promptDaily: prompts.rows(), dropped, ignored };
}
