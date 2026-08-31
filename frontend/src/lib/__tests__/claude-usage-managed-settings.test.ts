import { describe, it, expect } from "vitest";
import { buildManagedSettings } from "@/lib/claude-usage/managed-settings";

describe("buildManagedSettings", () => {
  it("엔드포인트 끝 슬래시를 정리하고 http/json·delta 기본값을 넣는다", () => {
    const s = buildManagedSettings("https://inje-playground.vercel.app/", "tok");
    expect(s.env).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://inje-playground.vercel.app/api/otel",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer tok",
      OTEL_METRIC_EXPORT_INTERVAL: "300000",
      OTEL_LOGS_EXPORT_INTERVAL: "60000",
      OTEL_LOG_USER_PROMPTS: "1",
      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: "delta",
      OTEL_METRICS_INCLUDE_SESSION_ID: "false",
      OTEL_METRICS_INCLUDE_ACCOUNT_UUID: "true",
    });
  });
  it("토큰 생략 시 자리표시자", () => {
    expect(buildManagedSettings("https://x.test").env.OTEL_EXPORTER_OTLP_HEADERS).toBe("Authorization=Bearer <CLAUDE_OTEL_INGEST_TOKEN>");
  });
});
