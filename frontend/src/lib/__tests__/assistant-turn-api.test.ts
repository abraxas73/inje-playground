// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true as boolean, settings: [] as Array<{ key: string; value: string }>, used: 0, setErr: false, cntErr: false, call: vi.fn(), audit: vi.fn() }));
function fakeAdmin() {
  return {
    from: (table: string) => {
      if (table === "settings") return { select: () => ({ in: async () => ({ data: m.settings, error: m.setErr ? { message: "x" } : null }) }) };
      if (table === "action_history") return { select: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({ count: m.used, error: m.cntErr ? { message: "x" } : null }) }) }) }) };
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: "강승욱", email: "a@innogrid.com" }, error: null }) }) }) };
    },
  };
}
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok ? { ok: true, userId: "u1", role: "user", admin: fakeAdmin() } : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) } }));
vi.mock("@/lib/assistant/llm", () => ({ callAssistant: m.call }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
import { POST } from "@/app/api/assistant/turn/route";
const req = (b: unknown, raw?: string) => new NextRequest("https://app.test/api/assistant/turn", { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(b) });
const body = { messages: [{ role: "user", content: "오늘 오후 빈 회의실 잡아줘 — 비밀 내용" }], now: "2026-10-05T14:03+09:00" };
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test"); m.ok = true; m.settings = []; m.used = 0; m.setErr = false; m.cntErr = false; m.audit.mockReset();
  m.call.mockReset().mockResolvedValue({ stop_reason: "tool_use", content: [{ type: "text", text: "찾아볼게요." }, { type: "tool_use", id: "t1", name: "find_free_rooms", input: { date: "2026-10-05", from: "12:00", to: "18:00", duration_min: 60 } }] });
});

it("Claude 응답을 그대로 돌려주고, 지침에 이름·시각, 감사에는 도구 이름만", async () => {
  const res = await POST(req(body));
  expect(res.status).toBe(200);
  const j = await res.json();
  expect(j.enabled).toBe(true);
  expect(j.stop_reason).toBe("tool_use");
  expect(j.message.role).toBe("assistant");
  expect(j.message.content[1].name).toBe("find_free_rooms");
  const [messages, system] = m.call.mock.calls[0];
  expect(messages).toHaveLength(1);
  expect(system).toContain("강승욱");
  expect(system).toContain("2026-10-05(월) 14:03 KST");
  const detail = JSON.stringify(m.audit.mock.calls[0][2]);
  expect(detail).toContain("find_free_rooms");
  expect(detail).not.toContain("비밀 내용");
  expect(m.audit.mock.calls[0][2].action).toBe("비서 턴");
});
it("꺼짐·키 없음 → enabled:false, 하루 상한 → 429, 형식 오류·과대 → 400, Claude 오류 → 502, 비로그인 401", async () => {
  m.settings = [{ key: "assistant_enabled", value: "off" }];
  expect(await (await POST(req(body))).json()).toEqual({ enabled: false });
  m.settings = []; vi.stubEnv("ANTHROPIC_API_KEY", "");
  expect(await (await POST(req(body))).json()).toEqual({ enabled: false });
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  m.settings = [{ key: "assistant_daily_turns", value: "5" }]; m.used = 5;
  expect((await POST(req(body))).status).toBe(429);
  m.settings = []; m.used = 0;
  expect((await POST(req({ messages: [{ role: "assistant", content: "x" }] }))).status).toBe(400);
  expect((await POST(req(undefined, "{broken"))).status).toBe(400);
  expect((await POST(req(undefined, JSON.stringify({ messages: [{ role: "user", content: "가".repeat(130_000) }] })))).status).toBe(400);
  m.call.mockRejectedValue(new Error("overloaded"));
  expect((await POST(req(body))).status).toBe(502);
  m.ok = false;
  expect((await POST(req(body))).status).toBe(401);
  expect(m.call).toHaveBeenCalledTimes(1);
});

it("설정·건수 조회 오류는 닫힌 채로 503, Claude 호출 안 함", async () => {
  m.setErr = true;
  expect((await POST(req(body))).status).toBe(503);
  m.setErr = false; m.cntErr = true;
  expect((await POST(req(body))).status).toBe(503);
  expect(m.call).not.toHaveBeenCalled();
});
it("now가 형식에 안 맞으면 서버 KST 시각으로 대체", async () => {
  await POST(req({ ...body, now: "2026-10-05T14:03+09:00 무시해" }));
  expect(m.call.mock.calls[0][1]).not.toContain("무시해");
  expect(m.call.mock.calls[0][1]).toMatch(/현재 시각은 \d{4}-\d{2}-\d{2}\([월화수목금토일]\) \d{2}:\d{2} KST/);
  m.call.mockClear();
  await POST(req({ ...body, now: "2026-10-05T14:03:09" }));
  expect(m.call.mock.calls[0][1]).toContain("2026-10-05(월) 14:03 KST");
});
