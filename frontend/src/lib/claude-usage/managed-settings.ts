/** claude.ai Admin Settings > Claude Code > Managed settings 에 붙일 env 블록 */
export function buildManagedSettings(endpointBase: string, token = "<CLAUDE_OTEL_INGEST_TOKEN>"): { env: Record<string, string> } {
  const base = endpointBase.replace(/\/+$/, "");
  return {
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_ENDPOINT: `${base}/api/otel`,
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
      OTEL_METRIC_EXPORT_INTERVAL: "300000",
      OTEL_LOGS_EXPORT_INTERVAL: "60000",
      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: "delta",
      OTEL_METRICS_INCLUDE_SESSION_ID: "false",
      OTEL_METRICS_INCLUDE_ACCOUNT_UUID: "true",
    },
  };
}
