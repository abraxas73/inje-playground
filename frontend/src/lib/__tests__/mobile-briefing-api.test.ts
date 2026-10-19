// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
const m = vi.hoisted(() => ({ ok: true as boolean, setting: null as string | null, gen: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok
  ? { ok: true, userId: "u1", role: "user", admin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.setting === null ? null : { value: m.setting }, error: null }) }) }) }) } }
  : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) } }));
vi.mock("@/lib/mobile/briefing-llm", () => ({ generateBriefing: m.gen }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
import { POST } from "@/app/api/mobile/briefing/route";
const body = { date: "2026-10-05 (월) 08:40", name: "강승욱", meetings: [{ time: "10:00–11:00", title: "주간회의" }], tomorrow: 0, absences: [], approvals: [{ title: "휴가 신청 — 비밀 제목", from: "이서연", days: 3, unread: true }], mails: [], mentions: [], notices: [], attendance: null };
const req = (b: unknown = body, raw?: string) => new NextRequest("https://app.test/api/mobile/briefing", { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(b) });
beforeEach(() => { vi.stubEnv("ANTHROPIC_API_KEY", "sk-test"); m.ok = true; m.setting = null; m.gen.mockReset().mockResolvedValue({ text: "오늘 10시 주간회의가 있고 이서연님 결재가 3일째 기다립니다.", model: "claude-sonnet-5-5" }); m.audit.mockReset(); });

it("설정이 없거나 on이면 Claude 문장을 돌려주고 감사에는 건수만 남는다", async () => {
  const res = await POST(req());
  expect(res.status).toBe(200);
  const j = await res.json();
  expect(j).toMatchObject({ enabled: true, text: "오늘 10시 주간회의가 있고 이서연님 결재가 3일째 기다립니다.", model: "claude-sonnet-5-5" });
  expect(j.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(m.gen.mock.calls[0][0].approvals[0].title).toBe("휴가 신청 — 비밀 제목");
  expect(m.audit).toHaveBeenCalledTimes(1);
  const detail = JSON.stringify(m.audit.mock.calls[0][2].detail);
  expect(detail).toContain('"approvals":1');
  expect(detail).not.toContain("비밀 제목");
});
it("설정 off 또는 API 키 없음이면 enabled:false, Claude 호출 없음", async () => {
  m.setting = "off";
  expect(await (await POST(req())).json()).toMatchObject({ enabled: false, code: "briefing_disabled" });
  m.setting = "on"; vi.stubEnv("ANTHROPIC_API_KEY", "");
  expect(await (await POST(req())).json()).toMatchObject({ enabled: false, code: "briefing_configuration" });
  expect(m.gen).not.toHaveBeenCalled();
});
it("본문 16KB 초과·깨진 JSON은 400, 거대 문자열은 잘려서 간다", async () => {
  expect((await POST(req(undefined, "x".repeat(16 * 1024 + 1)))).status).toBe(400);
  expect((await POST(req(undefined, "{broken"))).status).toBe(400);
  await POST(req({ ...body, meetings: [{ time: "t", title: "제".repeat(5000) }] }));
  expect(m.gen.mock.calls[0][0].meetings[0].title).toHaveLength(121);
});
it("Claude 오류는 502, 비로그인은 401", async () => {
  m.gen.mockRejectedValue(new Error("overloaded"));
  expect((await POST(req())).status).toBe(502);
  m.ok = false;
  expect((await POST(req())).status).toBe(401);
});

it.each([
  [400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.", "briefing_usage_limit", "사용 한도", 502],
  [400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.", "briefing_credit_balance", "잔액", 502],
  [429, "rate_limit_error", "Too many requests", "briefing_rate_limit", "요청이 몰려", 429],
  [401, "authentication_error", "invalid x-api-key sk-secret", "briefing_configuration", "관리자", 503],
  [403, "permission_error", "not allowed", "briefing_configuration", "관리자", 503],
  [529, "overloaded_error", "Overloaded", "briefing_unavailable", "잠시 후", 502],
  [400, "invalid_request_error", "bad input private title", "briefing_unavailable", "잠시 후", 502],
] as const)("공급자 오류 %s/%s를 안전한 원인과 조치로 전달한다", async (status, type, message, code, hint, expectedStatus) => {
  m.gen.mockRejectedValue(Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers()));
  const res = await POST(req());
  expect(res.status).toBe(expectedStatus);
  const j = await res.json();
  expect(j.code).toBe(code);
  expect(j.error).toContain(hint);
  expect(JSON.stringify(j)).not.toContain(message);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
});
