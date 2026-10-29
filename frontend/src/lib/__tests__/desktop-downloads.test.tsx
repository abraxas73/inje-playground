import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DesktopDownloads } from "@/app/apps/DesktopDownloads";

const artifact = (p: "macos" | "windows", filename: string) => ({ version: "1.6.8", filename, path: `${p}/1.6.8/${filename}`, sha256: "a".repeat(64), bytes: 13088869, releasedAt: "2026-10-12T16:32:00Z" });
const release = { macos: artifact("macos", "INNOGRID-macOS-1.6.8.dmg"), windows: artifact("windows", "INNOGRID-Windows-1.6.8-Setup.exe") };
afterEach(() => vi.unstubAllGlobals());

it("Windows 카드는 실행 전 다운로드 경고(유지 → 그래도 유지)부터 실행 경고(추가 정보 → 실행)까지 순서대로 안내하고 매뉴얼 설치 절로 잇는다", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => release })));
  const { container } = render(<DesktopDownloads />);
  await screen.findByText(/설치 파일 다운로드/);
  expect(container.textContent).toMatch(/다운로드[^]*일반적으로 다운로드되지 않는[^]*유지 → 그래도 유지[^]*Chrome[^]*Windows의 PC 보호[^]*추가 정보 → 실행/);
  expect(container.querySelector('a[href="/manual#desktop-install"]')).not.toBeNull();
  expect(container.querySelector('a[href="/manual#windows-smart-app-control"]')?.textContent).toContain("실행 오류 화면 안내 보기");
  expect(container.textContent).toMatch(/잘못된 이미지[^]*스마트 앱 컨트롤[^]*끄기/);
  expect(container.textContent).toContain("Apple 서명·공증 완료"); // macOS 카드는 경고 안내 없음
});

it("각 다운로드 버튼 옆에 설치 파일의 KST 업데이트 게시일과 시각을 표시한다", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => release })));
  render(<DesktopDownloads />);
  expect(await screen.findAllByText("업데이트 게시: 2026. 10. 13. 01:32 (KST)")).toHaveLength(2);
});

it("최초 수동 설치 이후 앱 안에서 자동 설치·재시작됨을 안내한다", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => release })));
  const { container } = render(<DesktopDownloads />);
  await screen.findByText(/설치 파일 다운로드/);
  expect(container.textContent).toContain("1.7.9부터 앱 내 자동 업데이트");
  expect(container.textContent).toContain("최초 한 번");
  expect(container.textContent).toContain("자동 설치·재시작");
});
