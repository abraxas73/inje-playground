// @vitest-environment node
import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ relay: vi.fn(), ms: vi.fn(), jira: null as unknown }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => ({ ok: true, userId: "u1", role: "user", admin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.jira, error: null }) }) }) }) } }) }));
vi.mock("@/lib/mcp/relay", () => ({ relayToolCall: m.relay }));
vi.mock("@/lib/ms/connections", () => ({ getConnectionStatus: m.ms }));
import { GET } from "@/app/api/chat/status/route";

it("앱 응답·Microsoft·Atlassian 연결을 각각 본다", async () => {
  m.relay.mockResolvedValue({ content: [{ type: "text", text: "{}" }] }); m.ms.mockResolvedValue({ connected: true }); m.jira = { user_id: "u1" };
  expect(await (await GET()).json()).toEqual({ desktop: true, microsoft: true, atlassian: true });
  expect(m.relay).toHaveBeenCalledWith(expect.anything(), "u1", "whoami", {});
  m.relay.mockResolvedValue({ content: [{ type: "text", text: "실행 중이 아닙니다" }], isError: true }); m.ms.mockRejectedValue(new Error("db")); m.jira = null;
  expect(await (await GET()).json()).toEqual({ desktop: false, microsoft: false, atlassian: false });
});
