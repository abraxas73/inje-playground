import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppsPageView } from "@/app/apps/page";

vi.mock("@/app/apps/DesktopDownloads", () => ({ DesktopDownloads: () => null }));

afterEach(() => vi.unstubAllGlobals());
const ios = { version: "1.1.0", build: 3, releasedAt: "2026-10-04T06:30:00Z", url: "https://testflight.apple.com/join/abc" };

it("두 플랫폼의 버전·링크를 보여 주고, Google Play 버튼은 내부 테스트 링크로 이동한다", async () => {
  const url = "https://play.google.com/apps/internaltest/4701070333674267983";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ notes: "게시판 읽기", ios, android: { version: "1.1.0", build: 3, releasedAt: null, url: url } }) })));
  const navigate = vi.fn();
  render(<AppsPageView navigate={navigate} />);
  expect(screen.getByRole("link", { name: "TestFlight 신청하기" })).toHaveAttribute("href", "/settings#app-request");
  expect(await screen.findByText("게시판 읽기")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Google Play에서 열기 · v1.1.0 \(3\)/ }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(url));
});
it("iOS는 릴리스가 없어도 신청 가능하고 Android는 준비 중", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ notes: "", ios: null, android: null }) })));
  render(<AppsPageView navigate={vi.fn()} />);
  expect(screen.getByRole("link", { name: "TestFlight 신청하기" })).toHaveAttribute("href", "/settings#app-request");
  await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Google Play 준비 중" })).toBeDisabled();
});
it("권한 오류(403)는 서버 문구와 다시 시도 버튼", async () => {
  const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "사용자 권한이 필요합니다." }) }));
  vi.stubGlobal("fetch", fetchMock);
  render(<AppsPageView navigate={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("사용자 권한이 필요합니다.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});
