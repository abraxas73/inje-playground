import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import ChatWorkspace from "@/components/chat/ChatWorkspace";
import { DRAFT_KEY } from "@/lib/chat/view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } }));
function stub(desktop = true) {
  const f = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/chat/config") return json({ enabled: true, models: ["claude-sonnet-5-5", "claude-opus-5-5"], defaultModel: "claude-sonnet-5-5" });
    if (url === "/api/chat/status") return json({ desktop, microsoft: true, atlassian: true });
    if (url === "/api/chat/conversations") return json({ conversations: [] });
    if (url === "/api/chat/turn") return Promise.resolve(new Response("data: {\"type\":\"done\"}\n\n"));
    void init;
    return json({});
  });
  vi.stubGlobal("fetch", f);
  return f;
}
const calls = (f: ReturnType<typeof stub>, u: string) => f.mock.calls.filter((c) => c[0] === u);
Element.prototype.scrollIntoView = vi.fn();
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe("ChatWorkspace", () => {
  it("홈 초안은 한 번만 보내고 초안의 모델을 쓴다", async () => {
    const f = stub();
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text: "안녕", attachments: [], model: "claude-opus-5-5" }));
    render(<ChatWorkspace />);
    await waitFor(() => expect(calls(f, "/api/chat/turn")).toHaveLength(1));
    const body = JSON.parse((calls(f, "/api/chat/turn")[0][1] as RequestInit).body as string);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.text).toBe("안녕");
  });
  it("다시 마운트해도 상태 API는 한 번만 부른다", async () => {
    const f = stub();
    vi.resetModules(); // 모듈 캐시를 첫 테스트와 분리
    const { default: Fresh } = await import("@/components/chat/ChatWorkspace");
    const a = render(<Fresh />);
    await waitFor(() => expect(calls(f, "/api/chat/status")).toHaveLength(1));
    a.unmount();
    render(<Fresh />);
    await waitFor(() => expect(calls(f, "/api/chat/conversations")).toHaveLength(2));
    expect(calls(f, "/api/chat/status")).toHaveLength(1);
    expect(calls(f, "/api/chat/config")).toHaveLength(1);
  });
  it("데스크톱 앱이 꺼져 있으면 상태는 30초만 캐시", async () => {
    const f = stub(false);
    vi.resetModules();
    const { default: Fresh } = await import("@/components/chat/ChatWorkspace");
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const a = render(<Fresh />);
    await waitFor(() => expect(calls(f, "/api/chat/status")).toHaveLength(1));
    a.unmount();
    now += 20_000;
    const b = render(<Fresh />);
    await waitFor(() => expect(calls(f, "/api/chat/conversations")).toHaveLength(2));
    expect(calls(f, "/api/chat/status")).toHaveLength(1);
    b.unmount();
    now += 11_000;
    render(<Fresh />);
    await waitFor(() => expect(calls(f, "/api/chat/status")).toHaveLength(2));
  });
});
