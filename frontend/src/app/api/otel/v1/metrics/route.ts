import { parseMetricsPayload } from "@/lib/claude-usage/otlp";
import { storeMetrics } from "@/lib/claude-usage/ingest-store";
import { handleOtlpIngest } from "@/lib/claude-usage/ingest-handler";

export const runtime = "nodejs";

/** OTLP/HTTP JSON 메트릭 수신 — Claude Code 관리형 설정의 OTEL_EXPORTER_OTLP_ENDPOINT + /v1/metrics */
export async function POST(req: Request) {
  return handleOtlpIngest(req, {
    signal: "metrics",
    parse: parseMetricsPayload,
    orgIds: (p) => p.daily.map((d) => d.org_id),
    dropped: (p) => p.dropped,
    store: storeMetrics,
  });
}
