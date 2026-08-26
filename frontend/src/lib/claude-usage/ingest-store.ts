import type { SupabaseClient } from "@supabase/supabase-js";
import type { parseLogsPayload, parseMetricsPayload } from "@/lib/claude-usage/otlp";

type MetricsParsed = ReturnType<typeof parseMetricsPayload>;
type LogsParsed = ReturnType<typeof parseLogsPayload>;

/** 메트릭 → RPC claude_code_ingest (delta 합산). 행 0개면 호출하지 않음. */
export async function storeMetrics(admin: SupabaseClient, parsed: MetricsParsed): Promise<{ rows: number }> {
  if (parsed.daily.length === 0 && parsed.model.length === 0) return { rows: 0 };
  const { error } = await admin.rpc("claude_code_ingest", { p_daily: parsed.daily, p_model: parsed.model });
  if (error) throw new Error(`claude_code_ingest: ${error.message}`);
  return { rows: parsed.daily.length + parsed.model.length };
}

/** 로그 → api_request 이벤트 insert + user_prompt 카운트 RPC */
export async function storeLogs(admin: SupabaseClient, parsed: LogsParsed): Promise<{ rows: number }> {
  let rows = 0;
  if (parsed.requests.length > 0) {
    for (let i = 0; i < parsed.requests.length; i += 500) {
      const chunk = parsed.requests.slice(i, i + 500);
      // TODO(migration 2): switch to upsert onConflict request_id ignoreDuplicates once claude_code_requests_request_id_uidx exists
      const { error } = await admin.from("claude_code_requests").insert(chunk);
      if (error) throw new Error(`claude_code_requests insert: ${error.message}`);
      rows += chunk.length;
    }
  }
  if (parsed.promptDaily.length > 0) {
    const { error } = await admin.rpc("claude_code_ingest", { p_daily: parsed.promptDaily, p_model: [] });
    if (error) throw new Error(`claude_code_ingest(prompts): ${error.message}`);
    rows += parsed.promptDaily.length;
  }
  return { rows };
}

export async function logIngest(
  admin: SupabaseClient,
  entry: { signal: "metrics" | "logs"; org_ids: string[]; rows: number; dropped: number; bytes: number; ok: boolean; error?: string }
): Promise<void> {
  const { error } = await admin.from("claude_ingest_log").insert({
    signal: entry.signal,
    org_ids: [...new Set(entry.org_ids)],
    rows: entry.rows,
    dropped: entry.dropped,
    bytes: entry.bytes,
    ok: entry.ok,
    error: entry.error ? entry.error.slice(0, 500) : null,
  });
  if (error) console.error("[claude-usage] ingest log failed:", error.message);
}
