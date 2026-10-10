import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import DesktopAppCard from "@/components/home/DesktopAppCard";
import { appPlatform, browserPlatform, dismissed, DISMISS_KEY, presenceFromRows } from "@/lib/desktop/presence";

const user = vi.hoisted(() => ({ id: "self", allowed: true }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ userId: user.id, canAccessPage: () => user.allowed }) }));

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0";
function setBrowser(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
}
// Node 22+의 실험적 localStorage 전역(플래그 없으면 undefined)이 jsdom 것을 가리므로 메모리 저장소로 대체한다.
beforeEach(() => { const m = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, clear: () => m.clear() }); });
afterEach(() => { vi.unstubAllGlobals(); user.allowed = true; });

describe("presence 도우미", () => {
  it("앱 로그인 User-Agent에서 데스크톱 플랫폼을 읽고 모바일·브라우저는 무시한다", () => {
    expect(appPlatform("InnogridApp/1.6.1 (macOS) InnogridBuild/37")).toBe("macos"); // 실제 기록은 Flutter 플랫폼 이름 그대로 macOS
    expect(appPlatform("InnogridApp/dev (macos) InnogridBuild/0")).toBe("macos");
    expect(appPlatform("InnogridApp/1.4.6 (windows) InnogridBuild/31")).toBe("windows");
    expect(appPlatform("InnogridApp/1.6.1 (android) InnogridBuild/37")).toBeNull();
    expect(appPlatform("InnogridApp/dev (iOS) InnogridBuild/0")).toBeNull();
    expect(appPlatform(MAC_UA)).toBeNull();
    expect(appPlatform(null)).toBeNull();
  });
  it("브라우저 UA를 데스크톱 OS로 분류하고 휴대폰·iPad는 제외한다", () => {
    expect(browserPlatform(MAC_UA)).toBe("macos");
    expect(browserPlatform(WIN_UA)).toBe("windows");
    expect(browserPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBeNull();
    expect(browserPlatform("Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36")).toBeNull();
    expect(browserPlatform(MAC_UA, 5)).toBeNull(); // iPadOS Safari는 Macintosh로 위장
  });
  it("로그인 이력에서 플랫폼별 가장 최근 시각만 남긴다", () => {
    expect(presenceFromRows([
      { user_agent: "InnogridApp/1.6.1 (windows) InnogridBuild/37", logged_in_at: "2026-10-10T01:00:00Z" },
      { user_agent: "InnogridApp/1.6.0 (windows) InnogridBuild/36", logged_in_at: "2026-10-01T01:00:00Z" },
      { user_agent: "InnogridApp/1.6.1 (iOS) InnogridBuild/37", logged_in_at: "2026-10-09T01:00:00Z" },
      { user_agent: "InnogridApp/1.6.1 (macOS) InnogridBuild/37", logged_in_at: "2026-10-08T01:00:00Z" },
    ])).toEqual({ macos: "2026-10-08T01:00:00Z", windows: "2026-10-10T01:00:00Z" });
  });
  it("닫은 지 30일 안이면 숨기고, 그 뒤나 값이 없으면 다시 보인다", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    expect(dismissed("2026-10-01T00:00:00Z", now)).toBe(true);
    expect(dismissed("2026-09-01T00:00:00Z", now)).toBe(false);
    expect(dismissed(null, now)).toBe(false);
    expect(dismissed("garbage", now)).toBe(false);
  });
});

describe("홈 설치 카드", () => {
  it("Windows 브라우저에서 앱 로그인 기록이 없으면 설치 카드와 안내 링크를 보여 준다", async () => {
    setBrowser(WIN_UA);
    const fetch = vi.fn().mockResolvedValue(Response.json({ macos: "2026-10-10T01:00:00Z", windows: null }));
    vi.stubGlobal("fetch", fetch);
    render(<DesktopAppCard />);
    expect(await screen.findByRole("heading", { name: /데스크톱 앱을 설치하세요/ })).toBeInTheDocument();
    expect(fetch.mock.calls[0][0]).toBe("/api/desktop/presence");
    expect(screen.getByRole("link", { name: "Windows 설치 파일 받기" })).toHaveAttribute("href", "/apps");
    expect(screen.getByRole("link", { name: "설치 안내 보기" })).toHaveAttribute("href", "/manual#desktop-install");
    expect(screen.getByText(/추가 정보 → 실행/)).toBeInTheDocument();
  });
  it("현재 OS의 앱에 로그인한 기록이 있으면 카드를 숨긴다", async () => {
    setBrowser(MAC_UA);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ macos: "2026-10-10T01:00:00Z", windows: null })));
    const view = render(<DesktopAppCard />);
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
  });
  it("휴대폰 브라우저나 /apps 권한이 없으면 조회조차 하지 않는다", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    setBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148", 5);
    const view = render(<DesktopAppCard />);
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
    view.unmount(); setBrowser(MAC_UA); user.allowed = false;
    render(<DesktopAppCard />);
    await act(async () => {});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("‘다음에’를 누르면 카드가 닫히고 30일 동안 다시 묻지 않는다", async () => {
    setBrowser(MAC_UA);
    const fetch = vi.fn().mockResolvedValue(Response.json({ macos: null, windows: null }));
    vi.stubGlobal("fetch", fetch);
    const view = render(<DesktopAppCard />);
    await screen.findByRole("heading", { name: /데스크톱 앱을 설치하세요/ });
    fireEvent.click(screen.getByRole("button", { name: "다음에" }));
    expect(view.container).toBeEmptyDOMElement();
    expect(dismissed(localStorage.getItem(DISMISS_KEY))).toBe(true);
    view.unmount();
    render(<DesktopAppCard />);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
