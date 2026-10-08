import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppsPageView } from "@/app/apps/page";
vi.mock("@/app/apps/DesktopDownloads", () => ({ DesktopDownloads: () => null }));
afterEach(() => vi.unstubAllGlobals());
const url = "https://play.google.com/apps/internaltest/4701070333674267983";
const release = { notes: "게시판 읽기", ios: null, android: { version: "1.1.0", build: 3, releasedAt: null, url } };
function mockRequests(items: unknown[], error = false) {
  const fetcher = vi.fn(async (path: string) => ({ ok: path.includes("app-requests") ? !error : true,
    json: async () => path.includes("app-requests") ? error ? { error: "신청 내역 조회 실패" } : { items } : release }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("미신청자는 플랫폼별로 설정에서 신청하며 Play 설치 링크는 노출하지 않는다", async () => {
  mockRequests([]); render(<AppsPageView />);
  expect(await screen.findByRole("link", { name: "앱 사용 신청하기" })).toHaveAttribute("href", "/settings#app-request");
  expect(screen.getByRole("link", { name: "TestFlight 신청하기" })).toHaveAttribute("href", "/settings#app-request");
  expect(screen.queryByRole("button", { name: /Google Play에서 열기/ })).not.toBeInTheDocument();
});
it.each(["pending", "processing"])("Android %s이면 상태 확인으로, iOS 미신청이면 신청으로 보낸다", async status => {
  mockRequests([{ platform: "android", status, store_email: "tester@gmail.com" }]); render(<AppsPageView />);
  expect(await screen.findByRole("link", { name: "신청 상태 확인" })).toHaveAttribute("href", "/settings#app-request");
  expect(screen.getByRole("link", { name: "TestFlight 신청하기" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Google Play에서 열기/ })).not.toBeInTheDocument();
});
it("반려된 신청은 다시 신청할 수 있다", async () => {
  mockRequests([{ platform: "android", status: "rejected" }]); render(<AppsPageView />);
  expect(await screen.findByRole("link", { name: "다시 신청하기" })).toHaveAttribute("href", "/settings#app-request");
});
it("등록 완료된 Android는 Play로, iOS는 설정의 초대·설치 안내로 이동한다", async () => {
  mockRequests([{ platform: "android", status: "approved" }, { platform: "ios", status: "approved" }]);
  const navigate = vi.fn(); render(<AppsPageView navigate={navigate} />);
  const button = await screen.findByRole("button", { name: /Google Play에서 열기/ });
  expect(screen.getByRole("link", { name: "TestFlight 설치 안내" })).toHaveAttribute("href", "/settings#app-request");
  fireEvent.click(button); await waitFor(() => expect(navigate).toHaveBeenCalledWith(url));
});
it("조회 실패를 미신청으로 오인하지 않으며 신청 상태 확인을 제공한다", async () => {
  mockRequests([], true); render(<AppsPageView />);
  expect(await screen.findByRole("alert")).toHaveTextContent("신청 내역 조회 실패");
  expect(screen.getAllByRole("link", { name: "신청 상태 확인" })).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /Google Play에서 열기/ })).not.toBeInTheDocument();
});
it("다른 화면에서 재신청했으면 오래된 승인 상태로 Play에 보내지 않는다", async () => {
  const fetcher = mockRequests([{ platform: "android", status: "approved" }]);
  const navigate = vi.fn(); render(<AppsPageView navigate={navigate} />);
  const button = await screen.findByRole("button", { name: /Google Play에서 열기/ });
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ platform: "android", status: "pending" }] }) });
  fireEvent.click(button); await waitFor(() => expect(navigate).toHaveBeenCalledWith("/settings#app-request"));
});
