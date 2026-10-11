import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DoorayAccountCard from "@/components/settings/DoorayAccountCard";
import DoorayPage from "@/app/dooray/page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (data: unknown) => ({ ok: true, json: async () => data });
const overview = (subject = "팀 회의") => ({ connected: true, site: "https://example.dooray.com", events: { items: [{ id: "e1", calendarId: "c1", subject, startedAt: "2026-10-11T01:00:00Z", endedAt: "2026-10-11T02:00:00Z", wholeDayFlag: false }] }, mail: { items: [], error: "메일 조회 실패" }, channels: { items: [{ id: "c1", title: "우리 팀" }] } });

describe("Dooray settings and overview", () => {
  it("opens the original mail and renders a safe, clearly limited preview", async () => {
    const data = { ...overview(), mail: { items: [{ id: "123", subject: "메일 제목", from: "보낸 사람", sentAt: "2026-10-11T01:00:00Z", preview: "<script>unsafe</script>" }] } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(data)));
    const { container } = render(<DoorayPage />);
    expect(await screen.findByRole("link", { name: "메일 제목" })).toHaveAttribute("href", "https://example.dooray.com/mail/systems/inbox/123");
    expect(screen.getByText(/앞부분 최대 200자/)).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
  });
  it("renders large channel lists in batches while searching all channels", async () => {
    const data = overview();
    data.channels.items = Array.from({ length: 847 }, (_, i) => ({ id: String(i), title: `방-${i}` }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(data)));
    render(<DoorayPage />);
    expect(await screen.findByText("방-49")).toBeTruthy();
    expect(screen.queryByText("방-50")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "대화방 더 보기" }));
    expect(screen.getByText("방-50")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "대화방 검색" }), { target: { value: "방-846" } });
    expect(screen.getByText("방-846")).toBeTruthy();
    expect(screen.queryByText("방-49")).toBeNull();
  });
  it("hides token entry until administrator configuration is ready", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ configured: false, connected: false })));
    render(<DoorayAccountCard />);
    expect(await screen.findByText(/회사 Dooray 연동 설정을 준비 중/)).toBeTruthy();
    expect(screen.queryByLabelText("개인 API 토큰")).toBeNull();
  });
  it("saves a trimmed token and clears the password field", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ configured: true, connected: false })).mockResolvedValueOnce(response({ connected: true })).mockResolvedValueOnce(response({ configured: true, connected: true, accountName: "테스터" }));
    vi.stubGlobal("fetch", fetch);
    render(<DoorayAccountCard />);
    const input = await screen.findByLabelText("개인 API 토큰");
    fireEvent.change(input, { target: { value: " test-token " } });
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    await screen.findByText("Dooray 계정이 연결되었습니다.");
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ token: "test-token" }));
    expect((input as HTMLInputElement).value).toBe("");
  });
  it("keeps successful sections visible when mail fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(overview())));
    render(<DoorayPage />);
    expect(await screen.findByText("팀 회의")).toBeTruthy();
    expect(screen.getByText("우리 팀")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("메일 조회 실패");
    expect(screen.getByText("최근 메일 소식", { exact: true })).toBeTruthy();
  });
  it("ignores an old response after the selected date changes", async () => {
    let resolveFirst!: (value: ReturnType<typeof response>) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce(response(overview("새 날짜 회의")));
    vi.stubGlobal("fetch", fetch);
    render(<DoorayPage />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("일정 날짜 (한국 시간)"), { target: { value: "2026-10-15" } });
    await screen.findByText("새 날짜 회의");
    await act(async () => resolveFirst(response(overview("오래된 회의"))));
    expect(screen.queryByText("오래된 회의")).toBeNull();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

it("reloads the selected calendar while keeping the date", async () => {
  const data = { ...overview(), events: { ...overview().events, calendars: [{ id: "12", name: "개인 일정" }] } };
  const fetch = vi.fn().mockResolvedValue(response(data)); vi.stubGlobal("fetch", fetch);
  render(<DoorayPage />);
  fireEvent.change(await screen.findByLabelText("캘린더"), { target: { value: "12" } });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[1][0]).toContain("calendar=12");
});

it("hides the token calendar section in the app's mail/messenger view", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...overview(), calendarSource: "app" })));
  render(<DoorayPage />);
  await screen.findByText("최근 메일 소식");
  expect(screen.queryByText("팀 회의")).toBeNull();
});
