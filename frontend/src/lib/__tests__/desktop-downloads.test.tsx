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
  expect(container.textContent).toContain("Apple 서명·공증 완료"); // macOS 카드는 경고 안내 없음
});
