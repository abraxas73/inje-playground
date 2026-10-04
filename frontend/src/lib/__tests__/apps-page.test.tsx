import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppsPageView } from "@/app/apps/page";

afterEach(() => vi.unstubAllGlobals());
const ios = { version: "1.1.0", build: 3, releasedAt: "2026-10-04T06:30:00Z", url: "https://testflight.apple.com/join/abc" };

it("두 플랫폼의 버전·링크를 보여 주고, APK 받기는 누를 때 새 서명 URL을 받아 이동한다", async () => {
  const urls = ["https://signed/1", "https://signed/2"];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ notes: "게시판 읽기", ios, android: { version: "1.1.0", build: 3, releasedAt: null, url: urls.shift() } }) })));
  const navigate = vi.fn();
  render(<AppsPageView navigate={navigate} />);
  expect(await screen.findByRole("link", { name: /TestFlight에서 열기 · v1.1.0 \(3\)/ })).toHaveAttribute("href", "https://testflight.apple.com/join/abc");
  expect(screen.getByText("게시판 읽기")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /APK 받기 · v1.1.0 \(3\)/ }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://signed/2"));
});
it("릴리스가 없으면 버튼은 '준비 중'으로 비활성", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ notes: "", ios: null, android: null }) })));
  render(<AppsPageView navigate={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "TestFlight 준비 중" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "APK 준비 중" })).toBeDisabled();
});
it("권한 오류(403)는 서버 문구와 다시 시도 버튼", async () => {
  const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "사용자 권한이 필요합니다." }) }));
  vi.stubGlobal("fetch", fetchMock);
  render(<AppsPageView navigate={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("사용자 권한이 필요합니다.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});
