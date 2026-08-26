import { describe, it, expect } from "vitest";
import { parseMetricsPayload, parseLogsPayload, kstDay, nanoToMs } from "@/lib/claude-usage/otlp";

const RES = { attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }] };
const ID = [
  { key: "user.email", value: { stringValue: "Dev1@Example.com" } },
  { key: "user.account_uuid", value: { stringValue: "acc-1" } },
  { key: "organization.id", value: { stringValue: "org-a" } },
  { key: "session.id", value: { stringValue: "s1" } },
];
// 2026-08-25T15:30:00Z = 2026-08-26 00:30 KST
const T = "1787671800000000000";
const point = (v: number, extra: { key: string; value: { stringValue: string } }[] = []) => ({
  attributes: [...ID, ...extra],
  timeUnixNano: T,
  asDouble: v,
});
const sum = (name: string, dataPoints: unknown[], temporality: number | string = 1) => ({
  name,
  sum: { dataPoints, aggregationTemporality: temporality, isMonotonic: true },
});
const metricsBody = (metrics: unknown[]) => ({ resourceMetrics: [{ resource: RES, scopeMetrics: [{ metrics }] }] });

describe("kstDay / nanoToMs", () => {
  it("나노초 문자열을 ms로, UTC 15:30을 KST 다음날로", () => {
    expect(nanoToMs(T)).toBe(1787671800000);
    expect(nanoToMs(undefined)).toBeNull();
    expect(kstDay(1787671800000)).toBe("2026-08-26");
  });
});

describe("parseMetricsPayload", () => {
  it("메트릭을 사용자·일 단위로 합산하고 모델별 행을 만든다", () => {
    const body = metricsBody([
      sum("claude_code.session.count", [point(1)]),
      sum("claude_code.cost.usage", [
        point(0.5, [{ key: "model", value: { stringValue: "claude-opus-5" } }]),
        point(0.25, [{ key: "model", value: { stringValue: "claude-opus-5" } }]),
      ]),
      sum("claude_code.token.usage", [
        point(100, [{ key: "type", value: { stringValue: "input" } }, { key: "model", value: { stringValue: "claude-opus-5" } }]),
        point(40, [{ key: "type", value: { stringValue: "output" } }, { key: "model", value: { stringValue: "claude-opus-5" } }]),
        point(7, [{ key: "type", value: { stringValue: "cacheRead" } }, { key: "model", value: { stringValue: "claude-opus-5" } }]),
        point(3, [{ key: "type", value: { stringValue: "cacheCreation" } }, { key: "model", value: { stringValue: "claude-opus-5" } }]),
      ]),
      sum("claude_code.lines_of_code.count", [
        point(30, [{ key: "type", value: { stringValue: "added" } }]),
        point(5, [{ key: "type", value: { stringValue: "removed" } }]),
      ]),
      sum("claude_code.code_edit_tool.decision", [
        point(4, [{ key: "decision", value: { stringValue: "accept" } }]),
        point(1, [{ key: "decision", value: { stringValue: "reject" } }]),
      ]),
      sum("claude_code.commit.count", [point(2)]),
      sum("claude_code.pull_request.count", [point(1)]),
      sum("claude_code.active_time.total", [
        point(120, [{ key: "type", value: { stringValue: "user" } }]),
        point(30, [{ key: "type", value: { stringValue: "cli" } }]),
      ]),
    ]);
    const r = parseMetricsPayload(body);
    expect(r.dropped).toBe(0);
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0]).toMatchObject({
      day: "2026-08-26", org_id: "org-a", user_email: "dev1@example.com", account_uuid: "acc-1",
      sessions: 1, cost_usd: 0.75, input_tokens: 100, output_tokens: 40, cache_read_tokens: 7, cache_creation_tokens: 3,
      loc_added: 30, loc_removed: 5, edits_accepted: 4, edits_rejected: 1, commits: 2, pull_requests: 1,
      active_user_seconds: 120, active_cli_seconds: 30, prompts: 0,
    });
    expect(r.model).toEqual([
      { day: "2026-08-26", org_id: "org-a", user_email: "dev1@example.com", model: "claude-opus-5",
        cost_usd: 0.75, input_tokens: 100, output_tokens: 40, cache_read_tokens: 7, cache_creation_tokens: 3 },
    ]);
  });

  it("asInt 문자열 값, 이메일 없음(uuid 폴백), 조직 없음(unknown), 리소스 속성 폴백을 처리한다", () => {
    const body = {
      resourceMetrics: [{
        resource: { attributes: [{ key: "user.email", value: { stringValue: "res@example.com" } }] },
        scopeMetrics: [{ metrics: [
          { name: "claude_code.session.count", sum: { aggregationTemporality: 1, dataPoints: [
            { attributes: [], timeUnixNano: T, asInt: "3" },
          ] } },
          { name: "claude_code.session.count", sum: { aggregationTemporality: 1, dataPoints: [
            { attributes: [{ key: "user.account_uuid", value: { stringValue: "acc-9" } }, { key: "organization.id", value: { stringValue: "org-b" } }],
              timeUnixNano: T, asInt: 2 },
          ] } },
        ] }],
      }],
    };
    const r = parseMetricsPayload(body);
    expect(r.daily).toHaveLength(2);
    const byOrg = Object.fromEntries(r.daily.map((d) => [d.org_id, d]));
    // 데이터포인트에 이메일이 없으면 리소스 속성의 이메일이 우선하고, account_uuid 폴백은 이메일이 아예 없을 때만 쓰인다
    expect(byOrg["unknown"]).toMatchObject({ user_email: "res@example.com", account_uuid: null, sessions: 3 });
    expect(byOrg["org-b"]).toMatchObject({ user_email: "res@example.com", account_uuid: "acc-9", sessions: 2 });
  });

  it("CUMULATIVE 메트릭은 버리고 dropped를 센다", () => {
    const r = parseMetricsPayload(metricsBody([
      sum("claude_code.session.count", [point(1)], 2),
      sum("claude_code.session.count", [point(1)], "AGGREGATION_TEMPORALITY_CUMULATIVE"),
      sum("claude_code.session.count", [point(1)], "AGGREGATION_TEMPORALITY_DELTA"),
    ]));
    expect(r.dropped).toBe(2);
    expect(r.daily[0].sessions).toBe(1);
  });

  it("형식이 아니면 빈 결과", () => {
    expect(parseMetricsPayload(null)).toEqual({ daily: [], model: [], dropped: 0 });
    expect(parseMetricsPayload({ resourceMetrics: "x" })).toEqual({ daily: [], model: [], dropped: 0 });
  });
});

