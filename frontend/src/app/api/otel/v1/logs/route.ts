import { parseLogsPayload } from "@/lib/claude-usage/otlp";
import { storeLogs } from "@/lib/claude-usage/ingest-store";
import { handleOtlpIngest } from "@/lib/claude-usage/ingest-handler";

export const runtime = "nodejs";

/** OTLP/HTTP JSON 로그(이벤트) 수신 — api_request·user_prompt만 저장 */
export async function POST(req: Request) {
  return handleOtlpIngest(req, {
    signal: "logs",
    parse: (body) => {
      const p = parseLogsPayload(body);
      const ignoredTotal = Object.values(p.ignored).reduce((s, n) => s + n, 0);
      if (p.requests.length === 0 && p.promptDaily.length === 0 && ignoredTotal > 0) {
        console.warn("[claude-usage] logs: api_request/user_prompt 없음, 무시한 이벤트 =", JSON.stringify(p.ignored));
      }
      return p;
    },
    orgIds: (p) => [...p.requests.map((r) => r.org_id), ...p.promptDaily.map((d) => d.org_id)],
    dropped: (p) => p.dropped,
    store: storeLogs,
  });
}
