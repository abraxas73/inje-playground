// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true, role: "user" as "user" | "admin", settings: [] as Array<{ key: string; value: string }>, perms: null as unknown, used: 0 as number | null, run: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => (m.ok ? { ok: true, userId: "u1", role: m.role, admin: {
  from: (t: string) => t === "settings" ? { select: () => ({ in: async () => ({ data: m.settings, error: null }) }) }
    : t === "user_page_access" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.perms ? { permissions: m.perms } : null, error: null }) }) }) }
    : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: "강", email: "a@innogrid.com" }, error: null }) }) }) },
} } : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) }) }));
vi.mock("@/lib/chat/usage", () => ({ turnsToday: async () => m.used, recordUsage: vi.fn() }));
vi.mock("@/lib/chat/engine", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/engine")>()), runTurn: m.run }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
import { POST } from "@/app/api/chat/turn/route";
const req = (b: unknown) => new NextRequest("https://app.test/api/chat/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test"); m.ok = true; m.role = "user"; m.settings = []; m.perms = null; m.used = 0;
  m.run.mockReset().mockImplementation(async (_d, inp, emit) => { emit({ type: "conversation", id: "c1" }); emit({ type: "text", delta: inp.model }); emit({ type: "done", messageId: "m1" }); });
});

it("SSE로 엔진 이벤트를 흘리고, 허용 밖 모델은 Sonnet으로", async () => {
  const res = await POST(req({ text: "안녕", model: "gpt-x" }));
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = await res.text();
  expect(body).toContain('data: {"type":"conversation","id":"c1"}');
  expect(body).toContain('"delta":"claude-sonnet-5-5"');
  expect(m.run.mock.calls[0][1]).toMatchObject({ userId: "u1", name: "강", client: "web", text: "안녕" });
});
it("관리자가 Opus를 빼면 Opus 요청도 Sonnet", async () => {
  m.settings = [{ key: "assistant_models", value: "claude-sonnet-5-5" }];
  await (await POST(req({ text: "a", model: "claude-opus-5-5" }))).text();
  expect(m.run.mock.calls[0][1].model).toBe("claude-sonnet-5-5");
});
it("꺼짐 403, 권한 없음 403, 상한 429, 사용량 오류 503, 형식 400, 비로그인 401 — 엔진을 부르지 않는다", async () => {
  m.settings = [{ key: "assistant_enabled", value: "off" }];
  const off = await POST(req({ text: "a" }));
  expect(off.status).toBe(403);
  expect((await off.json()).code).toBe("assistant_disabled");
  m.settings = []; m.perms = { assistant: false };
  expect((await POST(req({ text: "a" }))).status).toBe(403);
  m.perms = null; m.settings = [{ key: "assistant_daily_turns", value: "3" }]; m.used = 3;
  expect((await POST(req({ text: "a" }))).status).toBe(429);
  m.used = null;
  expect((await POST(req({ text: "a" }))).status).toBe(503);
  m.used = 0; m.settings = [];
  expect((await POST(req({}))).status).toBe(400);
  m.ok = false;
  expect((await POST(req({ text: "a" }))).status).toBe(401);
  expect(m.run).not.toHaveBeenCalled();
});
it("엔진의 입력 오류는 error 이벤트(retryable:false)", async () => {
  const { TurnInputError } = await import("@/lib/chat/engine");
  m.run.mockRejectedValueOnce(new TurnInputError("대화를 찾지 못했습니다."));
  const body = await (await POST(req({ text: "a", conversationId: "00000000-0000-0000-0000-000000000001" }))).text();
  expect(body).toContain('"type":"error","message":"대화를 찾지 못했습니다.","retryable":false');
});
