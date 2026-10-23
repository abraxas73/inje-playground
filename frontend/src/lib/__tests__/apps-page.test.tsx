import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppsPageView } from "@/app/apps/page";
vi.mock("@/app/apps/DesktopDownloads", () => ({ DesktopDownloads: () => null }));
afterEach(() => vi.unstubAllGlobals());
const url = "https://play.google.com/store/apps/details?id=com.innogrid.playground";
const release = { notes: "게시판 읽기", ios: null, android: { version: "1.1.0", build: 3, releasedAt: null, url } };
function mockRequests(items: unknown[], error = false) {
  const fetcher = vi.fn(async (path: string) => ({ ok: path.includes("app-requests") ? !error : true,
    json: async () => path.includes("app-requests") ? error ? { error: "신청 내역 조회 실패" } : { items } : release }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("Android는 신청 없이 Google Play 스토어 링크로, iOS 미신청은 설정의 신청으로 보낸다", async () => {
  mockRequests([]); render(<AppsPageView />);
  expect(await screen.findByRole("link", { name: /Google Play에서 설치 · v1.1.0/ })).toHaveAttribute("href", url);
  expect(screen.getByRole("link", { name: "TestFlight 신청하기" })).toHaveAttribute("href", "/settings#app-request");
  expect(screen.queryByRole("link", { name: "앱 사용 신청하기" })).not.toBeInTheDocument();
});
it("예전 Android 신청 기록이 있어도 Play 링크를 막지 않는다", async () => {
  mockRequests([{ platform: "android", status: "pending", store_email: "tester@gmail.com" }]); render(<AppsPageView />);
  expect(await screen.findByRole("link", { name: /Google Play에서 설치/ })).toHaveAttribute("href", url);
});
it("iOS 반려는 다시 신청, 등록 완료는 설치 안내로 보낸다", async () => {
  mockRequests([{ platform: "ios", status: "rejected" }]); const { unmount } = render(<AppsPageView />);
  expect(await screen.findByRole("link", { name: "다시 신청하기" })).toHaveAttribute("href", "/settings#app-request");
  unmount(); mockRequests([{ platform: "ios", status: "approved" }]); render(<AppsPageView />);
  expect(await screen.findByRole("link", { name: "TestFlight 설치 안내" })).toHaveAttribute("href", "/settings#app-request");
});
it("조회 실패를 미신청으로 오인하지 않으며 신청 상태 확인을 제공한다", async () => {
  mockRequests([], true); render(<AppsPageView />);
  expect(await screen.findByRole("alert")).toHaveTextContent("신청 내역 조회 실패");
  expect(screen.getByRole("link", { name: "신청 상태 확인" })).toHaveAttribute("href", "/settings#app-request");
  expect(screen.getByRole("link", { name: /Google Play에서 설치/ })).toHaveAttribute("href", url);
});
