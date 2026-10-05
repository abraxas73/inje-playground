import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamsReplyCard from "@/components/home/TeamsReplyCard";
import { homeGreeting, initialChatId } from "@/lib/home";

const role = vi.hoisted(() => ({ userId: "A" as string | null, allowed: true }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ userId: role.userId, canAccessPage: () => role.allowed }) }));
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const mention = (text: string, chatId = "19:chat+id@thread.v2") => ({ id: text, chatId, from: "동료", topic: "프로젝트", text, at: "2026-10-06T00:00:00Z", type: "group", webUrl: null });
const fetchMock = vi.fn();
beforeEach(() => { role.userId = "A"; role.allowed = true; vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("home from mobile", () => {
  it("uses KST date at midnight and morning greeting independently of host timezone", () => {
    expect(homeGreeting(new Date("2026-10-05T23:00:00Z"))).toMatchObject({ title: "좋은 아침이에요", date: "10월 6일 화요일" });
    expect(homeGreeting(new Date("2026-10-05T14:59:59Z")).date).toBe("10월 5일 월요일");
    expect(homeGreeting(new Date("2026-10-05T15:00:00Z")).date).toBe("10월 6일 화요일");
    expect(homeGreeting(new Date("2026-10-05T15:00:00Z")).quote).toBe(homeGreeting(new Date("2026-10-06T14:59:59Z")).quote);
  });
  it("honors a linked chat only if it is in this user's chat list", () => {
    expect(initialChatId(["a", "b"], "b", "a")).toBe("b");
    expect(initialChatId(["a"], "other-user-chat", "a")).toBe("a");
    expect(initialChatId(["a"], "other-user-chat", "old-user-chat")).toBeNull();
  });
  it("does not request private messages without permission or a user", () => {
    role.allowed = false;
    const view = render(<TeamsReplyCard />);
    expect(fetchMock).not.toHaveBeenCalled();
    role.allowed = true; role.userId = null;
    view.rerender(<TeamsReplyCard />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shows messages as text and links to the exact conversation", async () => {
    fetchMock.mockResolvedValue(response({ connected: true, items: [mention("<script>hello</script>")] }));
    render(<TeamsReplyCard />);
    const link = await screen.findByRole("link", { name: /<script>hello/ });
    expect(link).toHaveAttribute("href", "/teams/chat?chat=19%3Achat%2Bid%40thread.v2");
    expect(document.querySelector("script")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/teams/mentions?days=2", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });
  it("discards an earlier account's late response", async () => {
    let resolveA!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    fetchMock.mockResolvedValueOnce(response({ connected: true, items: [mention("B의 메시지")] }));
    const view = render(<TeamsReplyCard />);
    const signalA = fetchMock.mock.calls[0][1].signal;
    role.userId = "B";
    view.rerender(<TeamsReplyCard />);
    expect(signalA.aborted).toBe(true);
    await screen.findByText("B의 메시지");
    await act(async () => { resolveA(response({ connected: true, items: [mention("A의 비공개 메시지")] })); });
    await waitFor(() => expect(screen.queryByText("A의 비공개 메시지")).not.toBeInTheDocument());
    expect(screen.getByText("B의 메시지")).toBeInTheDocument();
  });
  it("clears visible messages when page access is removed", async () => {
    fetchMock.mockResolvedValue(response({ connected: true, items: [mention("비공개 메시지")] }));
    const view = render(<TeamsReplyCard />);
    await screen.findByText("비공개 메시지");
    role.allowed = false; view.rerender(<TeamsReplyCard />);
    expect(screen.queryByText("비공개 메시지")).not.toBeInTheDocument();
  });
  it.each([200, 409])("offers connection setup for disconnected/reconnect (%s)", async (status) => {
    fetchMock.mockResolvedValue(response({ connected: false, code: "reconnect" }, status));
    render(<TeamsReplyCard />);
    expect(await screen.findByRole("link", { name: "연결 설정 열기" })).toHaveAttribute("href", "/settings");
  });
  it("keeps failure separate from an empty list and permits retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response({ connected: true, items: [] }));
    render(<TeamsReplyCard />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("조회한 대화에서 답장 대기 항목이 없습니다.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
