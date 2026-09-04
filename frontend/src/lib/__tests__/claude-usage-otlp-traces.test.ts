import { describe, expect, it } from "vitest";
import { parseTracesPayload } from "@/lib/claude-usage/otlp-traces";

const kv = (key: string, value: Record<string, unknown>) => ({ key, value });
const payload = {
  resourceSpans: [{
    resource: { attributes: [kv("service.name", { stringValue: "office-agent" }), kv("service.version", { stringValue: "1.0.0" })] },
    scopeSpans: [{
      scope: { name: "office-agent" },
      spans: [
        {
          traceId: "t1", spanId: "s1", name: "agent.query", startTimeUnixNano: "1788486000000000000",
          attributes: [
            kv("agent.surface", { stringValue: "sheet" }), kv("agent.vendor", { stringValue: "m" }),
            kv("user.email", { stringValue: "Someone@Innogrid.com" }), kv("organization.id", { stringValue: "org-1" }),
            kv("session.id", { stringValue: "sess-1" }), kv("office.platform", { stringValue: "Mac" }),
            kv("user.message", { stringValue: "회사 기밀 프롬프트" }), kv("document.url", { stringValue: "https://sharepoint/secret.xlsx" }),
            kv("agent.selected_model", { stringValue: "claude-opus-5" }),
          ],
        },
        {
          traceId: "t1", spanId: "s2", parentSpanId: "s1", name: "agent.stream", startTimeUnixNano: "1788486001000000000",
          attributes: [
            kv("model", { stringValue: "claude-opus-5" }), kv("input_tokens", { intValue: "1200" }), kv("output_tokens", { intValue: 340 }),
            kv("cache_read_tokens", { intValue: "9000" }), kv("stop_reason", { stringValue: "end_turn" }),
          ],
        },
        {
          traceId: "t1", spanId: "s3", parentSpanId: "s2", name: "agent.tool_execution",
          attributes: [kv("tool_name", { stringValue: "execute_office_js" }), kv("tool.success", { boolValue: true }), kv("tool.input", { stringValue: "=SUM(secret)" })],
        },
      ],
    }],
  }],
};

describe("parseTracesPayload", () => {
  it("스팬별 집계 속성만 뽑고 내용 속성(user.message·document.url·tool.input)은 값을 남기지 않는다", () => {
    const { rows, spans, serviceNames } = parseTracesPayload(payload);
    expect(spans).toBe(3);
    expect(serviceNames).toEqual(["office-agent"]);
    const q = rows.find((r) => r.span_name === "agent.query")!;
    expect(q).toMatchObject({ surface: "sheet", user_email: "someone@innogrid.com", org_id: "org-1", session_id: "sess-1", model: "claude-opus-5", office_platform: "Mac" });
    expect(q.span_start).toBe("2026-09-04T01:40:00.000Z");
    expect(q.attr_keys).toContain("user.message"); // 키 이름만
    expect(JSON.stringify(rows)).not.toContain("기밀");
    expect(JSON.stringify(rows)).not.toContain("sharepoint");
    expect(JSON.stringify(rows)).not.toContain("SUM(");
    const s = rows.find((r) => r.span_name === "agent.stream")!;
    expect(s).toMatchObject({ model: "claude-opus-5", input_tokens: 1200, output_tokens: 340, cache_read_tokens: 9000, cache_creation_tokens: 0 });
    const t = rows.find((r) => r.span_name === "agent.tool_execution")!;
    expect(t).toMatchObject({ tool_name: "execute_office_js", tool_success: true });
  });

  it("빈 페이로드는 빈 결과", () => {
    expect(parseTracesPayload({})).toEqual({ rows: [], spans: 0, serviceNames: [] });
    expect(parseTracesPayload(null)).toEqual({ rows: [], spans: 0, serviceNames: [] });
  });
});
