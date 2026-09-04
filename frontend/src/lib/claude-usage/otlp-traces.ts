/**
 * Claude for M365(Excel·Word·PowerPoint·Outlook) 추가 기능이 커스텀 수집기로 보내는 OTLP/HTTP JSON 트레이스 파서.
 * 스팬에는 프롬프트 원문(user.message)·도구 입출력(tool.input/output)·문서 URL(document.url)이 그대로 실려 오므로
 * 여기서는 **집계에 필요한 속성만** 뽑고 내용 속성은 읽지도 저장하지도 않는다(수신 즉시 폐기).
 * 스팬 구조: agent.query(턴, surface·user.email) ← agent.stream(모델 호출, 토큰) ← agent.tool_execution(도구), agent.compaction, file.upload.
 */

export interface OfficeSpanRow {
  span_name: string;
  trace_id: string | null;
  span_start: string | null; // ISO
  surface: string | null; // sheet | doc | slide | mail
  user_email: string | null;
  org_id: string | null;
  session_id: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  tool_name: string | null;
  tool_success: boolean | null;
  office_platform: string | null;
  attr_keys: string[]; // 어떤 속성이 왔는지(키만) — 스키마 학습용
}

type AnyValue = { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean };
type KeyValue = { key: string; value?: AnyValue };

/** 저장을 허용하는 속성(값까지 읽는 것). 나머지는 키 이름만 남긴다 */
const ALLOWED_VALUE_KEYS = new Set([
  "agent.surface", "agent.vendor", "user.email", "organization.id", "session.id", "model", "agent.selected_model",
  "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "tool_name", "tool.success", "office.platform",
]);

function readAttrs(list: KeyValue[] | undefined): { get: (k: string) => string | number | boolean | null; keys: string[] } {
  const map = new Map<string, string | number | boolean>();
  const keys: string[] = [];
  for (const kv of list ?? []) {
    if (!kv?.key) continue;
    keys.push(kv.key);
    if (!ALLOWED_VALUE_KEYS.has(kv.key)) continue; // 내용 속성은 값을 읽지 않는다
    const v = kv.value ?? {};
    if (v.stringValue !== undefined) map.set(kv.key, v.stringValue);
    else if (v.intValue !== undefined) map.set(kv.key, Number(v.intValue));
    else if (v.doubleValue !== undefined) map.set(kv.key, v.doubleValue);
    else if (v.boolValue !== undefined) map.set(kv.key, v.boolValue);
  }
  return { get: (k) => map.get(k) ?? null, keys };
}

const str = (v: string | number | boolean | null): string | null => (v === null ? null : String(v));
const num = (v: string | number | boolean | null): number => (typeof v === "number" ? v : Number(v) || 0);

function nanoToIso(n: string | number | undefined): string | null {
  if (n === undefined || n === null) return null;
  const ms = Number(BigInt(String(n)) / BigInt(1_000_000));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

export function parseTracesPayload(body: unknown): { rows: OfficeSpanRow[]; spans: number; serviceNames: string[] } {
  const rows: OfficeSpanRow[] = [];
  const serviceNames = new Set<string>();
  let spans = 0;
  const rs = (body as { resourceSpans?: unknown[] })?.resourceSpans ?? [];
  for (const r of rs as { resource?: { attributes?: KeyValue[] }; scopeSpans?: { spans?: Record<string, unknown>[] }[] }[]) {
    const res = readAttrs(r.resource?.attributes);
    for (const kv of r.resource?.attributes ?? []) if (kv.key === "service.name" && kv.value?.stringValue) serviceNames.add(kv.value.stringValue);
    for (const ss of r.scopeSpans ?? []) {
      for (const sp of ss.spans ?? []) {
        spans += 1;
        const a = readAttrs(sp.attributes as KeyValue[] | undefined);
        const toolSuccess = a.get("tool.success");
        rows.push({
          span_name: String(sp.name ?? "unknown"),
          trace_id: typeof sp.traceId === "string" ? sp.traceId : null,
          span_start: nanoToIso(sp.startTimeUnixNano as string | number | undefined),
          surface: str(a.get("agent.surface")),
          user_email: str(a.get("user.email"))?.toLowerCase() ?? null,
          org_id: str(a.get("organization.id")),
          session_id: str(a.get("session.id")),
          model: str(a.get("model") ?? a.get("agent.selected_model")),
          input_tokens: num(a.get("input_tokens")),
          output_tokens: num(a.get("output_tokens")),
          cache_read_tokens: num(a.get("cache_read_tokens")),
          cache_creation_tokens: num(a.get("cache_creation_tokens")),
          tool_name: str(a.get("tool_name")),
          tool_success: typeof toolSuccess === "boolean" ? toolSuccess : null,
          office_platform: str(a.get("office.platform")) ?? str(res.get("office.platform")),
          attr_keys: [...new Set([...a.keys])].sort(),
        });
      }
    }
  }
  return { rows, spans, serviceNames: [...serviceNames] };
}
