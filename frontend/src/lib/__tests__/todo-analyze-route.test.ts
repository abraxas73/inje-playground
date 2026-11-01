import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const analyze = vi.fn();
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => ({ ok: true, userId: "u1", role: "user", admin: { rpc, from: () => ({ insert: async () => ({ error: null }) }) } }) }));
vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/todo/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/todo/ai")>()), todoAiEnabled: () => true, analyzeTodo: (...a: unknown[]) => analyze(...a) }));

const post = async (text: string) => {
  const { POST } = await import("@/app/api/todo/analyze/route");
  return POST(new Request("http://x/api/todo/analyze", { method: "POST", body: JSON.stringify({ text }) }) as never);
};

describe("POST /api/todo/analyze 하루 상한", () => {
  beforeEach(() => { rpc.mockReset(); analyze.mockReset(); analyze.mockResolvedValue({ title: "a" }); });

  it("모델 전에 한 칸을 예약한다 — 예약되면 분석", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const r = await post("보고서");
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("todo_ai_reserve", expect.objectContaining({ p_user: "u1", p_limit: 50 }));
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(analyze.mock.invocationCallOrder[0]);
  });

  it("상한이면(null) 429, 예약 실패면 503 — 둘 다 모델을 부르지 않는다", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await post("보고서")).status).toBe(429);
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await post("보고서")).status).toBe(503);
    expect(analyze).not.toHaveBeenCalled();
  });
});
