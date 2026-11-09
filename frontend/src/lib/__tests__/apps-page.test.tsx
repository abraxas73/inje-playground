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
it("iPhone은 App Store, Android는 Google Play 링크로 — 신청 없이", async () => {
  mockRequests([]); render(<AppsPageView />);
  expect(await screen.findByRole("link", { name: /Google Play에서 설치 · v1.1.0/ })).toHaveAttribute("href", url);
  expect(screen.getByRole("link", { name: "App Store에서 설치" })).toHaveAttribute("href", "https://apps.apple.com/kr/app/innogrid/id6818983333");
  expect(screen.queryByRole("link", { name: /TestFlight/ })).not.toBeInTheDocument();
});
