import { parseLogsPayload } from "@/lib/claude-usage/otlp";
import { storeLogs } from "@/lib/claude-usage/ingest-store";
import { handleOtlpIngest } from "@/lib/claude-usage/ingest-handler";

export const runtime = "nodejs";

/** OTLP/HTTP JSON 로그(이벤트) 수신 — api_request·user_prompt만 저장 */
export async function POST(req: Request) {
  return handleOtlpIngest(req, {
    signal: "logs",
    parse: parseLogsPayload,
    orgIds: (p) => [...p.requests.map((r) => r.org_id), ...p.promptDaily.map((d) => d.org_id)],
    dropped: (p) => p.dropped,
    store: storeLogs,
  });
}