describe("parseLogsPayload", () => {
  const log = (name: string, attrs: Record<string, string | number>, viaBody = false) => ({
    timeUnixNano: T,
    body: viaBody ? { stringValue: name } : undefined,
    attributes: [
      ...(viaBody ? [] : [{ key: "event.name", value: { stringValue: name } }]),
      ...ID,
      ...Object.entries(attrs).map(([k, v]) => [k, typeof v === "number" ? { key: k, value: { doubleValue: v } } : { key: k, value: { stringValue: v } }][1]),
    ],
  });
  const logsBody = (records: unknown[]) => ({ resourceLogs: [{ resource: RES, scopeLogs: [{ logRecords: records }] }] });

  it("api_request 이벤트를 추출하고 user_prompt는 일별 prompts로 센다", () => {
    const r = parseLogsPayload(logsBody([
      log("claude_code.api_request", { model: "claude-opus-5", cost_usd: 0.12, input_tokens: 10, output_tokens: 5, cache_read_tokens: 1, cache_creation_tokens: 0, duration_ms: 900, query_source: "main", request_id: "req-1" }),
      log("claude_code.api_request", { model: "claude-sonnet-5", cost_usd: "0.01", input_tokens: "3", output_tokens: "2" }, true),
      log("claude_code.user_prompt", { prompt_length: 20 }),
      log("claude_code.user_prompt", { prompt_length: 5 }),
      log("claude_code.tool_result", { tool_name: "Edit" }),
    ]));
    expect(r.requests).toHaveLength(2);
    expect(r.requests[0]).toMatchObject({
      ts: "2026-08-25T15:30:00.000Z", org_id: "org-a", user_email: "dev1@example.com", account_uuid: "acc-1", session_id: "s1",
      model: "claude-opus-5", cost_usd: 0.12, input_tokens: 10, output_tokens: 5, cache_read_tokens: 1, cache_creation_tokens: 0,
      duration_ms: 900, query_source: "main", request_id: "req-1",
    });
    expect(r.requests[1]).toMatchObject({ model: "claude-sonnet-5", cost_usd: 0.01, input_tokens: 3, output_tokens: 2, duration_ms: null, request_id: null });
    expect(r.promptDaily).toEqual([
      expect.objectContaining({ day: "2026-08-26", org_id: "org-a", user_email: "dev1@example.com", prompts: 2, sessions: 0 }),
    ]);
    expect(r.dropped).toBe(0);
  });

  it("형식이 아니면 빈 결과", () => {
    expect(parseLogsPayload({})).toEqual({ requests: [], promptDaily: [], dropped: 0 });
  });
});
